// Keccak-256 (NOT Node sha3-256) hashing + deterministic Merkle protocol.
// Spec: docs/memory-schema.md — frozen for Ticket 005.
import { keccak_256 } from "js-sha3";
import { canonicalJson } from "./canonical.js";

export function keccak256(data: string | Uint8Array): Buffer {
  const bytes = typeof data === "string" ? Buffer.from(data, "utf8") : Buffer.from(data);
  return Buffer.from(keccak_256.arrayBuffer(bytes) as ArrayBuffer);
}
export const keccakHex = (d: string | Uint8Array): string => keccak256(d).toString("hex");

/** content_hash = keccak256(canonical JSON of record excluding content_hash). */
export function contentHash(record: Record<string, unknown>): string {
  const { content_hash: _omit, ...rest } = record;
  return keccakHex(canonicalJson(rest));
}

const isHash = (b: Buffer) => b.length === 32;

/** Leaves sorted ascending (byte order); duplicate hashes are kept as separate leaves. */
export function sortLeaves(leaves: Buffer[]): Buffer[] {
  for (const l of leaves) if (!isHash(l)) throw new Error("leaf must be 32 bytes");
  return [...leaves].sort(Buffer.compare);
}

function hashPair(a: Buffer, b: Buffer): Buffer {
  const [lo, hi] = Buffer.compare(a, b) <= 0 ? [a, b] : [b, a];
  return keccak256(Buffer.concat([lo, hi]));
}

/** Sorted-leaf Merkle root. Empty batch -> null (no committable root). Single leaf -> leaf. Odd level duplicates last. */
export function merkleRoot(leaves: Buffer[]): Buffer | null {
  if (leaves.length === 0) return null;
  let level = sortLeaves(leaves);
  if (level.length === 1) return level[0];
  while (level.length > 1) {
    const next: Buffer[] = [];
    for (let i = 0; i < level.length; i += 2) next.push(hashPair(level[i], level[i + 1] ?? level[i]));
    level = next;
  }
  return level[0];
}

export interface MerkleProof { leaf: string; siblings: string[]; leafIndex: number; leafCount: number }

/** Inclusion proof over the sorted leaf list. siblings bottom-up; odd duplication is implicit. */
export function merkleProof(leaves: Buffer[], leaf: Buffer): MerkleProof {
  const sorted = sortLeaves(leaves);
  let idx = sorted.findIndex((l) => l.equals(leaf));
  if (idx < 0) throw new Error("leaf not in batch");
  const siblings: string[] = [];
  let level = sorted;
  let i = idx;
  while (level.length > 1) {
    const sib = i % 2 === 0 ? (level[i + 1] ?? level[i]) : level[i - 1];
    siblings.push(sib.toString("hex"));
    const next: Buffer[] = [];
    for (let j = 0; j < level.length; j += 2) next.push(hashPair(level[j], level[j + 1] ?? level[j]));
    i = Math.floor(i / 2);
    level = next;
  }
  return { leaf: leaf.toString("hex"), siblings, leafIndex: idx, leafCount: sorted.length };
}

export function verifyProof(rootHex: string, proof: MerkleProof): boolean {
  try {
    let node: Buffer = Buffer.from(proof.leaf, "hex");
    if (!isHash(node)) return false;
    let i = proof.leafIndex;
    for (const s of proof.siblings) {
      const sib = Buffer.from(s, "hex");
      if (!isHash(sib)) return false;
      node = hashPair(node, sib);
      i = Math.floor(i / 2);
    }
    // Single-leaf tree has no siblings; root must equal leaf.
    return node.toString("hex") === rootHex.toLowerCase();
  } catch { return false; }
}
