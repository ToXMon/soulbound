// Explicit operator recovery only. No key creation or automatic rotation.
import { open, mkdir, lstat, readFile, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { address } from "@solana/kit";
import { PROGRAM_ID, DEVNET_GENESIS, deriveIdentity, checkState, type ChainState, type Submission } from "./committer.js";

export interface RotationIntent {
  owner: string; characterId: string; config: string; history: string;
  expectedRuntime: string; replacement: string; payer: string;
}
export interface RotationEstimate { feeLamports: number; balanceLamports: number; maximumHistoryRentLamports: number; units?: number }
export interface RotationApproval extends RotationIntent {
  action: "rotate_runtime_signer"; program: string; genesis: string;
  approvedBy: "Tolu"; expiresAt: string; maximumLamports: number;
}
export interface RotationChain {
  inspect(i: RotationIntent): Promise<ChainState>;
  simulateRotation(i: RotationIntent): Promise<RotationEstimate>;
  signRotation(i: RotationIntent): Promise<Submission>;
  broadcast(s: Submission): Promise<void>;
  status(signature: string): Promise<"absent" | "pending" | "confirmed" | "error">;
  finalizedHeight(): Promise<number>;
}
interface RotationJournal {
  schema: 1; action: "rotate_runtime_signer"; genesis: string; program: string;
  intent: RotationIntent; state: "pending" | "confirmed" | "error";
  signature: string; lastValidBlockHeight: number;
}
export function validateRotationApproval(i: RotationIntent, a: RotationApproval | undefined, fee?: number) {
  if (!a || a.action !== "rotate_runtime_signer" || a.approvedBy !== "Tolu" || a.program !== PROGRAM_ID || a.genesis !== DEVNET_GENESIS)
    throw new Error("explicit Tolu rotation approval required");
  for (const [key, value] of Object.entries(i)) if (a[key as keyof RotationApproval] !== value) throw new Error(`rotation approval mismatch: ${key}`);
  if (!Number.isFinite(Date.parse(a.expiresAt)) || Date.parse(a.expiresAt) <= Date.now() || !Number.isSafeInteger(a.maximumLamports) || a.maximumLamports < 1)
    throw new Error("invalid/expired rotation approval");
  if (fee !== undefined && (!Number.isSafeInteger(fee) || fee < 0 || fee > a.maximumLamports)) throw new Error("rotation fee exceeds approved cap");
}
async function save(path: string, value: RotationJournal) {
  const tmp = `${path}.${randomUUID()}.tmp`;
  const file = await open(tmp, "wx", 0o600);
  try { await file.writeFile(JSON.stringify(value)); await file.sync(); } finally { await file.close(); }
  await rename(tmp, path);
  const dir = await open(dirname(path), "r"); try { await dir.sync(); } finally { await dir.close(); }
}
/** A dedicated journal per exact rotation. Restart reconciles before any retry.
 * Stale lock after a crash fails closed; operator checks pid before removing it. */
export async function rotateRuntimeSigner(i: RotationIntent, chain: RotationChain, journalPath: string, send = false, approval?: RotationApproval) {
  const expected = await deriveIdentity({ ownerId: i.owner, characterId: i.characterId });
  if (i.config !== expected.config || i.history !== expected.history) throw new Error("rotation config/history PDA mismatch");
  address(i.expectedRuntime); address(i.replacement); address(i.payer);
  if (i.expectedRuntime === i.replacement) throw new Error("rotation no-op refused");
  if (send) validateRotationApproval(i, approval);
  await mkdir(dirname(journalPath), { recursive: true, mode: 0o700 });
  const directory = await lstat(dirname(journalPath));
  if (!directory.isDirectory() || (directory.mode & 0o077)) throw new Error("rotation journal directory must be private (0700)");
  const lockPath = `${journalPath}.lock`;
  const lock = await open(lockPath, "wx", 0o600);
  try {
    await lock.writeFile(JSON.stringify({ pid: process.pid })); await lock.sync();
    let old: RotationJournal | undefined;
    try {
      const info = await lstat(journalPath);
      if (!info.isFile() || (info.mode & 0o077)) throw new Error("rotation journal must be a private regular file (0600)");
      old = JSON.parse(await readFile(journalPath, "utf8"));
      if (!old || old.schema !== 1 || old.action !== "rotate_runtime_signer" || old.genesis !== DEVNET_GENESIS || old.program !== PROGRAM_ID ||
          !["pending", "confirmed", "error"].includes(old.state) || typeof old.signature !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(old.signature) ||
          !Number.isSafeInteger(old.lastValidBlockHeight) || old.lastValidBlockHeight < 0) throw new Error("corrupt rotation journal");
      for (const [key, value] of Object.entries(i)) if (old.intent?.[key as keyof RotationIntent] !== value) throw new Error("rotation journal intent conflict");
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    const inspect = async () => {
      const state = await chain.inspect(i);
      checkState(state, { owner: i.owner, characterId: i.characterId, runtime: state.runtime });
      if (![i.expectedRuntime, i.replacement].includes(state.runtime)) throw new Error("rotation current signer conflicts with approved intent");
      return state;
    };
    const state = await inspect();
    if (state.runtime === i.replacement) {
      if (old) { old.state = "confirmed"; await save(journalPath, old); }
      return { state: "confirmed", reconciled: true, signature: old?.signature };
    }
    if (old) {
      if (old.state === "confirmed") throw new Error("previously confirmed rotation missing from chain");
      if (old.state === "error") throw new Error("rotation transaction failed; operator review required");
      const status = await chain.status(old.signature);
      if (status === "error") { old.state = "error"; await save(journalPath, old); throw new Error("rotation transaction failed; operator review required"); }
      if (status !== "absent" || await chain.finalizedHeight() <= old.lastValidBlockHeight) return { state: "pending", signature: old.signature };
      // Only an expired, absent transaction + unchanged current signer permits a new approved attempt.
      if ((await inspect()).runtime === i.replacement) {
        old.state = "confirmed"; await save(journalPath, old);
        return { state: "confirmed", reconciled: true, signature: old.signature };
      }
    }
    const estimate = await chain.simulateRotation(i);
    if (!send) return { state: "dry-run", estimate };
    validateRotationApproval(i, approval, estimate.feeLamports);
    if (!Number.isSafeInteger(estimate.balanceLamports) || estimate.balanceLamports < estimate.feeLamports || estimate.maximumHistoryRentLamports !== 0)
      throw new Error("rotation balance/rent estimate invalid");
    // Refresh identity after simulation; never authorize a stale expected-signer plan.
    if ((await inspect()).runtime === i.replacement) return { state: "confirmed", reconciled: true };
    validateRotationApproval(i, approval, estimate.feeLamports);
    const submission = await chain.signRotation(i);
    const journal: RotationJournal = { schema: 1, action: "rotate_runtime_signer", genesis: DEVNET_GENESIS, program: PROGRAM_ID,
      intent: i, state: "pending", signature: submission.signature, lastValidBlockHeight: submission.lastValidBlockHeight };
    await save(journalPath, journal); // durable signature BEFORE any broadcast
    try { await chain.broadcast(submission); } catch { /* ambiguous: read back, do not blindly resend */ }
    if ((await inspect()).runtime === i.replacement) {
      journal.state = "confirmed"; await save(journalPath, journal);
      return { state: "confirmed", signature: submission.signature };
    }
    if (await chain.status(submission.signature) === "error") {
      journal.state = "error"; await save(journalPath, journal); throw new Error("rotation transaction failed; operator review required");
    }
    return { state: "pending", signature: submission.signature };
  } finally { await lock.close(); await rm(lockPath, { force: true }); }
}
