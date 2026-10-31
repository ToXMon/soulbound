import { open, readFile, lstat, mkdir, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { address } from "@solana/kit";
import { sha256, validateAttributes, deriveIdentity, PROGRAM_ID, DEVNET_GENESIS, type Snapshot, type Attribute, type TraitIntent, type DreamChain } from "./chain.ts";
import { validateReview, validateConsolidation, CONSOLIDATION_MODEL, type DreamMemory, type Consolidation, type Review } from "./consolidator.ts";
import { WONDER_MODEL } from "./wonder-prompt.ts";

export interface DreamJournal {
  schema_version: 1; fixture: boolean; created_at: string;
  program: string; genesis: string; snapshot: Snapshot;
  memories: DreamMemory[]; models: { consolidation: string; review: string };
  consolidation: Consolidation; review: Review; new_attributes: Attribute[];
}
export function applyChanges(snapshot: Snapshot, review: Review) {
  const changes = new Map(review.changes.map(c => [c.key, c.value]));
  const attrs = snapshot.attributes.map(a => ({ key: a.key, value: changes.get(a.key) ?? a.value }));
  // Lifecycle/epoch are source-of-truth config, not model-authored personality fields.
  for (const a of attrs) {
    if (a.key === "life_stage") a.value = snapshot.lifeStage;
    if (a.key === "memory_epoch") a.value = snapshot.memoryEpoch;
  }
  validateAttributes(attrs); return attrs;
}
export async function validateJournal(j: DreamJournal) {
  if (!j || j.schema_version !== 1 || typeof j.fixture !== "boolean" || !Number.isFinite(Date.parse(j.created_at)) ||
      j.program !== PROGRAM_ID || j.genesis !== DEVNET_GENESIS || j.models?.consolidation !== CONSOLIDATION_MODEL || j.models?.review !== WONDER_MODEL) throw new Error("invalid dream journal envelope");
  const s = j.snapshot;
  if (!s || s.lifeStage !== "born" || !/^(0|[1-9][0-9]*)$/.test(s.revision) || BigInt(s.revision) >= 0xffffffffffffffffn ||
      !/^(0|[1-9][0-9]*)$/.test(s.memoryEpoch) || BigInt(s.memoryEpoch) > 0xffffffffffffffffn || !/^[0-9a-f]{64}$/.test(s.journalHash)) throw new Error("invalid dream snapshot");
  const id = await deriveIdentity({ ownerId: s.owner, characterId: s.characterId });
  if (id.config !== s.config) throw new Error("dream config identity mismatch");
  address(s.asset); address(s.runtime); address(s.payer); validateAttributes(s.attributes);
  if (!Array.isArray(j.memories) || !j.memories.length || j.memories.length > 200 || new Set(j.memories.map(m => m.id)).size !== j.memories.length) throw new Error("invalid dream memory graph");
  for (const m of j.memories) {
    if (!m || typeof m.id !== "string" || !m.id || typeof m.summary !== "string" || !m.summary.trim() || m.summary.length > 500 || !/^[0-9a-f]{64}$/.test(m.content_hash) ||
        !Number.isFinite(Date.parse(m.timestamp)) || (m.supersedes !== undefined && !j.memories.some(prior => prior.id === m.supersedes))) throw new Error("invalid dream memory reference");
  }
  validateConsolidation(j.consolidation, j.memories); validateReview(j.review, j.memories);
  validateAttributes(j.new_attributes);
  if (JSON.stringify(applyChanges(s, j.review)) !== JSON.stringify(j.new_attributes)) throw new Error("journal proposal mismatch");
  return j;
}
export async function privateDirectory(path: string) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const info = await lstat(path);
  if (!info.isDirectory() || (info.mode & 0o077)) throw new Error("dream directory must be private (0700)");
}
export async function writeJournal(path: string, j: DreamJournal) {
  await validateJournal(j);
  if (j.fixture) await mkdir(dirname(path), { recursive: true }); else await privateDirectory(dirname(path));
  // Immutable journal; never overwrite an earlier dream, even after a crash.
  const bytes = JSON.stringify(j, null, 2) + "\n";
  const file = await open(path, "wx", 0o600);
  try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
  const dir = await open(dirname(path), "r"); try { await dir.sync(); } finally { await dir.close(); }
  return sha256(bytes);
}
export async function readJournal(path: string) {
  const info = await lstat(path);
  if (!info.isFile() || (info.mode & 0o077) || info.size > 500_000) throw new Error("journal must be a bounded private regular file (0600)");
  const bytes = await readFile(path);
  const journal = await validateJournal(JSON.parse(bytes.toString("utf8")));
  return { journal, hash: sha256(bytes) };
}
interface Submission { signature: string; lastValidBlockHeight: number; wire: string }
interface Approval { action: string; approvedBy: string; intentHash: string; program: string; genesis: string; expiresAt: string; maximumLamports: number }
export interface TraitChain {
  inspect(i: Snapshot): Promise<Snapshot>;
  simulate(i: TraitIntent): ReturnType<DreamChain["simulate"]>;
  sign(i: TraitIntent, expiresAt?: string): Promise<Submission>;
  broadcast(s: Submission): Promise<void>;
  status(signature: string): Promise<string>;
  finalizedHeight(): Promise<number>;
}
function approve(a: Approval | undefined, intentHash: string, cost = 0) {
  if (!a || a.action !== "evolve_traits" || a.approvedBy !== "Tolu" || a.intentHash !== intentHash || a.program !== PROGRAM_ID || a.genesis !== DEVNET_GENESIS ||
      !Number.isFinite(Date.parse(a.expiresAt)) || Date.parse(a.expiresAt) <= Date.now() || !Number.isSafeInteger(a.maximumLamports) || a.maximumLamports < 1 ||
      !Number.isSafeInteger(cost) || cost < 0 || cost > a.maximumLamports) throw new Error("missing/mismatched/expired Tolu trait approval or exceeded cost cap");
}
async function durable(path: string, data: unknown) {
  const tmp = `${path}.${randomUUID()}.tmp`, file = await open(tmp, "wx", 0o600);
  try { await file.writeFile(JSON.stringify(data)); await file.sync(); } finally { await file.close(); }
  await rename(tmp, path);
  const dir = await open(dirname(path), "r"); try { await dir.sync(); } finally { await dir.close(); }
}
/** Dedicated ledger per journal. Restart reconciles; it NEVER automatically re-signs an earlier attempt,
 * even after expiry. Operator review and a new explicit plan/ledger are required for a retry. */
export async function commitTraits(j: DreamJournal, hash: string, chain: TraitChain, ledger: string, send = false, approval?: Approval) {
  await validateJournal(j);
  if (j.fixture) throw new Error("fixture journal cannot enter the chain path");
  if (!/^[0-9a-f]{64}$/.test(hash) || /^0+$/.test(hash)) throw new Error("invalid journal hash");
  const i: TraitIntent = { ...j.snapshot, journalHash: hash, newAttributes: j.new_attributes };
  const intentHash = sha256(JSON.stringify({ action: "evolve_traits", genesis: DEVNET_GENESIS, program: PROGRAM_ID, ...i }));
  if (send) approve(approval, intentHash);
  if (JSON.stringify(i.attributes) === JSON.stringify(i.newAttributes)) return { state: "no-trait-change", intentHash };
  await privateDirectory(dirname(ledger));
  const lock = await open(`${ledger}.lock`, "wx", 0o600);
  try {
    await lock.writeFile(JSON.stringify({ pid: process.pid })); await lock.sync();
    let old: { intentHash: string; signature: string; lastValidBlockHeight: number; state: string } | undefined;
    try {
      const info = await lstat(ledger);
      if (!info.isFile() || (info.mode & 0o077)) throw new Error("submission ledger must be private regular file");
      old = JSON.parse(await readFile(ledger, "utf8"));
      if (!old || old.intentHash !== intentHash || !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(old.signature) || !Number.isSafeInteger(old.lastValidBlockHeight) || old.lastValidBlockHeight < 0 ||
          !["pending", "confirmed", "error"].includes(old.state)) throw new Error("invalid/conflicting submission ledger");
    } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
    const inspect = async () => {
      const s = await chain.inspect(i);
      for (const k of ["owner", "characterId", "config", "asset", "runtime", "payer", "lifeStage", "memoryEpoch"] as const)
        if (s[k] !== i[k]) throw new Error("chain identity/lifecycle changed; review a new dream");
      return s;
    };
    const accepted = (s: Snapshot) => s.revision === (BigInt(i.revision) + 1n).toString() && s.journalHash === hash && JSON.stringify(s.attributes) === JSON.stringify(i.newAttributes);
    const s = await inspect();
    if (accepted(s)) {
      if (old) { old.state = "confirmed"; await durable(ledger, old); }
      return { state: "confirmed", reconciled: true, signature: old?.signature, intentHash };
    }
    if (s.revision !== i.revision || s.journalHash !== j.snapshot.journalHash || JSON.stringify(s.attributes) !== JSON.stringify(i.attributes)) throw new Error("stale trait snapshot; refetch and review");
    if (old) {
      if (old.state !== "pending") throw new Error("prior submission requires operator review");
      const status = await chain.status(old.signature);
      if (status === "error") { old.state = "error"; await durable(ledger, old); throw new Error("trait transaction failed; review required"); }
      const expired = status === "absent" && await chain.finalizedHeight() > old.lastValidBlockHeight;
      return { state: expired ? "expired-review-required" : "pending", signature: old.signature, intentHash };
    }
    const estimate = await chain.simulate(i);
    if (!send) return { state: "dry-run", intentHash, intent: i, estimate };
    const cost = estimate.feeLamports + estimate.maximumRentLamports;
    if (![estimate.feeLamports, estimate.maximumRentLamports, estimate.balanceLamports].every(n => Number.isSafeInteger(n) && n >= 0) || cost > estimate.balanceLamports) throw new Error("invalid cost estimate or insufficient balance");
    approve(approval, intentHash, cost);
    const refreshed = await inspect();
    if (JSON.stringify(refreshed) !== JSON.stringify(s)) throw new Error("trait state changed during simulation");
    approve(approval, intentHash, cost);
    const submission = await chain.sign(i, approval!.expiresAt);
    const record = { intentHash, signature: submission.signature, lastValidBlockHeight: submission.lastValidBlockHeight, state: "pending" };
    await durable(ledger, record); // durable signature BEFORE network side effects
    try { await chain.broadcast(submission); } catch { /* ambiguous: reconcile without automatic resend */ }
    if (accepted(await inspect())) { record.state = "confirmed"; await durable(ledger, record); return { state: "confirmed", signature: record.signature, intentHash }; }
    const status = await chain.status(submission.signature);
    if (status === "error") { record.state = "error"; await durable(ledger, record); throw new Error("trait transaction failed; review required"); }
    return { state: "pending", signature: record.signature, intentHash };
  } finally { await lock.close(); await rm(`${ledger}.lock`, { force: true }); }
}
