// Server-only transport to the operator's loopback read service. Never use a
// NEXT_PUBLIC variable: private RPC URLs and storage paths stay off the browser.
import type { LifeSnapshot, ProofResult } from "../../../agent/src/life-read";
export type { LifeSnapshot, ProofResult };

async function read(path: string, timeout: number): Promise<unknown> {
  const base = new URL(process.env.LIFE_READ_URL ?? "http://127.0.0.1:8787");
  if (base.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(base.hostname) || base.username || base.password)
    throw new Error("Read service must be loopback HTTP");
  const response = await fetch(new URL(path, base), { cache: "no-store", signal: AbortSignal.timeout(timeout) });
  if (!response.ok) throw new Error("Read service unavailable");
  return response.json();
}
export async function getLife(): Promise<LifeSnapshot | null> {
  try {
    const data = await read("/life", 5000) as LifeSnapshot;
    if (!data || !Array.isArray(data.memories) || !Array.isArray(data.turns) || !Array.isArray(data.receipts) ||
        typeof data.checkedAt !== "string" || typeof data.chainUnavailable !== "boolean" || typeof data.memoriesUnavailable !== "boolean") return null;
    return data;
  } catch { return null; }
}
export async function getProof(id: string, tampered: boolean): Promise<ProofResult> {
  const data = await read("/proof?id=" + encodeURIComponent(id) + "&tampered=" + Number(tampered), 1650) as ProofResult;
  if (!data || !["valid", "invalid", "unavailable", "not-committed", "not-found"].includes(data.status) ||
      typeof data.message !== "string" || !Number.isFinite(data.elapsedMs)) throw new Error("Invalid proof response");
  // Explicit projection: never proxy an arbitrary upstream object to the public.
  return { status: data.status, message: data.message, elapsedMs: data.elapsedMs,
    ...(data.root && /^[0-9a-f]{64}$/.test(data.root) ? { root: data.root } : {}),
    ...(Number.isSafeInteger(data.slot) ? { slot: data.slot } : {}),
    ...(data.proof ? { proof: { leaf: data.proof.leaf, siblings: data.proof.siblings,
      leafCount: data.proof.leafCount, leafIndex: data.proof.leafIndex } } : {}) };
}
