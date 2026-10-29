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

const HEX64 = /^[0-9a-fA-F]{64}$/;
/** Expected proof depth for a sorted tree with odd-node duplication. */
export function expectedDepth(leafCount: number): number {
  let depth = 0, size = leafCount;
  while (size > 1) { size = Math.ceil(size / 2); depth++; }
  return depth;
}

/**
 * Verify a membership proof. Structural metadata is validated strictly
 * (encodings, index/count ranges, exact depth, odd-duplication siblings).
 * NOTE: with sorted-pair hashing, a valid proof authenticates MEMBERSHIP of
 * the leaf in a tree with this root — it does NOT cryptographically
 * authenticate a unique leaf position or total leaf count. leafIndex and
 * leafCount are consistency-checked metadata only; callers must obtain the
 * authoritative count/order from the sealed manifest, not from a proof.
 */
export function verifyProof(rootHex: string, proof: MerkleProof): boolean {
  try {
    if (typeof rootHex !== "string" || !HEX64.test(rootHex)) return false;
    if (!proof || typeof proof !== "object") return false;
    if (typeof proof.leaf !== "string" || !HEX64.test(proof.leaf)) return false;
    if (!Array.isArray(proof.siblings) || proof.siblings.some((s) => typeof s !== "string" || !HEX64.test(s))) return false;
    if (!Number.isInteger(proof.leafCount) || proof.leafCount < 1) return false;
    if (!Number.isInteger(proof.leafIndex) || proof.leafIndex < 0 || proof.leafIndex >= proof.leafCount) return false;
    if (proof.siblings.length !== expectedDepth(proof.leafCount)) return false;
    let node: Buffer = Buffer.from(proof.leaf, "hex");
    let i = proof.leafIndex;
    let levelSize = proof.leafCount;
    for (const s of proof.siblings) {
      const sib = Buffer.from(s, "hex");
      // Odd level: the last node is duplicated, so its sibling must be itself.
      if (levelSize % 2 === 1 && i === levelSize - 1 && !sib.equals(node)) return false;
      node = hashPair(node, sib);
      i = Math.floor(i / 2);
      levelSize = Math.ceil(levelSize / 2);
    }
    return node.toString("hex") === rootHex.toLowerCase();
  } catch { return false; }
}
