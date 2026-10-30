// Ticket 005. Operator-only process; deliberately never imported by index.ts.
import { open, readFile, rename, rm, mkdir, lstat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { address, getAddressEncoder, getProgramDerivedAddress } from "@solana/kit";
import { MemoryStore, type Namespace } from "./store.js";
import { contentHash } from "./merkle.js";

export const PROGRAM_ID = "BdswGigVwzuRjcbj2XMsNHTGB37pCaPQquq8v1tAqJZd";
export const DEVNET_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
export const HISTORY_SIZE = 6189;
export const discriminator = (kind: string, name: string) => createHash("sha256").update(`${kind}:${name}`).digest().subarray(0, 8);
export function decimalU64(value: string): bigint {
  if (!/^(0|[1-9][0-9]*)$/.test(value) || BigInt(value) > 0xffffffffffffffffn)
    throw new Error("character/epoch ID must be canonical decimal u64; aliases require explicit identity reconciliation");
  return BigInt(value);
}
export function rootBytes(hex: string): Buffer {
  if (typeof hex !== "string" || !/^[0-9a-fA-F]{64}$/.test(hex) || /^0{64}$/.test(hex)) throw new Error("root must be nonzero 64-char hex");
  return Buffer.from(hex, "hex"); // Never hash the hex text.
}
export async function deriveIdentity(ns: Namespace) {
  const owner = address(ns.ownerId), id = decimalU64(ns.characterId);
  const bytes = Buffer.alloc(8); bytes.writeBigUInt64LE(id);
  const [config, configBump] = await getProgramDerivedAddress({ programAddress: address(PROGRAM_ID), seeds: [Buffer.from("character"), getAddressEncoder().encode(owner), bytes] });
  const [history, historyBump] = await getProgramDerivedAddress({ programAddress: address(PROGRAM_ID), seeds: [Buffer.from("memory_roots"), getAddressEncoder().encode(config)] });
  return { config, history, configBump, historyBump };
}
export interface Intent { owner: string; characterId: string; config: string; history: string; runtime: string; payer: string; epoch: string; root: string }
/** Must be called with a freshly opened (validated, exclusively locked) 004 store. */
export async function prepareIntent(store: MemoryStore, epochText: string, runtime: string, payer: string): Promise<Intent> {
  const identity = await deriveIdentity(store.ns);
  address(runtime); address(payer);
  const epoch = decimalU64(epochText);
  if (epoch > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("004 manifest epochs must be safe integers");
  const manifest = store.manifests.find((m) => m.epoch === Number(epoch));
  if (!manifest || !manifest.record_ids.length) throw new Error("empty/unsealed epoch refused");
  // Reuse 004's authoritative schema/mapping/proof validation; also recompute
  // record bytes here, rather than trusting mutable in-memory hash fields.
  for (const id of manifest.record_ids) {
    const { record } = store.proofFor(id);
    if (contentHash(record as unknown as Record<string, unknown>) !== record.content_hash || !store.verifyRecord(record))
      throw new Error("manifest record/proof validation failed");
  }
  rootBytes(manifest.root);
  return { owner: store.ns.ownerId, characterId: store.ns.characterId, config: identity.config, history: identity.history,
    runtime, payer, epoch: epochText, root: manifest.root.toLowerCase() };
}
export interface ChainState {
  genesis: string; executable: boolean; program: string; owner: string; characterId: string; runtime: string;
  entries: { epoch: string; root: string }[];
}
export interface Submission { signature: string; lastValidBlockHeight: number; wire: string }
export interface Chain {
  inspect(intent: Intent): Promise<ChainState>;
  simulate(intent: Intent): Promise<unknown>;
  sign(intent: Intent): Promise<Submission>;
  broadcast(submission: Submission): Promise<void>;
  status(signature: string): Promise<"absent" | "pending" | "confirmed" | "error">;
  finalizedHeight(): Promise<number>;
}
interface JournalEntry { root: string; state: "pending" | "confirmed" | "error"; signature?: string; lastValidBlockHeight?: number }
interface Journal { schema: 1; entries: Record<string, JournalEntry> }
export function checkState(s: ChainState, i: Pick<Intent, "owner" | "characterId" | "runtime">) {
  if (s.genesis !== DEVNET_GENESIS) throw new Error("wrong cluster: devnet genesis required");
  if (!s.executable || s.program !== PROGRAM_ID) throw new Error("wrong/non-executable program");
  if (s.owner !== i.owner || s.characterId !== i.characterId) throw new Error("on-chain config identity mismatch");
  if (s.runtime !== i.runtime) throw new Error("runtime signer mismatch");
  let previous = -1n;
  for (const entry of s.entries) {
    const epoch = decimalU64(entry.epoch); rootBytes(entry.root);
    if (epoch <= previous) throw new Error("invalid history order"); previous = epoch;
  }
}
async function save(path: string, journal: Journal) {
  const tmp = `${path}.${randomUUID()}.tmp`;
  const fh = await open(tmp, "wx", 0o600);
  try { await fh.writeFile(JSON.stringify(journal)); await fh.sync(); } finally { await fh.close(); }
  await rename(tmp, path);
  const dir = await open(dirname(path), "r"); try { await dir.sync(); } finally { await dir.close(); }
}
/** One logical attempt per invocation. No blind send retries. The exclusive journal
 * lock serializes ALL namespaces sharing this journal; crashes fail closed until
 * the operator verifies/removes the stale lock. Store lock remains held by CLI. */
export async function commitMemoryRoot(intent: Intent, chain: Chain, journalPath: string, send = false) {
  const expected = await deriveIdentity({ ownerId: intent.owner, characterId: intent.characterId });
  if (intent.config !== expected.config || intent.history !== expected.history) throw new Error("PDA identity mismatch");
  address(intent.runtime); address(intent.payer); decimalU64(intent.epoch); rootBytes(intent.root);
  await mkdir(dirname(journalPath), { recursive: true, mode: 0o700 });
  const directory = await lstat(dirname(journalPath));
  if (!directory.isDirectory() || (directory.mode & 0o077) !== 0) throw new Error("journal directory must be private (0700); permissions are never silently changed");
  const lockPath = join(dirname(journalPath), `${createHash("sha256").update(journalPath).digest("hex")}.lock`);
  const lock = await open(lockPath, "wx", 0o600);
  try {
    await lock.writeFile(JSON.stringify({ pid: process.pid })); await lock.sync();
    let journal: Journal;
    try {
      const file = await lstat(journalPath);
      if (!file.isFile() || (file.mode & 0o077) !== 0) throw new Error("journal must be a private regular file (0600)");
      journal = JSON.parse(await readFile(journalPath, "utf8"));
    }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; journal = { schema: 1, entries: {} }; }
    if (journal.schema !== 1 || !journal.entries || typeof journal.entries !== "object" || Array.isArray(journal.entries)) throw new Error("corrupt submission journal");
    const state = await chain.inspect(intent); checkState(state, intent);
    const prefix = `${state.genesis}:${intent.config}:`;
    const key = `${prefix}${intent.epoch}`;
    const old = journal.entries[key];
    if (old && old.root !== intent.root) throw new Error("journal root conflict");
    // Reconcile every earlier journal entry too, even when the chain advanced.
    for (const [k, entry] of Object.entries(journal.entries)) {
      rootBytes(entry.root);
      if (!["pending", "confirmed", "error"].includes(entry.state) || (entry.signature !== undefined &&
          (typeof entry.signature !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(entry.signature) || !Number.isSafeInteger(entry.lastValidBlockHeight)))) throw new Error("corrupt submission journal entry");
      if (!k.startsWith(prefix)) continue;
      const epoch = k.slice(prefix.length); decimalU64(epoch);
      const found = state.entries.find((e) => e.epoch === epoch);
      if (found && found.root !== entry.root) throw new Error(`on-chain root conflict at epoch ${epoch}`);
      if (found) entry.state = "confirmed";
      else if (entry.state === "confirmed") throw new Error("confirmed journal entry missing from chain");
    }
    const found = state.entries.find((e) => e.epoch === intent.epoch);
    if (found) {
      if (found.root !== intent.root) throw new Error("on-chain root conflict");
      journal.entries[key] = { ...old, root: intent.root, state: "confirmed" };
      await save(journalPath, journal);
      return { state: "confirmed", reconciled: true, signature: old?.signature };
    }
    if (old?.signature) {
      if (old.state === "error") throw new Error("prior transaction failed; operator review required");
      const status = await chain.status(old.signature);
      if (status === "error") {
        old.state = "error"; await save(journalPath, journal); throw new Error("prior transaction failed; operator review required");
      }
      if (status !== "absent" || await chain.finalizedHeight() <= old.lastValidBlockHeight!) {
        await save(journalPath, journal);
        return { state: "pending", signature: old.signature }; // Never re-sign while still viable.
      }
      // Expired at FINALIZED height + absent signature + absent history: only
      // a subsequent explicit --send may sign a replacement.
    }
    if (state.entries.length >= 128) throw new Error("history full");
    if (state.entries.some((e) => BigInt(e.epoch) >= BigInt(intent.epoch))) throw new Error("epoch regressed behind chain history");
    const simulation = await chain.simulate(intent);
    if (!send) { await save(journalPath, journal); return { state: "dry-run", simulation }; }
    const submission = await chain.sign(intent);
    journal.entries[key] = { root: intent.root, state: "pending", signature: submission.signature, lastValidBlockHeight: submission.lastValidBlockHeight };
    await save(journalPath, journal); // signature durable BEFORE network side effects
    try { await chain.broadcast(submission); } catch { /* ambiguous: inspect, never blindly retry */ }
    const after = await chain.inspect(intent); checkState(after, intent);
    const accepted = after.entries.find((e) => e.epoch === intent.epoch);
    if (accepted && accepted.root !== intent.root) throw new Error("on-chain root conflict after send");
    if (accepted) {
      journal.entries[key].state = "confirmed"; await save(journalPath, journal);
      return { state: "confirmed", signature: submission.signature };
    }
    const status = await chain.status(submission.signature);
    if (status === "error") { journal.entries[key].state = "error"; await save(journalPath, journal); throw new Error("transaction failed; operator review required"); }
    return { state: "pending", signature: submission.signature }; // confirmation alone is NOT readback
  } finally { await lock.close(); await rm(lockPath, { force: true }); }
}
