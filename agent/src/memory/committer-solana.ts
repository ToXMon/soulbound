// Solana Kit 8.6.0 handles addresses, PDAs, transaction compilation/signatures.
// JSON-RPC transport is bounded stdlib fetch. Reads retry; send never retries here.
import { readFile, stat } from "node:fs/promises";
import {
  address, getAddressDecoder,
  createTransactionMessage, setTransactionMessageFeePayer, setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstruction, compileTransaction, getBase64EncodedWireTransaction,
  createKeyPairSignerFromBytes, signTransaction, getSignatureFromTransaction, blockhash, AccountRole, type Instruction,
} from "@solana/kit";
import { PROGRAM_ID, DEVNET_GENESIS, HISTORY_SIZE, discriminator, decimalU64, rootBytes, deriveIdentity,
  type Intent, type Chain, type ChainState, type Submission } from "./committer.js";

import type { RotationIntent } from "./runtime-rotation.js";

export function rotationInstruction(i: RotationIntent) {
  return { programAddress: address(PROGRAM_ID), accounts: [
    { address: address(i.config), role: AccountRole.WRITABLE },
    { address: address(i.owner), role: AccountRole.READONLY_SIGNER },
    { address: address(i.replacement), role: AccountRole.READONLY_SIGNER },
  ], data: discriminator("global", "rotate_runtime_signer") };
}

const SYSTEM = "11111111111111111111111111111111";
interface RpcAccount { owner: string; executable: boolean; data: [string, string] }
interface ContextValue<T> { context: { slot: number }; value: T }
const decodeAddress = (bytes: Uint8Array) => getAddressDecoder().decode(bytes);
function accountBytes(account: RpcAccount, name: string) {
  if (account.owner !== PROGRAM_ID || account.executable || account.data[1] !== "base64") throw new Error(`${name}: wrong account owner/encoding`);
  return Buffer.from(account.data[0], "base64");
}
export function commitInstruction(i: Intent) {
  const epoch = Buffer.alloc(8); epoch.writeBigUInt64LE(decimalU64(i.epoch));
  return { programAddress: address(PROGRAM_ID), accounts: [
    { address: address(i.config), role: AccountRole.WRITABLE },
    { address: address(i.runtime), role: AccountRole.READONLY_SIGNER },
    { address: address(i.payer), role: AccountRole.WRITABLE_SIGNER },
    { address: address(i.history), role: AccountRole.WRITABLE },
    { address: address(SYSTEM), role: AccountRole.READONLY },
  ], data: Buffer.concat([discriminator("global", "commit_memory_root"), epoch, rootBytes(i.root)]) };
}
export class SolanaChain implements Chain {
  constructor(private url: string, private runtimeKeyFile?: string, private payerKeyFile?: string) {
    const u = new URL(url);
    if (u.protocol !== "https:" || u.username || u.password) throw new Error("RPC must be HTTPS without embedded credentials");
  }
  async rpc<T>(method: string, params: unknown[] = [], retry = true): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        const response = await fetch(this.url, { method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(5000) });
        if (!response.ok) throw new Error("RPC HTTP failure");
        const body = await response.json() as { result?: T; error?: unknown };
        if (body.error || body.result === undefined) throw new Error("RPC method failure");
        return body.result;
      } catch {
        if (!retry || attempt >= 2) throw new Error(`RPC ${method} failed (bounded attempts; no credential/URL logging)`);
        await new Promise((r) => setTimeout(r, 200 * 2 ** attempt));
      }
    }
  }
  async inspect(i: Pick<Intent, "config" | "history" | "payer">): Promise<ChainState> {
    const genesis = await this.rpc<string>("getGenesisHash");
    if (genesis !== DEVNET_GENESIS) throw new Error("wrong cluster: devnet required");
    const result = await this.rpc<ContextValue<(RpcAccount | null)[]>>("getMultipleAccounts", [[PROGRAM_ID, i.config, i.history, i.payer], { encoding: "base64", commitment: "confirmed" }]);
    const [program, config, history, payer] = result.value;
    if (!program?.executable || !config) throw new Error("program non-executable or config missing");
    if (!payer || payer.owner !== SYSTEM || payer.executable || Buffer.from(payer.data[0], "base64").length !== 0) throw new Error("fee payer must be a funded system wallet");
    const data = accountBytes(config, "config");
    if (data.length !== 154 || !data.subarray(0, 8).equals(discriminator("account", "CharacterConfig"))) throw new Error("config layout/discriminator mismatch");
    const owner = decodeAddress(data.subarray(8, 40)), characterId = data.readBigUInt64LE(40).toString();
    const runtime = decodeAddress(data.subarray(48, 80));
    const identity = await deriveIdentity({ ownerId: owner, characterId });
    if (identity.config !== i.config || identity.history !== i.history || data[153] !== identity.configBump) throw new Error("config PDA/bump mismatch");
    const entries: ChainState["entries"] = [];
    if (history && !(history.owner === SYSTEM && Buffer.from(history.data[0], "base64").length === 0)) {
      const h = accountBytes(history, "history");
      if (h.length !== HISTORY_SIZE || !h.subarray(0, 8).equals(discriminator("account", "MemoryRootHistory")) || decodeAddress(h.subarray(8, 40)) !== i.config || h[40] !== identity.historyBump) throw new Error("history layout/binding mismatch");
      const count = h.readUInt32LE(41);
      if (count > 128) throw new Error("invalid history count");
      for (let n = 0; n < count; n++) {
        const offset = 45 + 48 * n;
        entries.push({ epoch: h.readBigUInt64LE(offset).toString(), root: h.subarray(offset + 8, offset + 40).toString("hex") });
      }
      if (!entries.length || data.readBigUInt64LE(144).toString() !== entries.at(-1)!.epoch) throw new Error("config/history epoch mismatch");
    } else if (data.readBigUInt64LE(144) !== 0n) throw new Error("missing history with advanced config epoch");
    return { genesis, executable: program.executable, program: PROGRAM_ID, owner, characterId, runtime, entries };
  }
  private transaction(i: Intent) { return this.transactionFor(commitInstruction(i), i.payer); }
  private async transactionFor(instruction: Instruction, payer: string) {
    const latest = await this.rpc<ContextValue<{ blockhash: string; lastValidBlockHeight: number }>>("getLatestBlockhash", [{ commitment: "confirmed" }]);
    const message = appendTransactionMessageInstruction(instruction,
      setTransactionMessageLifetimeUsingBlockhash({ blockhash: blockhash(latest.value.blockhash), lastValidBlockHeight: BigInt(latest.value.lastValidBlockHeight) },
        setTransactionMessageFeePayer(address(payer), createTransactionMessage({ version: 0 }))));
    return { tx: compileTransaction(message), lastValidBlockHeight: latest.value.lastValidBlockHeight };
  }
  async simulate(i: Intent) {
    const { tx } = await this.transaction(i);
    const rent = await this.rpc<number>("getMinimumBalanceForRentExemption", [HISTORY_SIZE]);
    return this.estimate(tx, i.payer, rent);
  }
  async simulateRotation(i: RotationIntent) {
    const { tx } = await this.transactionFor(rotationInstruction(i), i.payer);
    return this.estimate(tx, i.payer, 0); // Rotation allocates no accounts.
  }
  private async estimate(tx: Awaited<ReturnType<SolanaChain["transactionFor"]>>["tx"], payer: string, rent: number) {
    const simulation = await this.rpc<ContextValue<{ err: unknown; unitsConsumed?: number }>>("simulateTransaction", [getBase64EncodedWireTransaction(tx), { encoding: "base64", sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed" }]);
    if (simulation.value.err) throw new Error(`simulation rejected: ${JSON.stringify(simulation.value.err)}`);
    const balance = await this.rpc<ContextValue<number>>("getBalance", [payer, { commitment: "confirmed" }]);
    const fee = await this.rpc<ContextValue<number | null>>("getFeeForMessage", [Buffer.from(tx.messageBytes).toString("base64"), { commitment: "confirmed" }]);
    if (fee.value === null) throw new Error("fee estimate unavailable");
    return { units: simulation.value.unitsConsumed, balanceLamports: balance.value, feeLamports: fee.value, maximumHistoryRentLamports: rent };
  }
  private async key(path: string | undefined, expected: string) {
    if (!path) throw new Error("missing existing signing-key reference; never regenerate");
    const info = await stat(path);
    if (!info.isFile() || (info.mode & 0o077) !== 0) throw new Error("signing key must be a private regular file (0600)");
    const bytes: unknown = JSON.parse(await readFile(path, "utf8"));
    if (!Array.isArray(bytes) || bytes.length !== 64 || bytes.some((b) => !Number.isInteger(b) || b < 0 || b > 255)) throw new Error("invalid key file");
    const signer = await createKeyPairSignerFromBytes(Uint8Array.from(bytes));
    if (signer.address !== expected) throw new Error("signing key public identity mismatch");
    return signer.keyPair;
  }
  async sign(i: Intent): Promise<Submission> {
    const runtime = await this.key(this.runtimeKeyFile, i.runtime);
    const payer = i.runtime === i.payer ? runtime : await this.key(this.payerKeyFile, i.payer);
    const { tx, lastValidBlockHeight } = await this.transaction(i);
    const signed = await signTransaction(i.runtime === i.payer ? [runtime] : [runtime, payer], tx);
    return { signature: getSignatureFromTransaction(signed), lastValidBlockHeight, wire: getBase64EncodedWireTransaction(signed) };
  }
  async signRotation(i: RotationIntent, ownerKeyFile?: string, replacementKeyFile?: string): Promise<Submission> {
    const keys = new Map<string, CryptoKeyPair>();
    keys.set(i.owner, await this.key(ownerKeyFile, i.owner));
    if (!keys.has(i.replacement)) keys.set(i.replacement, await this.key(replacementKeyFile, i.replacement));
    if (!keys.has(i.payer)) keys.set(i.payer, await this.key(this.payerKeyFile, i.payer));
    const { tx, lastValidBlockHeight } = await this.transactionFor(rotationInstruction(i), i.payer);
    const signed = await signTransaction([...keys.values()], tx);
    return { signature: getSignatureFromTransaction(signed), lastValidBlockHeight, wire: getBase64EncodedWireTransaction(signed) };
  }
  async broadcast(s: Submission) {
    const signature = await this.rpc<string>("sendTransaction", [s.wire, { encoding: "base64", skipPreflight: false, preflightCommitment: "confirmed", maxRetries: 0 }], false);
    if (signature !== s.signature) throw new Error("RPC signature mismatch; reconcile journal");
  }
  async status(signature: string) {
    const result = await this.rpc<{ value: ({ err: unknown; confirmationStatus: string } | null)[] }>("getSignatureStatuses", [[signature], { searchTransactionHistory: true }]);
    const s = result.value[0];
    return !s ? "absent" : s.err ? "error" : ["confirmed", "finalized"].includes(s.confirmationStatus) ? "confirmed" : "pending";
  }
  finalizedHeight() { return this.rpc<number>("getBlockHeight", [{ commitment: "finalized" }]); }
}
