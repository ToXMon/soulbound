// Ticket 034. Bounded canvas-encode helper: fit a camera frame into a
// 48 KiB single-message LiveKit envelope. No DOM imports beyond the canvas
// API; all camera/networking stays with the caller. Pure functions so the
// bounded-candidate loop is testable with injected encoders and draw sources.
//
// Envelope gate: every candidate is validated through buildVisionFrameEnvelope
// (the single authority on acceptable envelopes). Intermediate frames that
// don't fit are cleared; the returned blob/dimensions match the transmitted
// frame exactly.

import {
  buildVisionFrameEnvelope,
  MAX_VISION_ENVELOPE_BYTES,
} from "./vision-trigger";

/** Descending max-dimension candidates — no upscaling, aspect ratio preserved. */
const CANDIDATE_DIMS = [768, 640, 512, 384] as const;

/** Descending JPEG quality candidates. */
const CANDIDATE_QUALITIES = [0.85, 0.70, 0.55, 0.40] as const;

// ---- types ---------------------------------------------------------------

export interface FitVisionFrameResult {
  /** Raw JPEG frame bytes — caller must build the envelope through
   * buildVisionFrameEnvelope (Ticket 034: VisionTrigger.look enforces
   * the bound so no injected source can bypass it). */
  frame: Uint8Array;
  /** JPEG blob at the transmitted dimensions — for the local still display. */
  blob: Blob;
  /** Transmitted frame width (pixels). */
  width: number;
  /** Transmitted frame height (pixels). */
  height: number;
}

export class FitEncodeError extends Error {}

/** Injectable JPEG encoder so the candidate loop works offline.
 * Accepts FitCanvas (not HTMLCanvasElement) so tests can supply mocks
 * without DOM types.  The browser default encoder casts internally. */
export type JPEGEncoder = (
  canvas: FitCanvas,
  quality: number,
) => Promise<Blob | null>;

/** Draw function: (ctx, targetW, targetH) => void.  In the browser this
 * is typically `(ctx, w, h) => ctx.drawImage(videoElement, 0, 0, w, h)`;
 * tests inject synthetic draws or no-ops. */
export type DrawSource = (
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  targetW: number,
  targetH: number,
) => void;

/** Minimal canvas subset that fitVisionFrame needs.  Tests supply a mock;
 * the browser default calls document.createElement("canvas"). */
export interface FitCanvas {
  width: number;
  height: number;
  getContext(kind: "2d"): CanvasRenderingContext2D | null;
}

// ---- helpers -------------------------------------------------------------

/** Default canvas factory — uses the browser DOM. */
function defaultCreateCanvas(): FitCanvas {
  return document.createElement("canvas") as unknown as FitCanvas;
}

/** Browser default encoder — internally casts to HTMLCanvasElement for
 * toBlob access.  Tests inject their own encoder; this one only runs in
 * the browser where the canvas IS a real HTMLCanvasElement. */
const defaultEncoder: JPEGEncoder = (canvas, quality) =>
  new Promise<Blob | null>((resolve) =>
    (canvas as unknown as HTMLCanvasElement).toBlob(resolve, "image/jpeg", quality),
  );

export interface FitVisionFrameOpts {
  encoder?: JPEGEncoder;
  /** Canvas factory — inject a mock for Node tests. */
  createCanvas?: () => FitCanvas;
}

// ---- main ----------------------------------------------------------------

/**
 * Render `drawSource` through a bounded sequence of dimension × quality
 * candidates until the resulting JSON/base64 envelope (built by
 * buildVisionFrameEnvelope) fits `MAX_VISION_ENVELOPE_BYTES`.  Throws
 * FitEncodeError if no candidate fits (fail closed — nothing is published).
 * Returns the raw frame bytes plus the blob/dimensions of the candidate that
 * passed the gate; the caller builds the final envelope in `look()`.
 */
export async function fitVisionFrame(
  drawSource: DrawSource,
  sourceWidth: number,
  sourceHeight: number,
  triggerId: string,
  opts?: FitVisionFrameOpts,
): Promise<FitVisionFrameResult> {
  // Upfront triggerId validation using a minimal frame, so invalid ids
  // fail with VisionEnvelopeError (not FitEncodeError from the loop).
  buildVisionFrameEnvelope(new Uint8Array([1]), triggerId, "image/jpeg");

  if (
    !Number.isFinite(sourceWidth) ||
    sourceWidth < 1 ||
    !Number.isFinite(sourceHeight) ||
    sourceHeight < 1
  ) {
    throw new FitEncodeError("invalid source dimensions");
  }

  const encoder = opts?.encoder ?? defaultEncoder;
  const createCanvas = opts?.createCanvas ?? defaultCreateCanvas;
  const canvas = createCanvas();
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new FitEncodeError("canvas context unavailable");

  for (const maxDim of CANDIDATE_DIMS) {
    // Never upscale: if source is smaller, use source dimensions.
    const scale = Math.min(1, maxDim / Math.max(sourceWidth, sourceHeight));
    // Clamp w/h >= 1 to avoid zero-size canvas (Ticket 034).
    const w = Math.max(1, Math.round(sourceWidth * scale));
    const h = Math.max(1, Math.round(sourceHeight * scale));

    canvas.width = w;
    canvas.height = h;

    for (const quality of CANDIDATE_QUALITIES) {
      ctx.clearRect(0, 0, w, h);
      drawSource(ctx, w, h);

      const blob = await encoder(canvas, quality);
      if (!blob) continue; // null encode → try next candidate

      const frame = new Uint8Array(await blob.arrayBuffer());
      try {
        // buildVisionFrameEnvelope is the single authority — it rejects
        // envelopes > MAX_VISION_ENVELOPE_BYTES after base64 + JSON encoding.
        // We call it here as the gate, but return the raw frame bytes so
        // VisionTrigger.look() builds the final envelope itself (Ticket 034).
        buildVisionFrameEnvelope(frame, triggerId, "image/jpeg");
        // Success: dimensions/blob/frame all match this candidate.
        return { frame, blob, width: w, height: h };
      } catch {
        // Candidate too large (or malformed) — clear frame and try next.
        frame.fill(0);
      }
    }
  }

  throw new FitEncodeError(
    `no candidate fits ${MAX_VISION_ENVELOPE_BYTES}B envelope bound`,
  );
}