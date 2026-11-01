// Ticket 015: read-only public projection. Never open MemoryStore (writer lock),
// load signing keys, expose record objects, or log raw errors/private file paths.
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { address, getAddressDecoder, getBase58Encoder } from "@solana/kit";
import { deriveIdentity, discriminator, PROGRAM_ID, DEVNET_GENESIS, HISTORY_SIZE } from "./memory/committer.js";
import { namespaceDirName, validateStoreFile, type Namespace } from "./memory/store.js";
import { validateRecord } from "./memory/schema.js";
import { contentHash, merkleProof, verifyProof } from "./memory/merkle.js";

const CORE = "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d";
const decodeAddress = (b: Uint8Array) => getAddressDecoder().decode(b);
export type Rpc = <T>(method: string, params?: unknown[]) => Promise<T>;
interface Account { owner: string; executable: boolean; data: [string, string] }
interface Accounts { context: { slot: number }; value: (Account | null)[] }
export interface PublicMemory { id: string; epoch: number; hash: string; root: string }
export interface LifeSnapshot {
  checkedAt: string; chain: { config: string; history: string; asset: string; slot: number; stage: string | null;
    attributes: { key: string; value: string }[]; genesisVector: string | null; genesisSignature: string | null } | null;
  memories: PublicMemory[]; chainUnavailable: boolean; memoriesUnavailable: boolean;
  // No writers exist yet (010 and cost instrumentation). Never infer these from
  // configured model names, wallet balances, or illustrative Paper values.
  turns: { id: string; model: string; costUsd: string | null }[];
  receipts: { id: string; status: "paid" | "unpaid"; amount: string | null; network: string; transactionUrl: string | null }[];
}
export interface ProofResult {
  status: "valid" | "invalid" | "unavailable" | "not-committed" | "not-found";
  message: string; elapsedMs: number; root?: string; slot?: number;
  proof?: { leaf: string; siblings: string[]; leafIndex: number; leafCount: number };
}
export function lifeNamespace(env: NodeJS.ProcessEnv): Namespace {
  const ownerId = env.MEMORY_OWNER_ID ?? "", characterId = env.MEMORY_CHARACTER_ID ?? "";
  address(ownerId);
  const ns = { ownerId, characterId };
  namespaceDirName(ns); // identifier validation; deriveIdentity also validates decimal u64
  return ns;
}
export function rpcReader(url: string, signal: AbortSignal): Rpc {
  const u = new URL(url);
  if (u.protocol !== "https:" || u.username || u.password) throw new Error("invalid RPC configuration");
  return async <T>(method: string, params: unknown[] = []): Promise<T> => {
    const response = await fetch(u, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal });
    if (!response.ok) throw new Error("RPC unavailable");
    const body = await response.json() as { result?: T; error?: unknown };
    if (body.error || body.result === undefined) throw new Error("RPC unavailable");
    return body.result;
  };
}
function bytes(a: Account | null, owner: string): Buffer {
  if (!a || a.owner !== owner || a.executable || !Array.isArray(a.data) || a.data[1] !== "base64") throw new Error("invalid account");
  return Buffer.from(a.data[0], "base64");
}
export async function readCommitments(ns: Namespace, rpc: Rpc) {
  const identity = await deriveIdentity(ns);
  const [genesis, accounts] = await Promise.all([
    rpc<string>("getGenesisHash"),
    rpc<Accounts>("getMultipleAccounts", [[PROGRAM_ID, identity.config, identity.history], { encoding: "base64", commitment: "confirmed" }]),
  ]);
  if (genesis !== DEVNET_GENESIS || !accounts.value[0]?.executable) throw new Error("wrong cluster/program");
  const config = bytes(accounts.value[1], PROGRAM_ID);
  if (config.length !== 154 || !config.subarray(0, 8).equals(discriminator("account", "CharacterConfig")) ||
      decodeAddress(config.subarray(8, 40)) !== ns.ownerId || config.readBigUInt64LE(40).toString() !== ns.characterId ||
      config[153] !== identity.configBump) throw new Error("invalid config identity");
  const entries: { epoch: string; root: string }[] = [];
  const history = accounts.value[2];
  if (history) {
    const h = bytes(history, PROGRAM_ID);
    if (h.length !== HISTORY_SIZE || !h.subarray(0, 8).equals(discriminator("account", "MemoryRootHistory")) ||
        decodeAddress(h.subarray(8, 40)) !== identity.config || h[40] !== identity.historyBump) throw new Error("invalid history identity");
    const count = h.readUInt32LE(41);
    if (count < 1 || count > 128) throw new Error("invalid history count");
    for (let n = 0; n < count; n++) {
      const p = 45 + n * 48, epoch = h.readBigUInt64LE(p).toString(), root = h.subarray(p + 8, p + 40).toString("hex");
      if (/^0{64}$/.test(root) || (n && BigInt(epoch) <= BigInt(entries[n - 1].epoch))) throw new Error("invalid history progression");
      entries.push({ epoch, root });
    }
    if (config.readBigUInt64LE(144).toString() !== entries.at(-1)!.epoch) throw new Error("epoch mismatch");
  } else if (config.readBigUInt64LE(144) !== 0n) throw new Error("missing history");
  if (!Number.isSafeInteger(accounts.context.slot) || accounts.context.slot < 0) throw new Error("invalid slot");
  return { ...identity, entries, asset: decodeAddress(config.subarray(80, 112)),
    slot: accounts.context.slot, stage: config[152] === 0 ? "born" : config[152] === 1 ? "awakened" : null };
}

// Bounded Borsh subset for the pinned mpl-core 0.12.1 layouts: BaseAssetV1,
// PluginHeaderV1, PluginRegistryV1/RegistryRecord and Attributes (variant 6).
// Unknown layouts fail unavailable, rather than guessing or scanning for strings.
class Cursor {
  p = 0;
  constructor(readonly b: Buffer) {}
  take(n: number) { if (!Number.isSafeInteger(n) || n < 0 || this.p + n > this.b.length) throw new Error("truncated account"); const b = this.b.subarray(this.p, this.p + n); this.p += n; return b; }
  u8() { return this.take(1)[0]; }
  u32() { return this.take(4).readUInt32LE(); }
  u64() { const n = this.take(8).readBigUInt64LE(); if (n > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("oversize offset"); return Number(n); }
  string(max: number) { const n = this.u32(); if (n > max) throw new Error("oversize string"); return new TextDecoder("utf-8", { fatal: true }).decode(this.take(n)); }
}
export function coreAttributes(data: Buffer, owner: string, config: string) {
  const c = new Cursor(data);
  if (c.u8() !== 1 || decodeAddress(c.take(32)) !== owner || c.u8() !== 1 || decodeAddress(c.take(32)) !== config) throw new Error("asset binding mismatch");
  c.string(512); c.string(2048);
  const seq = c.u8(); if (seq === 1) c.take(8); else if (seq !== 0) throw new Error("invalid seq");
  const header = c.p;
  if (c.u8() !== 3) throw new Error("missing plugin header");
  const registryOffset = c.u64();
  if (registryOffset < c.p || registryOffset >= data.length) throw new Error("invalid registry offset");
  c.p = registryOffset;
  if (c.u8() !== 4) throw new Error("missing plugin registry");
  const count = c.u32(); if (count > 64) throw new Error("oversize registry");
  let attributesOffset: number | null = null;
  for (let i = 0; i < count; i++) {
    const type = c.u8(), authority = c.u8();
    if (authority > 3) throw new Error("unknown authority");
    const authorityAddress = authority === 3 ? decodeAddress(c.take(32)) : null;
    const offset = c.u64();
    if (offset < header + 9 || offset >= registryOffset) throw new Error("invalid plugin offset");
    if (type === 6) {
      if (attributesOffset !== null || !(authority === 2 || (authority === 3 && authorityAddress === config))) throw new Error("invalid attributes authority");
      attributesOffset = offset;
    }
  }
  if (attributesOffset === null) throw new Error("missing attributes");
  const a = new Cursor(data.subarray(attributesOffset, registryOffset));
  if (a.u8() !== 6) throw new Error("invalid attributes variant");
  const size = a.u32(); if (size > 16) throw new Error("oversize attributes");
  const all = new Map<string, string>();
  for (let i = 0; i < size; i++) { const key = a.string(128), value = a.string(1024); if (all.has(key)) throw new Error("duplicate attribute"); all.set(key, value); }
  return ["trait_vector", "mood", "life_stage", "memory_epoch"].filter(k => all.has(k)).map(key => ({ key, value: all.get(key)! }));
}

interface GenesisTransaction { meta: { err: unknown } | null; transaction: { message: { accountKeys: string[];
  instructions: { programIdIndex: number; accounts: number[]; data: string }[] } } }
export async function genesisVector(ns: Namespace, config: string, asset: string, rpc: Rpc, signature?: string) {
  if (!signature) {
    const list = await rpc<{ signature: string }[]>("getSignaturesForAddress", [config, { limit: 1000, commitment: "confirmed" }]);
    // ponytail: bounded first page; older-than-1000 genesis is unavailable.
    signature = list.at(-1)?.signature;
  }
  if (!signature || !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(signature)) throw new Error("genesis unavailable");
  const tx = await rpc<GenesisTransaction | null>("getTransaction", [signature, { encoding: "json", commitment: "confirmed", maxSupportedTransactionVersion: 0 }]);
  if (!tx?.meta || tx.meta.err) throw new Error("invalid genesis transaction");
  const m = tx.transaction.message;
  for (const i of m.instructions) {
    if (m.accountKeys[i.programIdIndex] !== PROGRAM_ID || m.accountKeys[i.accounts[0]] !== ns.ownerId ||
        m.accountKeys[i.accounts[1]] !== config || m.accountKeys[i.accounts[2]] !== asset) continue;
    const b = Buffer.from(getBase58Encoder().encode(i.data));
    if (!b.subarray(0, 8).equals(discriminator("global", "initialize_character"))) continue;
    const c = new Cursor(b); c.take(8);
    if (c.take(8).readBigUInt64LE().toString() !== ns.characterId) throw new Error("wrong birth identity");
    c.take(32); const value = c.string(128);
    if (c.p !== b.length) throw new Error("invalid birth instruction");
    return { value, signature };
  }
  throw new Error("birth instruction unavailable");
}

export async function sealedMemories(root: string, ns: Namespace): Promise<PublicMemory[]> {
  const path = join(root, namespaceDirName(ns), "store.json");
  if ((await stat(path)).size > 8 * 1024 * 1024) throw new Error("store too large for read projection");
  const file = JSON.parse(await readFile(path, "utf8")) as Parameters<typeof validateStoreFile>[0];
  if (file.schema_version !== 1 || file.owner_id !== ns.ownerId || file.character_id !== ns.characterId ||
      !Array.isArray(file.records) || !Array.isArray(file.manifests) || !Number.isSafeInteger(file.next_epoch) || file.next_epoch < 0) throw new Error("invalid store");
  for (const raw of file.records) {
    const r = validateRecord(raw, ns.characterId);
    if (contentHash(r as unknown as Record<string, unknown>) !== r.content_hash) throw new Error("record integrity failure");
  }
  validateStoreFile(file, ns);
  return file.manifests.flatMap(m => m.record_ids.map((id, n) => ({ id, epoch: m.epoch, hash: m.leaf_hashes[n], root: m.root })));
}
export async function readLife(env: NodeJS.ProcessEnv, rpc: Rpc): Promise<LifeSnapshot> {
  const result: LifeSnapshot = { checkedAt: new Date().toISOString(), chain: null, memories: [], chainUnavailable: true, memoriesUnavailable: true, turns: [], receipts: [] };
  let ns: Namespace;
  try { ns = lifeNamespace(env); await deriveIdentity(ns); } catch { return result; }
  await Promise.all([
    (async () => {
      try {
        const state = await readCommitments(ns, rpc);
        const [attributes, birth] = await Promise.all([
          rpc<{ value: Account | null }>("getAccountInfo", [state.asset, { encoding: "base64", commitment: "confirmed", minContextSlot: state.slot }])
            .then(a => coreAttributes(bytes(a.value, CORE), ns.ownerId, state.config)).catch(() => []),
          genesisVector(ns, state.config, state.asset, rpc, env.LIFE_GENESIS_SIGNATURE).catch(() => null),
        ]);
        result.chain = { config: state.config, history: state.history, asset: state.asset, stage: state.stage,
          slot: state.slot, attributes, genesisVector: birth?.value ?? null, genesisSignature: birth?.signature ?? null };
        result.chainUnavailable = false;
      } catch { /* No raw RPC errors/URLs in public data. */ }
    })(),
    (async () => {
      try {
        if (!env.MEMORY_STORE_PATH) return;
        result.memories = (await sealedMemories(env.MEMORY_STORE_PATH, ns)).reverse().slice(0, 20);
        result.memoriesUnavailable = false;
      } catch { /* Never return a partially validated store. */ }
    })(),
  ]);
  return result;
}
export async function readProof(env: NodeJS.ProcessEnv, rpc: Rpc, id: string, tampered = false): Promise<ProofResult> {
  const start = performance.now();
  const done = (status: ProofResult["status"], message: string, extra: Partial<ProofResult> = {}): ProofResult =>
    ({ ...extra, status, message, elapsedMs: Math.round(performance.now() - start) });
  if (!/^[0-9a-f-]{36}$/i.test(id)) return done("not-found", "Memory identifier not found.");
  try {
    const ns = lifeNamespace(env);
    if (!env.MEMORY_STORE_PATH) return done("unavailable", "Memory proof source unavailable. No verdict.");
    const [memories, chain] = await Promise.all([sealedMemories(env.MEMORY_STORE_PATH, ns), readCommitments(ns, rpc)]);
    const memory = memories.find(m => m.id === id);
    if (!memory) return done("not-found", "Sealed memory identifier not found.");
    const entry = chain.entries.find(e => e.epoch === String(memory.epoch));
    if (!entry) return done("not-committed", "Sealed locally, but not yet committed on-chain. No inclusion verdict.");
    const leaves = memories.filter(m => m.epoch === memory.epoch).map(m => Buffer.from(m.hash, "hex"));
    const proof = merkleProof(leaves, Buffer.from(memory.hash, "hex"));
    // Alter one byte in a disposable proof copy, never the store or record.
    if (tampered) proof.leaf = (proof.leaf.startsWith("00") ? "01" : "00") + proof.leaf.slice(2);
    const valid = entry.root === memory.root && verifyProof(entry.root, proof);
    return done(valid ? "valid" : "invalid", valid ? "VALID — inclusion verified against the committed Solana root." : "INVALID — proof does not match the committed root.",
      { root: entry.root, slot: chain.slot, proof });
  } catch { return done("unavailable", "Proof or RPC source unavailable or failed integrity checks. No verdict. Retry."); }
}
