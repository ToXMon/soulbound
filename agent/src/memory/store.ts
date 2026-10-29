// Durable, character-isolated local memory store.
// Layout: <root>/<keccak(owner\ncharacter)>/store.json — opaque dir name means
// identifiers can never traverse the filesystem. Writes are serialized and
// atomic (tmp + fsync + rename). Corrupt history throws; it is never overwritten.
import { mkdir, readFile, rename, rm, writeFile, open } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { keccakHex, contentHash, merkleRoot, merkleProof, verifyProof, type MerkleProof } from "./merkle.js";
import { validateRecord, type ExtractedMemory, type MemoryRecord } from "./schema.js";

export interface Namespace { ownerId: string; characterId: string }
export interface EpochManifest {
  schema_version: 1; algorithm: "keccak256"; record_schema_version: number;
  epoch: number; character_id: string; record_ids: string[]; leaf_hashes: string[]; root: string; sealed_at: string;
}
interface StoreFile {
  schema_version: 1; owner_id: string; character_id: string;
  records: MemoryRecord[]; manifests: EpochManifest[]; processed_jobs: string[]; next_epoch: number;
}

export function validateIdentifier(v: string, name: string): string {
  if (typeof v !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(v) || v === "." || v === ".." || v.includes("/") || v.includes("\\") || v.includes("\0"))
    throw new Error(`${name}: invalid identifier`);
  return v;
}
export const namespaceDirName = (ns: Namespace) => keccakHex(`${validateIdentifier(ns.ownerId, "ownerId")}\n${validateIdentifier(ns.characterId, "characterId")}`);

export class MemoryStore {
  private file: StoreFile;
  private writeChain: Promise<void> = Promise.resolve();
  private constructor(readonly root: string, readonly ns: Namespace, readonly dir: string, file: StoreFile) { this.file = file; }

  static async open(root: string, ns: Namespace): Promise<MemoryStore> {
    validateIdentifier(ns.ownerId, "ownerId"); validateIdentifier(ns.characterId, "characterId");
    const dir = join(root, namespaceDirName(ns));
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const path = join(dir, "store.json");
    let file: StoreFile;
    try {
      const parsed = JSON.parse(await readFile(path, "utf8")) as StoreFile;
      if (parsed.schema_version !== 1 || parsed.owner_id !== ns.ownerId || parsed.character_id !== ns.characterId || !Array.isArray(parsed.records) || !Array.isArray(parsed.manifests) || !Array.isArray(parsed.processed_jobs) || !Number.isInteger(parsed.next_epoch))
        throw new Error("memory store: corrupt or foreign store file (refusing to overwrite)");
      for (const r of parsed.records) {
        validateRecord(r, ns.characterId);
        if (contentHash(r as unknown as Record<string, unknown>) !== r.content_hash) throw new Error(`memory store: record ${r.id} content_hash mismatch (corrupt)`);
      }
      for (const m of parsed.manifests) {
        const root = merkleRoot(m.leaf_hashes.map((h) => Buffer.from(h, "hex")));
        if (!root || root.toString("hex") !== m.root) throw new Error(`memory store: manifest epoch ${m.epoch} root mismatch (corrupt)`);
      }
      file = parsed;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") {
        file = { schema_version: 1, owner_id: ns.ownerId, character_id: ns.characterId, records: [], manifests: [], processed_jobs: [], next_epoch: 0 };
        const s = new MemoryStore(root, ns, dir, file);
        await s.persist();
        return s;
      }
      throw e; // corrupt JSON / validation failure: visible, never silently reset
    }
    return new MemoryStore(root, ns, dir, file);
  }

  private async persist(): Promise<void> {
    const path = join(this.dir, "store.json");
    const tmp = `${path}.${randomUUID()}.tmp`;
    const data = JSON.stringify(this.file, null, 2);
    const fh = await open(tmp, "w", 0o600);
    try { await fh.writeFile(data, "utf8"); await fh.sync(); } finally { await fh.close(); }
    await rename(tmp, path);
  }
  private serialized<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.writeChain.then(fn, fn);
    this.writeChain = run.then(() => undefined, () => undefined);
    return run;
  }

  get records(): readonly MemoryRecord[] { return this.file.records; }
  get manifests(): readonly EpochManifest[] { return this.file.manifests; }
  stats() { return { records: this.file.records.length, epochsSealed: this.file.manifests.length, processedJobs: this.file.processed_jobs.length, nextEpoch: this.file.next_epoch }; }

  /** Append validated extractions. Idempotent on jobKey. Returns created records (empty on replay). */
  async appendExtracted(jobKey: string, items: ExtractedMemory[], now = new Date()): Promise<MemoryRecord[]> {
    return this.serialized(async () => {
      if (this.file.processed_jobs.includes(jobKey)) return [];
      const created: MemoryRecord[] = [];
      for (const item of items) {
        let version = 1;
        if (item.supersedes) {
          const prior = this.file.records.find((r) => r.id === item.supersedes) ?? created.find((r) => r.id === item.supersedes);
          if (!prior) throw new Error(`supersedes target not found in this namespace: ${item.supersedes}`);
          version = prior.version + 1;
        }
        const base = {
          schema_version: 1, id: randomUUID(), character_id: this.ns.characterId,
          epoch: this.file.next_epoch, timestamp: now.toISOString(), type: item.type,
          summary: item.summary, ...(item.trait_delta ? { trait_delta: item.trait_delta } : {}),
          provenance: { turn_ids: [...item.source_turn_ids] },
          confidence: item.confidence, ...(item.supersedes ? { supersedes: item.supersedes } : {}), version,
        };
        const rec = { ...base, content_hash: contentHash(base as Record<string, unknown>) } as MemoryRecord;
        // Order fields canonically for readability; hash is order-independent.
        const ordered = validateRecord({ schema_version: rec.schema_version, id: rec.id, character_id: rec.character_id, epoch: rec.epoch, timestamp: rec.timestamp, type: rec.type, content_hash: rec.content_hash, summary: rec.summary, ...(rec.trait_delta ? { trait_delta: rec.trait_delta } : {}), provenance: rec.provenance, confidence: rec.confidence, ...(rec.supersedes ? { supersedes: rec.supersedes } : {}), version: rec.version });
        created.push(ordered);
      }
      this.file.records.push(...created);
      this.file.processed_jobs.push(jobKey);
      await this.persist(); // persist before acknowledging the job
      return created;
    });
  }

  /** Seal the current open epoch. Empty epoch -> null (no committable root). Sealed epochs are immutable. */
  async sealEpoch(now = new Date()): Promise<EpochManifest | null> {
    return this.serialized(async () => {
      const epoch = this.file.next_epoch;
      const recs = this.file.records.filter((r) => r.epoch === epoch);
      if (recs.length === 0) return null;
      const leaves = recs.map((r) => Buffer.from(r.content_hash, "hex")).sort(Buffer.compare);
      const root = merkleRoot(leaves)!;
      const byHash = new Map(recs.map((r) => [r.content_hash, r.id]));
      const manifest: EpochManifest = {
        schema_version: 1, algorithm: "keccak256", record_schema_version: 1, epoch,
        character_id: this.ns.characterId,
        record_ids: leaves.map((l) => byHash.get(l.toString("hex"))!),
        leaf_hashes: leaves.map((l) => l.toString("hex")),
        root: root.toString("hex"), sealed_at: now.toISOString(),
      };
      this.file.manifests.push(manifest);
      this.file.next_epoch = epoch + 1;
      await this.persist();
      return manifest;
    });
  }

  proofFor(recordId: string): { manifest: EpochManifest; proof: MerkleProof; record: MemoryRecord } {
    const rec = this.file.records.find((r) => r.id === recordId);
    if (!rec) throw new Error(`record not found in this namespace: ${recordId}`);
    const manifest = this.file.manifests.find((m) => m.epoch === rec.epoch);
    if (!manifest) throw new Error(`record ${recordId} is in unsealed epoch ${rec.epoch}`);
    const leaves = manifest.leaf_hashes.map((h) => Buffer.from(h, "hex"));
    return { manifest, proof: merkleProof(leaves, Buffer.from(rec.content_hash, "hex")), record: rec };
  }

  /** Recompute hash from supplied record bytes and verify against the manifest root (REQ-51/52). */
  verifyRecord(record: MemoryRecord): boolean {
    try {
      validateRecord(record, this.ns.characterId);
      if (contentHash(record as unknown as Record<string, unknown>) !== record.content_hash) return false;
      const manifest = this.file.manifests.find((m) => m.epoch === record.epoch);
      if (!manifest || !manifest.leaf_hashes.includes(record.content_hash)) return false;
      const { proof } = this.proofFor(record.id);
      // Proof must be for this record's hash, not merely any leaf.
      return proof.leaf === record.content_hash && verifyProof(manifest.root, proof);
    } catch { return false; }
  }
}
export { verifyProof, merkleProof };
export type { MerkleProof };
