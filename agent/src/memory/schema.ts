// Memory record v1 schema validation. Server assigns id/namespace/timestamp/
// epoch/version/content_hash; model output never supplies them.
export const MEMORY_TYPES = ["fact", "preference", "event", "correction"] as const;
export type MemoryType = (typeof MEMORY_TYPES)[number];
export const RECORD_SCHEMA_VERSION = 1;
export const MAX_SUMMARY_CHARS = 500;
export const MAX_TURN_ID_CHARS = 128;

export interface MemoryRecord {
  schema_version: number; // envelope schema version (distinct from revision `version`)
  id: string;
  character_id: string;
  epoch: number;
  timestamp: string;
  type: MemoryType;
  content_hash: string;
  summary: string;
  trait_delta?: Record<string, number>;
  provenance: { turn_ids: string[]; frame_hash?: string };
  confidence: number;
  supersedes?: string;
  version: number; // revision: 1 for new, prior+1 for corrections
}

const HEX64 = /^[0-9a-f]{64}$/;
function rejectUnknown(obj: Record<string, unknown>, allowed: string[], where: string) {
  for (const k of Object.keys(obj)) if (!allowed.includes(k)) throw new Error(`${where}: unknown field "${k}"`);
}
export function validateTraitDelta(v: unknown): Record<string, number> | undefined {
  if (v === undefined) return undefined;
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("trait_delta must be an object");
  const e = Object.entries(v as Record<string, unknown>);
  if (e.length > 8) throw new Error("trait_delta: too many keys");
  for (const [k, val] of e) {
    if (!k || k.length > 64) throw new Error("trait_delta: bad key");
    if (typeof val !== "number" || !Number.isFinite(val) || val < -1 || val > 1) throw new Error("trait_delta: values must be finite numbers in [-1,1]");
  }
  return v as Record<string, number>;
}

/** Validate a full stored record (including hash format); throws on any violation. */
export function validateRecord(r: unknown, expectedCharacterId?: string): MemoryRecord {
  if (!r || typeof r !== "object" || Array.isArray(r)) throw new Error("record must be an object");
  const o = r as Record<string, unknown>;
  rejectUnknown(o, ["schema_version","id","character_id","epoch","timestamp","type","content_hash","summary","trait_delta","provenance","confidence","supersedes","version"], "record");
  if (o.schema_version !== RECORD_SCHEMA_VERSION) throw new Error("record: unsupported schema_version");
  if (typeof o.id !== "string" || !o.id) throw new Error("record: bad id");
  if (typeof o.character_id !== "string" || !o.character_id) throw new Error("record: bad character_id");
  if (expectedCharacterId && o.character_id !== expectedCharacterId) throw new Error("record: character_id does not match namespace");
  if (!Number.isInteger(o.epoch) || (o.epoch as number) < 0) throw new Error("record: bad epoch");
  if (typeof o.timestamp !== "string" || Number.isNaN(Date.parse(o.timestamp))) throw new Error("record: bad timestamp");
  if (!(MEMORY_TYPES as readonly string[]).includes(o.type as string)) throw new Error(`record: bad type "${String(o.type)}"`);
  if (typeof o.content_hash !== "string" || !HEX64.test(o.content_hash)) throw new Error("record: bad content_hash");
  if (typeof o.summary !== "string" || !o.summary.trim() || o.summary.length > MAX_SUMMARY_CHARS) throw new Error("record: bad summary");
  validateTraitDelta(o.trait_delta);
  if (typeof o.confidence !== "number" || !Number.isFinite(o.confidence) || o.confidence < 0 || o.confidence > 1) throw new Error("record: confidence out of [0,1]");
  if (!Number.isInteger(o.version) || (o.version as number) < 1) throw new Error("record: bad version");
  if (o.supersedes !== undefined && (typeof o.supersedes !== "string" || !o.supersedes)) throw new Error("record: bad supersedes");
  const p = o.provenance as Record<string, unknown> | undefined;
  if (!p || typeof p !== "object" || Array.isArray(p)) throw new Error("record: bad provenance");
  rejectUnknown(p, ["turn_ids", "frame_hash"], "provenance");
  if (!Array.isArray(p.turn_ids) || p.turn_ids.length < 1 || p.turn_ids.length > 20 || p.turn_ids.some((t) => typeof t !== "string" || !t || t.length > MAX_TURN_ID_CHARS)) throw new Error("record: bad provenance.turn_ids");
  if (p.frame_hash !== undefined && (typeof p.frame_hash !== "string" || !HEX64.test(p.frame_hash))) throw new Error("record: bad frame_hash");
  return o as unknown as MemoryRecord;
}

/** Shape Spark must return (per item). Server metadata is not accepted here either. */
export interface ExtractedMemory {
  type: MemoryType; summary: string; confidence: number;
  trait_delta?: Record<string, number>; supersedes?: string; source_turn_ids: string[];
}
export function validateExtraction(raw: unknown, allowedTurnIds: string[]): ExtractedMemory[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("extraction must be an object");
  const o = raw as Record<string, unknown>;
  rejectUnknown(o, ["memories"], "extraction");
  if (!Array.isArray(o.memories) || o.memories.length > 10) throw new Error("extraction: memories must be an array of <=10");
  return o.memories.map((m, i) => {
    if (!m || typeof m !== "object" || Array.isArray(m)) throw new Error(`extraction[${i}] must be an object`);
    const x = m as Record<string, unknown>;
    rejectUnknown(x, ["type","summary","confidence","trait_delta","supersedes","source_turn_ids"], `extraction[${i}]`);
    if (!(MEMORY_TYPES as readonly string[]).includes(x.type as string)) throw new Error(`extraction[${i}]: bad type`);
    if (typeof x.summary !== "string" || !x.summary.trim() || x.summary.length > MAX_SUMMARY_CHARS) throw new Error(`extraction[${i}]: bad summary`);
    if (typeof x.confidence !== "number" || !Number.isFinite(x.confidence) || x.confidence < 0 || x.confidence > 1) throw new Error(`extraction[${i}]: confidence out of [0,1]`);
    if (x.trait_delta === null) x.trait_delta = undefined;
    validateTraitDelta(x.trait_delta);
    if (x.supersedes === null) x.supersedes = undefined;
    if (x.supersedes !== undefined && (typeof x.supersedes !== "string" || !x.supersedes)) throw new Error(`extraction[${i}]: bad supersedes`);
    if (!Array.isArray(x.source_turn_ids) || x.source_turn_ids.length < 1 || x.source_turn_ids.some((t) => typeof t !== "string" || !allowedTurnIds.includes(t))) throw new Error(`extraction[${i}]: source_turn_ids must reference submitted turns`);
    return x as unknown as ExtractedMemory;
  });
}

// Strict structured output (verified live against api.meta.ai 2026-10-29):
// every property must appear in `required`; optional fields are nullable.
export const EXTRACTION_JSON_SCHEMA = {
  type: "object", additionalProperties: false, required: ["memories"],
  properties: { memories: { type: "array", maxItems: 10, items: {
    type: "object", additionalProperties: false,
    required: ["type", "summary", "confidence", "trait_delta", "supersedes", "source_turn_ids"],
    properties: {
      type: { type: "string", enum: [...MEMORY_TYPES] },
      summary: { type: "string", maxLength: MAX_SUMMARY_CHARS },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      trait_delta: { type: ["object", "null"], additionalProperties: { type: "number", minimum: -1, maximum: 1 } },
      supersedes: { type: ["string", "null"] },
      source_turn_ids: { type: "array", items: { type: "string" }, minItems: 1 },
    },
  } } },
} as const;
