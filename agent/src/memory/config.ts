// Opt-in memory configuration. Disabled = current voice loop untouched.
// Enabled but missing identity/storage is a startup configuration error.
import type { Namespace } from "./store.js";
import { validateIdentifier } from "./store.js";

export interface MemoryConfig { storePath: string; namespace: Namespace; capacity: number; timeoutMs: number }

export function memoryConfigFromEnv(env: NodeJS.ProcessEnv = process.env): MemoryConfig | null {
  const enabled = (env.MEMORY_ENABLED ?? "").toLowerCase();
  if (enabled !== "true" && enabled !== "1") return null;
  const storePath = env.MEMORY_STORE_PATH?.trim();
  const ownerId = env.MEMORY_OWNER_ID?.trim();
  const characterId = env.MEMORY_CHARACTER_ID?.trim();
  if (!storePath || !ownerId || !characterId)
    throw new Error("MEMORY_ENABLED is set but MEMORY_STORE_PATH, MEMORY_OWNER_ID and MEMORY_CHARACTER_ID are all required");
  validateIdentifier(ownerId, "MEMORY_OWNER_ID");
  validateIdentifier(characterId, "MEMORY_CHARACTER_ID");
  const capacity = Number(env.MEMORY_QUEUE_CAPACITY ?? 16);
  const timeoutMs = Number(env.MEMORY_JOB_TIMEOUT_MS ?? 30_000);
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 1000) throw new Error("MEMORY_QUEUE_CAPACITY must be an integer in [1,1000]");
  if (!Number.isFinite(timeoutMs) || timeoutMs < 100 || timeoutMs > 300_000) throw new Error("MEMORY_JOB_TIMEOUT_MS must be in [100,300000]");
  return { storePath, namespace: { ownerId, characterId }, capacity, timeoutMs };
}
