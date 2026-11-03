// Ticket 008. Private per-character vision provenance sidecar.
//
// The frozen Ticket 004 MemoryRecord schema carries only
// provenance.turn_ids + optional provenance.frame_hash, so the full REQ-44
// vision provenance (mask reference, observation timestamp, trigger id) lives
// here, keyed by the memory record id created through the unchanged store
// path. Scope decision: docs/008-scope-amendment.md (main checkout).
//
// Privacy boundary: metadata ONLY — record id, character id, frame hash, mask
// reference, timestamp, trigger id. Raw frame bytes, mask bitmaps/payloads,
// base64, and transcripts are never fields here (validation rejects unknown
// fields, so they cannot be smuggled in). Local/private; never placed
// on-chain — the on-chain boundary stays the committed memory hashes/roots.
// Same opaque namespace directory as MemoryStore, same atomic write pattern
// (tmp + fsync + rename), same corrupt-file posture (throw, never overwrite).
import { mkdir, open, readFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { namespaceDirName, validateIdentifier, type Namespace } from "./store.js";

export const VISION_SIDECAR_SCHEMA_VERSION = 1;
export const VISION_SIDECAR_FILE = "vision-sidecar.json";
/** Upper bound on linked observations per character (spam/corruption bound). */
export const MAX_SIDECAR_ENTRIES = 10_000;
/** Upper bound on the serialized sidecar file ( Sybil/bloat bound). */
export const MAX_SIDECAR_BYTES = 8_000_000;

const HEX64 = /^[0-9a-f]{64}$/;
const PRINTABLE_RE = /^[ -~]+$/;

export interface VisionSidecarEntry {
  schema_version: 1;
  /** Memory record id this provenance belongs to (the store-assigned id). */
  record_id: string;
  character_id: string;
  /** keccak-256 of the exact frame bytes sent to SAM/Spark. */
  frame_hash: string;
  /** SAM mask reference (mask id); never mask bytes. */
  mask_ref: string;
  /** ISO-8601 observation time. */
  timestamp: string;
  /** Trigger id of the explicit "look at this" event. */
  trigger_id: string;
}

const ENTRY_KEYS = [
  "schema_version",
  "record_id",
  "character_id",
  "frame_hash",
  "mask_ref",
  "timestamp",
  "trigger_id",
] as const;

function isRecordId(v: unknown): v is string {
  return typeof v === "string" && !!v && v.length <= 128 && PRINTABLE_RE.test(v);
}

/** Strict entry validation. Throws; never coerces. Rejects unknown fields so
 * frame/mask bytes, base64, or transcripts cannot be stored here. */
export function validateSidecarEntry(raw: unknown, expectedCharacterId?: string): VisionSidecarEntry {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("sidecar entry: must be an object");
  const o = raw as Record<string, unknown>;
  for (const k of Object.keys(o)) {
    if (!(ENTRY_KEYS as readonly string[]).includes(k)) throw new Error(`sidecar entry: unknown field "${k}"`);
  }
  for (const k of ENTRY_KEYS) if (!(k in o)) throw new Error(`sidecar entry: missing "${k}"`);
  if (o.schema_version !== VISION_SIDECAR_SCHEMA_VERSION) throw new Error("sidecar entry: bad schema_version");
  if (!isRecordId(o.record_id)) throw new Error("sidecar entry: bad record_id");
  if (typeof o.character_id !== "string" || !o.character_id) throw new Error("sidecar entry: bad character_id");
  validateIdentifier(o.character_id, "character_id");
  if (expectedCharacterId && o.character_id !== expectedCharacterId) {
    throw new Error("sidecar entry: character_id does not match namespace");
  }
  if (typeof o.frame_hash !== "string" || !HEX64.test(o.frame_hash)) throw new Error("sidecar entry: bad frame_hash");
  if (typeof o.mask_ref !== "string" || !o.mask_ref.length || o.mask_ref.length > 256) {
    throw new Error("sidecar entry: bad mask_ref");
  }
  if (typeof o.timestamp !== "string" || Number.isNaN(Date.parse(o.timestamp))) {
    throw new Error("sidecar entry: bad timestamp");
  }
  if (typeof o.trigger_id !== "string" || !o.trigger_id || o.trigger_id.length > 128 || !PRINTABLE_RE.test(o.trigger_id)) {
    throw new Error("sidecar entry: bad trigger_id");
  }
  return o as unknown as VisionSidecarEntry;
}

interface SidecarFile {
  schema_version: 1;
  owner_id: string;
  character_id: string;
  entries: VisionSidecarEntry[];
}

function validateSidecarFile(file: SidecarFile, ns: Namespace): void {
  if (!file || typeof file !== "object") throw new Error("vision sidecar: corrupt file (not an object)");
  for (const k of Object.keys(file)) {
    if (!["schema_version", "owner_id", "character_id", "entries"].includes(k)) {
      throw new Error(`vision sidecar: corrupt file (unknown field "${k}")`);
    }
  }
  if (file.schema_version !== 1 || file.owner_id !== ns.ownerId || file.character_id !== ns.characterId) {
    throw new Error("vision sidecar: corrupt file (schema/namespace mismatch)");
  }
  if (!Array.isArray(file.entries) || file.entries.length > MAX_SIDECAR_ENTRIES) {
    throw new Error("vision sidecar: corrupt file (entries out of bounds)");
  }
  const seen = new Set<string>();
  for (const e of file.entries) {
    const v = validateSidecarEntry(e, ns.characterId);
    if (seen.has(v.record_id)) throw new Error(`vision sidecar: corrupt file (duplicate record_id ${v.record_id})`);
    seen.add(v.record_id);
  }
}

export class VisionSidecarStore {
  private file: SidecarFile;
  private writeChain: Promise<void> = Promise.resolve();
  private constructor(readonly root: string, readonly ns: Namespace, readonly dir: string, file: SidecarFile) {
    this.file = file;
  }

  static async open(root: string, ns: Namespace): Promise<VisionSidecarStore> {
    validateIdentifier(ns.ownerId, "ownerId");
    validateIdentifier(ns.characterId, "characterId");
    const dir = join(root, namespaceDirName(ns));
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const path = join(dir, VISION_SIDECAR_FILE);
    let file: SidecarFile;
    try {
      const parsed = JSON.parse(await readFile(path, "utf8")) as SidecarFile;
      validateSidecarFile(parsed, ns);
      file = parsed;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") {
        file = { schema_version: 1, owner_id: ns.ownerId, character_id: ns.characterId, entries: [] };
        const s = new VisionSidecarStore(root, ns, dir, file);
        await s.persist();
        return s;
      }
      throw e; // corrupt history: fail visibly, never rewrite
    }
    return new VisionSidecarStore(root, ns, dir, file);
  }

  private async persist(): Promise<void> {
    const path = join(this.dir, VISION_SIDECAR_FILE);
    const data = JSON.stringify(this.file, null, 2);
    if (data.length > MAX_SIDECAR_BYTES) throw new Error("vision sidecar: file size bound exceeded");
    const tmp = `${path}.${randomUUID()}.tmp`;
    const fh = await open(tmp, "w", 0o600);
    try {
      await fh.writeFile(data, "utf8");
      await fh.sync();
    } finally {
      await fh.close();
    }
    await rename(tmp, path);
  }

  private serialized<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.writeChain.then(fn, fn);
    this.writeChain = run.then(() => undefined, () => undefined);
    return run;
  }

  /** Link provenance to a memory record id. Idempotent for the identical entry;
   * a conflicting entry for the same record id throws (tamper signal). */
  async link(raw: VisionSidecarEntry): Promise<void> {
    const entry = validateSidecarEntry(raw, this.ns.characterId);
    return this.serialized(async () => {
      const prior = this.file.entries.find((e) => e.record_id === entry.record_id);
      if (prior) {
        if (JSON.stringify(prior) !== JSON.stringify(entry)) {
          throw new Error(`vision sidecar: conflicting entry for record ${entry.record_id}`);
        }
        return;
      }
      if (this.file.entries.length >= MAX_SIDECAR_ENTRIES) {
        throw new Error("vision sidecar: entry bound exceeded");
      }
      this.file.entries.push(entry);
      try {
        await this.persist();
      } catch (error) {
        this.file.entries.pop();
        throw error;
      }
    });
  }

  get(recordId: string): VisionSidecarEntry | null {
    return this.file.entries.find((e) => e.record_id === recordId) ?? null;
  }

  stats(): { entries: number } {
    return { entries: this.file.entries.length };
  }
}
