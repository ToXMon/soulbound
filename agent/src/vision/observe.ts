// Ticket 008. Triggered-observation orchestration: frame in → validated record
// out, frame zeroed in every exit path. Only called after an explicit trigger;
// trigger_id is required provenance and is recorded.
import { discardFrame, frameHashHex } from "./frame.js";
import type { MaskOverlay, SamSegmenter } from "./sam.js";
import { buildObservationRequest, type SparkObserver } from "./spark.js";
import { validateObservationRecord, type VisionObservationRecord } from "../memory/observation.js";

export interface TriggeredObservation {
  /** Pixel-free provenance record: the only thing that may persist. */
  record: VisionObservationRecord;
  /** Transient vector overlay for the correlated response only. Never stored. */
  overlay: MaskOverlay | null;
}

export interface ObservationDeps {
  sam: SamSegmenter;
  spark: SparkObserver;
  characterId: string;
  triggerId: string; // required: proves an explicit trigger event happened
  mime?: string; // envelope-validated frame MIME; defaults to image/png
  now?: Date;
}

/** Run one triggered observation. The frame buffer is zeroed before return or
 * throw; the record carries only hash/mask metadata (REQ-44). The overlay is
 * the chosen mask's actual parser outline (or null); it is returned for the
 * correlated response only and must never be persisted. */
export async function runTriggeredObservation(
  frame: Uint8Array,
  deps: ObservationDeps,
): Promise<TriggeredObservation> {
  try {
    if (!deps.triggerId) throw new Error("observation requires an explicit trigger_id");
    if (!deps.characterId) throw new Error("observation requires character_id");
    const frameHash = frameHashHex(frame);
    // Spark names the object first so SAM receives a concrete noun phrase:
    // SAM 3.1 concept segmentation returns an EMPTY response for generic
    // prompts like "object" (observed live 2026-11-01), which previously
    // failed every look. Same one-Spark + one-SAM call count, reordered.
    const sparkOut = await deps.spark.observe(buildObservationRequest({
      model: "muse-spark-1.3",
      frameBase64: Buffer.from(frame).toString("base64"),
      maskRef: "pre-segmentation",
      frameHash,
      mime: deps.mime,
    }));
    const masks = await deps.sam.segment(frame, sparkOut.object_label);
    const mask = masks.length ? masks.reduce((a, b) => (b.area > a.area ? b : a)) : null;
    // Cookbook 04_structured_output: the pure builder owns the exact wire
    // shape (chat messages with image_url data URL, max_tokens ceiling,
    // strict json_schema response_format). The observer sends it verbatim.
    const record = validateObservationRecord({
      schema_version: 1,
      kind: "vision_observation",
      character_id: deps.characterId,
      frame_hash: frameHash,
      // Labeled no-mask fallback: SAM completed but matched nothing for the
      // Spark-named concept. The observation stays honest — no invented
      // bbox, no invented mask id — and the UI shows the commentary without
      // a mask highlight.
      mask_ref: mask ? mask.id : "none",
      timestamp: (deps.now ?? new Date()).toISOString(),
      object_label: sparkOut.object_label,
      summary: sparkOut.observation,
      confidence: sparkOut.confidence,
      trigger_id: deps.triggerId,
      synthetic: false,
      ...(mask ? { bbox: mask.bbox } : {}),
    });
    // The overlay is usable only when the observation bbox equals the
    // overlay's own parser bounds (both sourced from the same mask): the
    // browser must never place raster-local pixels via unrelated geometry.
    const overlay = mask?.overlay ?? null;
    const aligned = overlay !== null && record.bbox !== undefined &&
      record.bbox[0] === overlay.left && record.bbox[1] === overlay.top &&
      record.bbox[2] === overlay.right - overlay.left &&
      record.bbox[3] === overlay.bottom - overlay.top;
    return { record, overlay: aligned ? overlay : null };
  } finally {
    discardFrame(frame);
  }
}
