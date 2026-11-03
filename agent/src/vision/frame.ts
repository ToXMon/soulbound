// Ticket 008. Frame hashing and discard. Project convention is Keccak-256
// (agent/src/memory/merkle.ts uses js-sha3 keccak_256); the locked agent
// dependency is reused. No fallback algorithm: if the pinned dependency is
// missing, frame processing is blocked, never silently re-algorithmed.
import { createRequire } from "node:module";

export class VisionUnavailable extends Error {}

type Keccak = (data: Uint8Array) => string;
let cached: Keccak | null | undefined;

function keccak(): Keccak {
  if (cached !== undefined && cached !== null) return cached;
  try {
    const req = createRequire(import.meta.url);
    const mod = req("js-sha3") as { keccak_256: Keccak };
    cached = mod.keccak_256;
  } catch {
    cached = null;
  }
  if (!cached) {
    throw new VisionUnavailable(
      "js-sha3 (pinned agent dependency) is not installed; run the pinned package install before vision processing",
    );
  }
  return cached;
}

/** keccak-256 of the exact frame bytes. Throws VisionUnavailable if the pinned
 * hasher dependency is missing. */
export function frameHashHex(frame: Uint8Array): string {
  if (!(frame instanceof Uint8Array) || frame.length === 0) throw new VisionUnavailable("empty frame");
  return keccak()(frame);
}

/** Best-effort zero-fill discard. Caller must not retain other references;
 * the returned record carries only hash/mask metadata. */
export function discardFrame(frame: Uint8Array): void {
  frame.fill(0);
}
