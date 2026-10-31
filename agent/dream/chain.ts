import { readFile, lstat } from "node:fs/promises";
import { createHash } from "node:crypto";
import {
  address, getAddressEncoder, getAddressDecoder, getProgramDerivedAddress, AccountRole,
  createTransactionMessage, setTransactionMessageFeePayer, setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstruction, compileTransaction, blockhash, getBase64EncodedWireTransaction,
  createKeyPairSignerFromBytes, signTransaction, getSignatureFromTransaction,
} from "@solana/kit";
// Reuse 005's validated config/history reader and bounded read RPC transport. No edits to its lane.
import { SolanaChain } from "../dist/memory/committer-solana.js";
import { PROGRAM_ID, DEVNET_GENESIS, deriveIdentity, discriminator, decimalU64 } from "../dist/memory/committer.js";
export { PROGRAM_ID, DEVNET_GENESIS, deriveIdentity };
export const CORE_ID = "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d";
export const SYSTEM_ID = "11111111111111111111111111111111";
export const DREAM_SIZE = 89;
export interface Attribute { key: string; value: string }
export interface Snapshot { owner: string; characterId: string; config: string; asset: string; runtime: string; payer: string; revision: string; journalHash: string; attributes: Attribute[]; memoryEpoch: string; lifeStage: string }
export interface TraitIntent extends Snapshot { journalHash: string; newAttributes: Attribute[] }
export const sha256 = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const decodeAddress = (data: Uint8Array) => getAddressDecoder().decode(data);
export const u32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
export const u64 = (n: string) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(decimalU64(n)); return b; };
const stringBytes = (s: string) => { const b = Buffer.from(s); return Buffer.concat([u32(b.length), b]); };
export function validateAttributes(attrs: unknown): asserts attrs is Attribute[] {
  if (!Array.isArray(attrs) || attrs.length < 4 || attrs.length > 16) throw new Error("invalid attribute count");
  const seen = new Set();
  for (const a of attrs) {
    if (!a || Object.keys(a).sort().join() !== "key,value" || typeof a.key !== "string" || !a.key.length || Buffer.byteLength(a.key) > 32 ||
        typeof a.value !== "string" || !a.value.length || Buffer.byteLength(a.value) > 128 || seen.has(a.key)) throw new Error("invalid/duplicate attribute");
    seen.add(a.key);
  }
  if (!["life_stage", "memory_epoch", "mood", "trait_vector"].every(k => seen.has(k))) throw new Error("incomplete attributes");
}
/** Minimal bounded decoder for the pinned mpl-core 0.12.1 Borsh layout, not byte scanning.
 * Unknown authority variants/delegates fail closed. Real fixture cross-check in LiteSVM suite. */
export function decodeAttributes(data: Buffer, config: string): Attribute[] {
  let p = 0;
  const take = (n: number) => { if (!Number.isSafeInteger(n) || n < 0 || p + n > data.length) throw new Error("truncated Core data"); const b = data.subarray(p, p + n); p += n; return b; };
  const byte = () => take(1)[0];
  const count = () => take(4).readUInt32LE();
  const offset = () => { const n = take(8).readBigUInt64LE(); if (n > BigInt(data.length)) throw new Error("invalid Core offset"); return Number(n); };
  const string = () => new TextDecoder("utf-8", { fatal: true }).decode(take(count()));
  if (byte() !== 1) throw new Error("Core AssetV1 required");
  take(32); // owner; update authority is independently checked below
  if (byte() !== 1 || decodeAddress(take(32)) !== config) throw new Error("Core authority must be config PDA");
  string(); string(); const seq = byte(); if (seq === 1) take(8); else if (seq !== 0) throw new Error("invalid Core sequence");
  if (byte() !== 3) throw new Error("missing plugin header");
  const registryOffset = offset();
  if (registryOffset < p) throw new Error("invalid plugin registry offset");
  p = registryOffset;
  if (byte() !== 4) throw new Error("invalid plugin registry");
  const records = count(); if (records < 1 || records > 64) throw new Error("invalid plugin registry count");
  let attrOffset: number | undefined;
  for (let n = 0; n < records; n++) {
    const type = byte(), authority = byte();
    const delegated = authority === 3 ? decodeAddress(take(32)) : undefined;
    if (authority > 3 || type > 18 || type === 4) throw new Error("unsupported authority/delegate");
    const start = offset();
    if (type === 6) {
      if (attrOffset !== undefined || !(authority === 2 || (authority === 3 && delegated === config))) throw new Error("Attributes must be config-authorized");
      attrOffset = start;
    }
  }
  if (count() !== 0 || attrOffset === undefined || attrOffset >= registryOffset) throw new Error("unsupported external adapters or missing Attributes");
  p = attrOffset;
  if (byte() !== 6) throw new Error("invalid Attributes plugin");
  const size = count(); if (size > 16) throw new Error("too many Attributes");
  const attrs = Array.from({ length: size }, () => ({ key: string(), value: string() }));
  if (p > registryOffset) throw new Error("Attributes overlaps registry");
  validateAttributes(attrs); return attrs;
}
export async function dreamAddress(config: string) {
  return (await getProgramDerivedAddress({ programAddress: address(PROGRAM_ID), seeds: [Buffer.from("dream"), getAddressEncoder().encode(address(config))] }))[0];
}
export function traitInstruction(i: TraitIntent, dream: string) {
  validateAttributes(i.newAttributes);
  if (!/^[0-9a-f]{64}$/.test(i.journalHash) || /^0+$/.test(i.journalHash)) throw new Error("invalid journal hash");
  return { programAddress: address(PROGRAM_ID), accounts: [
    { address: address(i.config), role: AccountRole.READONLY },
    { address: address(i.runtime), role: AccountRole.READONLY_SIGNER },
    { address: address(i.payer), role: AccountRole.WRITABLE_SIGNER },
    { address: address(i.asset), role: AccountRole.WRITABLE },
    { address: address(dream), role: AccountRole.WRITABLE },
    { address: address(CORE_ID), role: AccountRole.READONLY },
    { address: address(SYSTEM_ID), role: AccountRole.READONLY },
  ], data: Buffer.concat([discriminator("global", "evolve_traits"), u64(i.revision), Buffer.from(i.journalHash, "hex"),
    u32(i.newAttributes.length), ...i.newAttributes.flatMap(a => [stringBytes(a.key), stringBytes(a.value)])]) };
}
interface RpcAccount { owner: string; executable: boolean; data: [string, string]; lamports: number }
export class DreamChain {
  base: SolanaChain;
  constructor(url: string) { this.base = new SolanaChain(url); }
  async account(key: string): Promise<RpcAccount | null> {
    return (await this.base.rpc("getAccountInfo", [key, { encoding: "base64", commitment: "confirmed" }]) as { value: RpcAccount | null }).value;
  }
  async snapshot(ns: { ownerId: string; characterId: string }, runtime: string, payer: string): Promise<Snapshot> {
    address(runtime); address(payer);
    const identity = await deriveIdentity(ns);
    const state = await this.base.inspect({ ...identity, payer });
    if (state.owner !== ns.ownerId || state.characterId !== ns.characterId || state.runtime !== runtime) throw new Error("dream identity/runtime mismatch");
    const cfg = await this.account(identity.config);
    if (!cfg || cfg.owner !== PROGRAM_ID || cfg.executable || cfg.data[1] !== "base64") throw new Error("config disappeared");
    const bytes = Buffer.from(cfg.data[0], "base64");
    if (bytes.length !== 154 || decodeAddress(bytes.subarray(48, 80)) !== runtime || bytes[152] !== 0) throw new Error("config changed or unsupported life stage");
    const asset = decodeAddress(bytes.subarray(80, 112));
    const account = await this.account(asset);
    if (!account || account.owner !== CORE_ID || account.executable || account.data[1] !== "base64") throw new Error("invalid Core asset");
    const attrs = decodeAttributes(Buffer.from(account.data[0], "base64"), identity.config);
    const dream = await this.account(await dreamAddress(identity.config));
    let revision = "0", journalHash = "0".repeat(64);
    if (dream) {
      const d = Buffer.from(dream.data[0], "base64");
      const [expected, bump] = await getProgramDerivedAddress({ programAddress: address(PROGRAM_ID), seeds: [Buffer.from("dream"), getAddressEncoder().encode(identity.config)] });
      if (dream.owner !== PROGRAM_ID || dream.executable || dream.data[1] !== "base64" || d.length !== DREAM_SIZE ||
          !d.subarray(0, 8).equals(discriminator("account", "DreamState")) || decodeAddress(d.subarray(8, 40)) !== identity.config || d[40] !== bump || !expected) throw new Error("invalid dream provenance");
      journalHash = d.subarray(41, 73).toString("hex"); revision = d.readBigUInt64LE(73).toString();
    }
    return { owner: ns.ownerId, characterId: ns.characterId, config: identity.config, asset, runtime, payer,
      revision, journalHash, attributes: attrs, memoryEpoch: bytes.readBigUInt64LE(144).toString(), lifeStage: "born" };
  }
  async inspect(i: Snapshot) { return this.snapshot({ ownerId: i.owner, characterId: i.characterId }, i.runtime, i.payer); }
  async transaction(i: TraitIntent) {
    const latest = await this.base.rpc("getLatestBlockhash", [{ commitment: "confirmed" }]) as { value: { blockhash: string; lastValidBlockHeight: number } };
    const message = appendTransactionMessageInstruction(traitInstruction(i, await dreamAddress(i.config)),
      setTransactionMessageLifetimeUsingBlockhash({ blockhash: blockhash(latest.value.blockhash), lastValidBlockHeight: BigInt(latest.value.lastValidBlockHeight) },
        setTransactionMessageFeePayer(address(i.payer), createTransactionMessage({ version: 0 }))));
    const tx = compileTransaction(message);
    // A full replacement must fit Solana's packet, never silently truncate attributes.
    if (Buffer.from(getBase64EncodedWireTransaction(tx), "base64").length > 1232) throw new Error("trait transaction exceeds packet limit");
    return { tx, lastValidBlockHeight: latest.value.lastValidBlockHeight };
  }
  async simulate(i: TraitIntent) {
    const { tx } = await this.transaction(i);
    const result = await this.base.rpc("simulateTransaction", [getBase64EncodedWireTransaction(tx), { encoding: "base64", sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed" }]) as { value: { err: unknown; unitsConsumed?: number } };
    if (result.value.err) throw new Error(`trait simulation rejected: ${JSON.stringify(result.value.err)}`);
    const fee = await this.base.rpc("getFeeForMessage", [Buffer.from(tx.messageBytes).toString("base64"), { commitment: "confirmed" }]) as { value: number | null };
    if (fee.value === null) throw new Error("trait fee unavailable");
    const asset = await this.account(i.asset), dream = await this.account(await dreamAddress(i.config));
    if (!asset) throw new Error("asset missing");
    // Conservative upper bound: do not subtract shrinking payloads or assume rent refunds.
    const growth = 4 + i.newAttributes.reduce((n, a) => n + 8 + Buffer.byteLength(a.key) + Buffer.byteLength(a.value), 0);
    const assetRent = await this.base.rpc("getMinimumBalanceForRentExemption", [Buffer.from(asset.data[0], "base64").length + growth]) as number;
    const dreamRent = dream ? 0 : await this.base.rpc("getMinimumBalanceForRentExemption", [DREAM_SIZE]) as number;
    const balance = await this.base.rpc("getBalance", [i.payer, { commitment: "confirmed" }]) as { value: number };
    return { feeLamports: fee.value, maximumRentLamports: dreamRent + Math.max(0, assetRent - asset.lamports), balanceLamports: balance.value, units: result.value.unitsConsumed };
  }
  async sign(i: TraitIntent, expiresAt?: string) {
    const key = async (path: string | undefined, expected: string) => {
      if (!path) throw new Error("missing existing signing-key reference; never regenerate");
      const info = await lstat(path);
      if (!info.isFile() || (info.mode & 0o077)) throw new Error("signing key must be private regular file (0600)");
      const bytes = JSON.parse(await readFile(path, "utf8"));
      if (!Array.isArray(bytes) || bytes.length !== 64 || bytes.some(b => !Number.isInteger(b) || b < 0 || b > 255)) throw new Error("invalid signing key");
      const signer = await createKeyPairSignerFromBytes(Uint8Array.from(bytes));
      if (signer.address !== expected) throw new Error("signing key public identity mismatch");
      return signer.keyPair;
    };
    const runtime = await key(process.env.MEMORY_COMMIT_RUNTIME_KEY_FILE, i.runtime);
    const keys = i.runtime === i.payer ? [runtime] : [runtime, await key(process.env.MEMORY_COMMIT_FEE_PAYER_KEY_FILE, i.payer)];
    const { tx, lastValidBlockHeight } = await this.transaction(i);
    if (!expiresAt || !Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Date.now()) throw new Error("trait approval expired before signing");
    const signed = await signTransaction(keys, tx);
    return { signature: getSignatureFromTransaction(signed), lastValidBlockHeight, wire: getBase64EncodedWireTransaction(signed) };
  }
  broadcast(s: { signature: string; wire: string; lastValidBlockHeight: number }) { return this.base.broadcast(s); }
  status(signature: string) { return this.base.status(signature); }
  finalizedHeight() { return this.base.finalizedHeight(); }
}
