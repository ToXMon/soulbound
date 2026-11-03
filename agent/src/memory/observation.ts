// Ticket 008. Vision observation record — separate from the frozen 004 memory
// schema (agent/src/memory/schema.ts). Never embeds frame or mask bytes.
export const VISION_RECORD_KIND = "vision_observation" as const;
export const VISION_SCHEMA_VERSION = 1;
export const MAX_VISION_LABEL_CHARS = 128;
export const MAX_VISION_SUMMARY_CHARS = 500;
export const MAX_MASK_REF_CHARS = 256;
export const MAX_TRIGGER_ID_CHARS = 128;

export interface VisionObservationRecord {
  schema_version: number;
  kind: typeof VISION_RECORD_KIND;
  character_id: string;
  frame_hash: string;      // keccak-256 of the exact frame bytes sent to SAM/Spark
  mask_ref: string;        // keccak-256 of the mask bytes, or the SAM mask id
  timestamp: string;       // ISO-8601 processing time (frame is discarded after)
  object_label: string;
  summary: string;
  confidence: number;      // [0,1]
  trigger_id: string;      // proof the frame came from an explicit trigger event
  synthetic: boolean;      // fixture output MUST set true; live model output false
  /** Chosen mask bounding box [x, y, w, h] in source-frame pixels. Display
   * metadata only (four numbers, never bytes); carried to the browser so the
   * mask overlay can render. Not part of durable provenance. */
  bbox?: [number, number, number, number];
}

const HEX64 = /^[0-9a-f]{64}$/;
const KEYS = ["schema_version", "kind", "character_id", "frame_hash", "mask_ref", "timestamp",
  "object_label", "summary", "confidence", "trigger_id", "synthetic", "bbox"];
/** bbox is optional display metadata; every other known field is required. */
const REQUIRED_KEYS = KEYS.filter((k) => k !== "bbox");

/** Validate a full vision observation record. Throws on any violation; never
 * coerces, never accepts frame/mask bytes, and rejects unlabeled fixtures. */
export function validateObservationRecord(raw: unknown): VisionObservationRecord {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("observation: must be an object");
  const o = raw as Record<string, unknown>;
  for (const k of Object.keys(o)) if (!KEYS.includes(k)) throw new Error(`observation: unknown field "${k}"`);
  for (const k of REQUIRED_KEYS) if (!(k in o)) throw new Error(`observation: missing "${k}"`);
  if (o.schema_version !== VISION_SCHEMA_VERSION) throw new Error("observation: bad schema_version");
  if (o.kind !== VISION_RECORD_KIND) throw new Error("observation: bad kind");
  if (typeof o.character_id !== "string" || !o.character_id) throw new Error("observation: bad character_id");
  if (typeof o.frame_hash !== "string" || !HEX64.test(o.frame_hash)) throw new Error("observation: bad frame_hash");
  if (typeof o.mask_ref !== "string" || !o.mask_ref.length || o.mask_ref.length > MAX_MASK_REF_CHARS)
    throw new Error("observation: bad mask_ref");
  if (typeof o.timestamp !== "string" || Number.isNaN(Date.parse(o.timestamp))) throw new Error("observation: bad timestamp");
  if (typeof o.object_label !== "string" || !o.object_label.trim() || o.object_label.length > MAX_VISION_LABEL_CHARS)
    throw new Error("observation: bad object_label");
  if (typeof o.summary !== "string" || !o.summary.trim() || o.summary.length > MAX_VISION_SUMMARY_CHARS)
    throw new Error("observation: bad summary");
  if (typeof o.confidence !== "number" || !Number.isFinite(o.confidence) || o.confidence < 0 || o.confidence > 1)
    throw new Error("observation: confidence out of [0,1]");
  if (typeof o.trigger_id !== "string" || !o.trigger_id || o.trigger_id.length > MAX_TRIGGER_ID_CHARS)
    throw new Error("observation: bad trigger_id");
  if (typeof o.synthetic !== "boolean") throw new Error("observation: synthetic flag must be explicit");
  if (o.bbox !== undefined) {
    if (!Array.isArray(o.bbox) || o.bbox.length !== 4 ||
        o.bbox.some((n) => typeof n !== "number" || !Number.isFinite(n) || n < 0)) {
      throw new Error("observation: bad bbox");
    }
  }
  return o as unknown as VisionObservationRecord;
}

/** Map a validated observation to the existing 004 extraction shape, so the
 * object lands in the memory graph via the unchanged store path. The vision
 * record keeps full provenance; the memory source id binds the explicit trigger
 * to the frame hash so retries are idempotent without conflating repeated looks. */
export function observationToExtraction(o: VisionObservationRecord): {
  type: "event"; summary: string; confidence: number; source_turn_ids: string[];
} {
  const v = validateObservationRecord(o);
  return {
    type: "event",
    summary: `Looked at: ${v.object_label} — ${v.summary}`,
    confidence: v.confidence,
    source_turn_ids: [`vision:${v.trigger_id}:${v.frame_hash}`],
  };
}
