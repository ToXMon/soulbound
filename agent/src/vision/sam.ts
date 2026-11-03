// Ticket 008. Official Meta SAM 3.1 path: Responses API streaming +
// @meta-sam/parser. Follows the verified cookbook 07_sam/01_api_basics
// (model `sam-3.1`, input_image data URL + short noun-phrase input_text,
// parseImageStream over the streamed events). No mask is ever fabricated:
// without credentials or on a non-completed outcome this throws
// VisionNotConfigured and no segmentation is returned.
import {
  decodeMaskToRaster,
  decodeMaskToSVGPath,
  parseImageStream,
  recordsOfKind,
  type ResponsesEvent,
  type SegmentationMask,
} from "@meta-sam/parser";
import { VisionUnavailable } from "./frame.js";

export interface SamMask {
  id: string;                        // SAM object id (stable within one response)
  bbox: [number, number, number, number]; // x, y, w, h (pixels, source frame)
  area: number;                      // set-pixel count of the decoded mask raster
  /** Transient vector overlay for the browser highlight, or null when the
   * mask cannot be transported safely (bbox highlight remains). Never
   * persisted: pixels travel only in the correlated observation response. */
  overlay?: MaskOverlay | null;
}

/** Browser-renderable outline of one mask: an SVG path in raster-pixel space
 * (viewBox `0 0 width height`), positioned on the full frame by its OWN
 * source-frame bounds (left/top/right/bottom) — never by the observation
 * bbox. Both halves are derived from the same parser mask record; any
 * mismatch means the overlay is refused and the bbox highlight remains.
 * Derived from actual parser output only — never synthesized. */
export interface MaskOverlay {
  svg: string;
  width: number;
  height: number;
  /** Source-frame pixels of the box the raster covers (parser bounds). */
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Per-side raster bound: larger masks fall back to the bbox highlight rather
 * than risk unbounded transport or decode memory. */
export const MAX_MASK_RASTER_DIM = 1024;
/** Transport bound on the overlay path text (typical masks are hundreds of
 * bytes; complex silhouettes stay far below this). */
export const MAX_MASK_SVG_CHARS = 16_384;

const SVG_PATH_RE = /^[MmLlHhVvCcSsQqTtAaZz0-9eE.,\s+-]*$/;

/** Convert one parser mask record to a transport-safe overlay, or null. The
 * source bounds come from the SAME record (never fabricated). Before decoding,
 * require: integer raster dims 1..MAX_MASK_RASTER_DIM (untrusted numbers, so
 * checked first); finite integer ordered bounds (left/top >= 0, right > left,
 * bottom > top); and EXACT correspondence — (right-left) === width and
 * (bottom-top) === height — because the SVG path is raster-local and can only
 * be placed via these bounds. Then bounds- and shape-check the emitted path.
 * Never throws: conversion failure means the bbox highlight remains, not a
 * failed observation. */
export function toMaskOverlay(
  mask: SegmentationMask,
  bounds: { left: number; top: number; right: number; bottom: number } | null | undefined,
): MaskOverlay | null {
  if (!mask || typeof mask !== "object") return null;
  const { width, height } = mask;
  if (!Number.isInteger(width) || !Number.isInteger(height) ||
      width < 1 || height < 1 ||
      width > MAX_MASK_RASTER_DIM || height > MAX_MASK_RASTER_DIM) {
    return null;
  }
  if (!bounds || typeof bounds !== "object") return null;
  const { left, top, right, bottom } = bounds;
  if (![left, top, right, bottom].every((n) => Number.isInteger(n) && Number.isFinite(n))) return null;
  if (left < 0 || top < 0 || right <= left || bottom <= top) return null;
  if (right - left !== width || bottom - top !== height) return null;
  let svg: string;
  try {
    svg = decodeMaskToSVGPath(mask);
  } catch {
    return null;
  }
  if (typeof svg !== "string" || !svg || svg.length > MAX_MASK_SVG_CHARS || !SVG_PATH_RE.test(svg)) {
    return null;
  }
  return { svg, width, height, left, top, right, bottom };
}
export interface SamSegmenter {
  /** One billable SAM call. concept is the noun phrase to segment; when
   * omitted the client's configured concept applies. */
  segment(frame: Uint8Array, concept?: string): Promise<SamMask[]>;
}

export class VisionNotConfigured extends VisionUnavailable {}

export const SAM_MODEL = "sam-3.1";
export const SAM_BASE_URL = "https://api.meta.ai/v1";

export interface MetaSamConfig {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  /** Short noun phrase naming what to segment (e.g. "potted plant"). */
  concept?: string;
  /** MIME of the frame bytes; the Ticket 008 fixture and trigger frames are PNG. */
  mediaType?: string;
}

/** Pure Responses `input` builder — unit-testable without any network. */
export function samInput(concept: string, imageDataUrl: string) {
  const phrase = concept.trim();
  if (!phrase) throw new VisionNotConfigured("SAM concept must be a short noun phrase");
  return [
    {
      type: "message",
      role: "user",
      content: [
        { type: "input_text", text: phrase },
        { type: "input_image", image_url: imageDataUrl },
      ],
    },
  ];
}

// The API streams `response.content_part.done` but not
// `response.output_text.done`, which the parser uses to finalize a text lane —
// synthesize it from the content part (cookbook sam-api.ts).
export async function* normalizeResponseEvents(
  stream: AsyncIterable<unknown>,
): AsyncGenerator<ResponsesEvent> {
  const completed = new Set<string>();
  for await (const raw of stream) {
    const event = raw as {
      type?: string;
      item_id?: unknown;
      output_index?: unknown;
      content_index?: unknown;
      part?: { type?: unknown; text?: unknown } | null;
    };
    const lane = `${String(event.item_id)}:${String(event.output_index)}:${String(event.content_index)}`;
    if (event.type === "response.output_text.done") {
      if (!completed.has(lane)) {
        completed.add(lane);
        yield event as unknown as ResponsesEvent;
      }
      continue;
    }
    yield event as unknown as ResponsesEvent;
    if (
      event.type === "response.content_part.done" &&
      !completed.has(lane) &&
      event.part &&
      typeof event.part === "object" &&
      event.part.type === "output_text" &&
      typeof event.part.text === "string"
    ) {
      completed.add(lane);
      yield {
        type: "response.output_text.done",
        item_id: event.item_id,
        output_index: event.output_index,
        content_index: event.content_index,
        text: event.part.text,
      } as unknown as ResponsesEvent;
    }
  }
}

/** Parse one event stream into masks. Pure apart from the parser: offline-safe. */
export async function parseSegmentationEvents(
  events: AsyncIterable<ResponsesEvent>,
): Promise<SamMask[]> {
  const result = await parseImageStream(normalizeResponseEvents(events)).finalResult;
  if (result.outcome.status !== "completed") {
    throw new VisionNotConfigured(
      `SAM response did not complete: ${result.outcome.status}`,
    );
  }
  return recordsOfKind(result.records, "mask").map((record) => {
    const raster = decodeMaskToRaster(record.mask);
    let area = 0;
    for (const v of raster) area += v;
    const w = record.bounds.right - record.bounds.left;
    const h = record.bounds.bottom - record.bounds.top;
    return {
      id: record.objectId,
      bbox: [record.bounds.left, record.bounds.top, w, h] as SamMask["bbox"],
      area,
      // Transient only: the caller forwards it into the correlated response
      // and drops it; it is never persisted, logged, or stored. Bounds come
      // from this same record — never from anywhere else.
      overlay: toMaskOverlay(record.mask, record.bounds),
    };
  });
}

/**
 * Create the real SAM client. Lazy dynamic import keeps offline tests and
 * non-vision runs dependency-free. Requires the configured API key
 * (passed in, never read here from process.env).
 */
export function createMetaSamClient(config: MetaSamConfig): SamSegmenter {
  return {
    async segment(frame: Uint8Array, concept?: string) {
      if (!config.apiKey) {
        throw new VisionNotConfigured(
          "MODEL_API_KEY/META_API_KEY is not set; Ticket 008 live segmentation is blocked (no billable call attempted)",
        );
      }
      if (!(frame instanceof Uint8Array) || frame.length === 0) {
        throw new VisionNotConfigured("empty frame");
      }
      const mediaType = config.mediaType ?? "image/png";
      const dataUrl = `data:${mediaType};base64,${Buffer.from(frame).toString("base64")}`;
      const { default: OpenAI } = await import("openai");
      const client = new OpenAI({
        apiKey: config.apiKey,
        baseURL: config.baseUrl ?? SAM_BASE_URL,
        maxRetries: 0, // Ticket 008: no automatic SDK retries — one accepted trigger = one billable call
      });
      const stream = await client.responses.create({
        model: config.model ?? SAM_MODEL,
        stream: true,
        // The SDK types lag the SAM input shape; the cookbook casts here too.
        input: samInput((concept ?? config.concept ?? "potted plant").trim(), dataUrl) as never,
      });
      return parseSegmentationEvents(stream as AsyncIterable<ResponsesEvent>);
    },
  };
}
