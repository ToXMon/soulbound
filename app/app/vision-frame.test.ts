// Ticket 034 self-checks for the bounded canvas-encode helper.  Pure logic:
// no DOM renderers, no camera, no network.  All JPEG sizes are injected
// through a fake encoder so we can exercise edge cases deterministically.
// The draw function is a simple no-op for size-only tests or tracks canvas
// dimensions for ordering tests.  A mock canvas factory replaces the DOM.
//
// Run with the ticket's verification command (Node --test on compiled JS).
import test from "node:test";
import assert from "node:assert/strict";
import {
  fitVisionFrame,
  FitEncodeError,
  type FitCanvas,
  type FitVisionFrameOpts,
} from "./vision-frame.js";
import { buildVisionFrameEnvelope, MAX_VISION_ENVELOPE_BYTES, VisionEnvelopeError } from "./vision-trigger.js";


// ---------------------------------------------------------------------------
// Mock canvas factory — returns a plain object with mutable width/height and
// a trivial 2d context that only tracks dimensions.
// ---------------------------------------------------------------------------
class MockContext {
  clearRect() { /* no-op */ }
  drawImage() { /* no-op */ }
}
class MockCanvas implements FitCanvas {
  width = 0;
  height = 0;
  private ctx = new MockContext();
  getContext(_kind: "2d"): CanvasRenderingContext2D | null {
    return this.ctx as unknown as CanvasRenderingContext2D;
  }
}
function mockCreateCanvas(): FitCanvas {
  return new MockCanvas();
}

// ---------------------------------------------------------------------------
// Fake encoder: returns a Blob of exactly `size` bytes filled with 'x'.
// ---------------------------------------------------------------------------
function sizedEncoder(size: number) {
  return async (_canvas: FitCanvas, _quality: number): Promise<Blob | null> => {
    const bytes = new Uint8Array(size);
    bytes.fill(120); // 'x'
    return new Blob([bytes], { type: "image/jpeg" });
  };
}

/** Encoder that returns null (simulates encode failure). */
const nullEncoder = async () => null;

/** Encoder that throws (simulates catastrophic failure). */
const throwingEncoder = async () => { throw new Error("encode boom"); };

/** No-op draw source — size-only tests don't need to render pixels. */
const noopDraw = () => {};

/** Shared options with mock canvas for all tests. */
const mockOpts: FitVisionFrameOpts = { createCanvas: mockCreateCanvas };

// ---------------------------------------------------------------------------
// Helper: given a frame size, compute its envelope size via buildVisionFrameEnvelope.
// ---------------------------------------------------------------------------
function envelopeSizeForFrame(frameBytes: number, triggerId = "00000000-0000-4000-8000-000000000000"): number {
  const frame = new Uint8Array(frameBytes);
  try {
    return buildVisionFrameEnvelope(frame, triggerId, "image/jpeg").length;
  } catch {
    return Infinity; // oversized
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("happy path: first candidate (768 @ 0.85) fits and returns matching dimensions", async () => {
  const enc = sizedEncoder(100);
  const result = await fitVisionFrame(noopDraw, 1920, 1080, "t1", { ...mockOpts, encoder: enc });
  assert.equal(result.width, 768);
  assert.equal(result.height, 432); // 1920×1080 → 768 max → 768×432 (768/1920*1080 = 432)
  assert.ok(result.frame.length > 0);
  assert.ok(result.frame.length <= MAX_VISION_ENVELOPE_BYTES);
  assert.ok(result.blob.size > 0);
  // Ticket 034: result is raw frame bytes; envelope is built by the caller.
  const envelope = buildVisionFrameEnvelope(result.frame, "t1", "image/jpeg");
  const env = JSON.parse(new TextDecoder().decode(envelope)) as Record<string, unknown>;
  assert.equal(env.trigger_id, "t1");
  assert.equal(env.mime, "image/jpeg");
});

test("aspect ratio preserved; no upscaling when source is smaller than max dim", async () => {
  const enc = sizedEncoder(100);
  const result = await fitVisionFrame(noopDraw, 400, 300, "t2", { ...mockOpts, encoder: enc });
  assert.equal(result.width, 400);
  assert.equal(result.height, 300);
});

test("portrait aspect ratio preserved", async () => {
  const enc = sizedEncoder(100);
  const result = await fitVisionFrame(noopDraw, 1080, 1920, "t3", { ...mockOpts, encoder: enc });
  assert.equal(result.width, 432);
  assert.equal(result.height, 768);
});

test("square aspect ratio preserved", async () => {
  const enc = sizedEncoder(100);
  const result = await fitVisionFrame(noopDraw, 1000, 1000, "t4", { ...mockOpts, encoder: enc });
  assert.equal(result.width, 768);
  assert.equal(result.height, 768);
});

test("zero-dimension source throws", async () => {
  const enc = sizedEncoder(100);
  await assert.rejects(
    () => fitVisionFrame(noopDraw, 0, 100, "t", { ...mockOpts, encoder: enc }),
    FitEncodeError,
  );
  await assert.rejects(
    () => fitVisionFrame(noopDraw, 100, 0, "t", { ...mockOpts, encoder: enc }),
    FitEncodeError,
  );
});

test("negative-dimension source throws", async () => {
  const enc = sizedEncoder(100);
  await assert.rejects(
    () => fitVisionFrame(noopDraw, -1, 100, "t", { ...mockOpts, encoder: enc }),
    FitEncodeError,
  );
});

test("null encoder result skips candidate and tries next", async () => {
  let call = 0;
  const enc = async () => {
    call++;
    if (call === 1) return null;
    return new Blob([new Uint8Array(200)], { type: "image/jpeg" });
  };
  const result = await fitVisionFrame(noopDraw, 1920, 1080, "t", { ...mockOpts, encoder: enc });
  assert.ok(result.frame.length > 0);
  assert.ok(call >= 2, "at least two encoder calls: first null, second success");
});

test("throwing encoder propagates error (fail closed, no publish)", async () => {
  await assert.rejects(
    () => fitVisionFrame(noopDraw, 1920, 1080, "t", { ...mockOpts, encoder: throwingEncoder }),
    Error,
  );
});

test("fail closed: no candidate fits the envelope bound", async () => {
  const enc = sizedEncoder(100_000);
  await assert.rejects(
    () => fitVisionFrame(noopDraw, 1920, 1080, "t", { ...mockOpts, encoder: enc }),
    FitEncodeError,
    "no candidate fits",
  );
});

test("exact boundary: frame just under the base64 envelope limit succeeds", async () => {
  const frameSize = 36700;
  const enc = sizedEncoder(frameSize);
  assert.ok(envelopeSizeForFrame(frameSize) <= MAX_VISION_ENVELOPE_BYTES,
    `frame ${frameSize}B should fit envelope bound ${MAX_VISION_ENVELOPE_BYTES}B`);
  const result = await fitVisionFrame(noopDraw, 1920, 1080, "t", { ...mockOpts, encoder: enc });
  const envelope = buildVisionFrameEnvelope(result.frame, "t", "image/jpeg");
  assert.ok(envelope.length <= MAX_VISION_ENVELOPE_BYTES);
});

test("over-bound envelope is rejected by buildVisionFrameEnvelope", () => {
  const frame = new Uint8Array(37000);
  assert.throws(
    () => buildVisionFrameEnvelope(frame, "00000000-0000-4000-8000-000000000000", "image/jpeg"),
    VisionEnvelopeError,
  );
});

test("over-bound frame: fitVisionFrame progresses through candidates", async () => {
  let call = 0;
  const enc = async () => {
    call++;
    return new Blob([new Uint8Array(call <= 3 ? 37000 : 10000)], { type: "image/jpeg" });
  };
  const result = await fitVisionFrame(noopDraw, 1920, 1080, "t", { ...mockOpts, encoder: enc });
  const envelope = buildVisionFrameEnvelope(result.frame, "t", "image/jpeg");
  assert.ok(envelope.length <= MAX_VISION_ENVELOPE_BYTES);
  assert.ok(call >= 4, `expected ≥4 encoder calls, got ${call}`);
});

test("dimension reduction: falls back to smaller dimensions when quality reductions don't suffice", async () => {
  const calls: Array<{ w: number; h: number; q: number }> = [];
  let currentW = 0;
  let currentH = 0;
  const trackingDraw = (_ctx: unknown, w: number, h: number) => {
    currentW = w;
    currentH = h;
  };
  const enc = async (_canvas: FitCanvas, quality: number) => {
    calls.push({ w: currentW, h: currentH, q: quality });
    if (currentW >= 640) return new Blob([new Uint8Array(37000)], { type: "image/jpeg" });
    return new Blob([new Uint8Array(1000)], { type: "image/jpeg" });
  };
  const result = await fitVisionFrame(trackingDraw, 1920, 1080, "t", { ...mockOpts, encoder: enc });
  assert.ok(result.width <= 512);
  const triedDims = new Set(calls.map((c) => c.w));
  assert.ok(triedDims.has(768), "should have tried 768 dimension");
  assert.ok(triedDims.has(640), "should have tried 640 dimension");
});

test("quality reduction within same dimension before dropping dimension", async () => {
  const calls: Array<{ w: number; q: number }> = [];
  let currentW = 0;
  const trackingDraw = (_ctx: unknown, w: number) => { currentW = w; };
  const enc = async (_canvas: FitCanvas, quality: number) => {
    calls.push({ w: currentW, q: quality });
    if (currentW === 768 && quality >= 0.70) {
      return new Blob([new Uint8Array(37000)], { type: "image/jpeg" });
    }
    return new Blob([new Uint8Array(5000)], { type: "image/jpeg" });
  };
  const result = await fitVisionFrame(trackingDraw, 1920, 1080, "t", { ...mockOpts, encoder: enc });
  assert.equal(result.width, 768);
  const seq768 = calls.filter((c) => c.w === 768);
  assert.ok(seq768.length >= 3, "should have tried multiple qualities at 768");
  assert.ok(seq768[0].q === 0.85, "first quality tried at 768 should be 0.85");
  assert.ok(seq768[1].q === 0.70, "second quality at 768 should be 0.70");
});

test("envelope built with actual triggerId, not a placeholder", async () => {
  const enc = sizedEncoder(500);
  const tid = "a1b2c3d4-e5f6-4000-8000-123456789abc";
  const result = await fitVisionFrame(noopDraw, 1920, 1080, tid, { ...mockOpts, encoder: enc });
  // Ticket 034: fitVisionFrame returns raw frame bytes; the caller (look())
  // builds the envelope, but we verify the gate uses the actual trigger id.
  const envelope = buildVisionFrameEnvelope(result.frame, tid, "image/jpeg");
  const env = JSON.parse(new TextDecoder().decode(envelope)) as Record<string, unknown>;
  assert.equal(env.trigger_id, tid);
  assert.equal(env.version, 1);
});

test("returned blob matches transmitted dimensions", async () => {
  const enc = sizedEncoder(1000);
  const result = await fitVisionFrame(noopDraw, 1920, 1080, "t", { ...mockOpts, encoder: enc });
  assert.equal(result.width, 768);
  assert.equal(result.height, 432);
  assert.ok(result.blob.size > 0);
  assert.equal(result.blob.type, "image/jpeg");
});

test("no candidate advanced: all candidates are exhausted (finite sequence)", async () => {
  let calls = 0;
  const enc = async () => {
    calls++;
    return new Blob([new Uint8Array(50000)], { type: "image/jpeg" });
  };
  await assert.rejects(
    () => fitVisionFrame(noopDraw, 1920, 1080, "t", { ...mockOpts, encoder: enc }),
    FitEncodeError,
  );
  assert.ok(calls <= 16, `should try at most 16 candidates, got ${calls}`);
  assert.equal(calls, 16, `expected exactly 16 attempts, got ${calls}`);
});

test("frame returned is Uint8Array (ready for envelope building by caller)", async () => {
  const enc = sizedEncoder(500);
  const result = await fitVisionFrame(noopDraw, 1920, 1080, "t", { ...mockOpts, encoder: enc });
  assert.ok(result.frame instanceof Uint8Array);
  assert.ok(result.frame.length > 0);
});

test("MAX_VISION_ENVELOPE_BYTES equals 49152 (48 KiB)", () => {
  assert.equal(MAX_VISION_ENVELOPE_BYTES, 49152);
});

test("high-entropy synthetic frame: many candidates tried before fit", async () => {
  let calls = 0;
  let currentW = 0;
  const trackingDraw = (_ctx: unknown, w: number) => { currentW = w; };
  const enc = async (_canvas: FitCanvas, quality: number) => {
    calls++;
    if (currentW === 384 && quality === 0.40) {
      return new Blob([new Uint8Array(5000)], { type: "image/jpeg" });
    }
    return new Blob([new Uint8Array(37000)], { type: "image/jpeg" });
  };
  const result = await fitVisionFrame(trackingDraw, 1920, 1080, "t", { ...mockOpts, encoder: enc });
  assert.equal(result.width, 384);
  assert.equal(calls, 16, "all 16 candidates exhausted before the last one fits");
});

test("draw function receives correct target dimensions on each attempt", async () => {
  const draws: Array<{ w: number; h: number }> = [];
  const recordDraw = (_ctx: unknown, w: number, h: number) => draws.push({ w, h });
  let calls = 0;
  const enc = async () => {
    calls++;
    if (calls === 16) return new Blob([new Uint8Array(100)], { type: "image/jpeg" });
    return new Blob([new Uint8Array(50000)], { type: "image/jpeg" });
  };
  await fitVisionFrame(recordDraw, 1920, 1080, "t", { ...mockOpts, encoder: enc });
  assert.equal(draws.length, 16);
  // 768 max dim: 1920×1080 → 768×432, repeated 4 times (4 qualities).
  const dims768 = draws.slice(0, 4);
  for (const d of dims768) {
    assert.equal(d.w, 768);
    assert.equal(d.h, 432);
  }
  // 640 max dim: 1920×1080 → 640×360.
  const dims640 = draws.slice(4, 8);
  for (const d of dims640) {
    assert.equal(d.w, 640);
    assert.equal(d.h, 360);
  }
  // 512 max dim: 1920×1080 → 512×288.
  const dims512 = draws.slice(8, 12);
  for (const d of dims512) {
    assert.equal(d.w, 512);
    assert.equal(d.h, 288);
  }
  // 384 max dim: 1920×1080 → 384×216.
  const dims384 = draws.slice(12, 16);
  for (const d of dims384) {
    assert.equal(d.w, 384);
    assert.equal(d.h, 216);
  }
});

// ---- Ticket 034 new tests --------------------------------------------------

test("previously large capture cannot bypass 48 KiB bound — all candidates exhausted, fail closed", async () => {
  // A 384×216 frame at 0.40 quality is the smallest candidate.  If even that
  // produces a frame whose envelope exceeds 48 KiB, fitVisionFrame fails closed.
  const enc = async () => new Blob([new Uint8Array(37000)], { type: "image/jpeg" });
  await assert.rejects(
    () => fitVisionFrame(noopDraw, 1920, 1080, "t", { ...mockOpts, encoder: enc }),
    FitEncodeError,
    "no candidate fits",
  );
});

test("max trigger id: 128-char printable id is accepted as gate arg", async () => {
  const tid = "z".repeat(128);
  const enc = sizedEncoder(100);
  const result = await fitVisionFrame(noopDraw, 1920, 1080, tid, { ...mockOpts, encoder: enc });
  const envelope = buildVisionFrameEnvelope(result.frame, tid, "image/jpeg");
  const env = JSON.parse(new TextDecoder().decode(envelope)) as Record<string, unknown>;
  assert.equal(env.trigger_id, tid);
});

test("trigger id with non-printable chars is rejected by the gate", async () => {
  // fitVisionFrame passes triggerId to buildVisionFrameEnvelope which rejects
  // non-printable chars.  The encoder never runs — fails at the gate.
  await assert.rejects(
    () => fitVisionFrame(noopDraw, 1920, 1080, "abc\ndef", { ...mockOpts, encoder: sizedEncoder(100) }),
    VisionEnvelopeError,
  );
});

test("trigger id > 128 chars is rejected by the gate", async () => {
  await assert.rejects(
    () => fitVisionFrame(noopDraw, 1920, 1080, "z".repeat(129), { ...mockOpts, encoder: sizedEncoder(100) }),
    VisionEnvelopeError,
  );
});

test("cancellation: null/zero-length blob from encoder is skipped, not published", async () => {
  let calls = 0;
  const enc = async () => {
    calls++;
    // Return null for first 5 candidates; then a tiny valid frame.
    if (calls <= 5) return null;
    return new Blob([new Uint8Array(100)], { type: "image/jpeg" });
  };
  const result = await fitVisionFrame(noopDraw, 1920, 1080, "t", { ...mockOpts, encoder: enc });
  assert.ok(result.frame.length > 0);
  assert.ok(calls >= 6, "null encoder results must be skipped, not treated as cancellations");
});

test("fitVisionFrame gates with the actual trigger id — different id changes envelope size", async () => {
  // A frame size that fits with a short trigger id might not fit with a
  // max-length trigger id.  fitVisionFrame uses the actual trigger id so the
  // gate is honest.
  const shortTid = "a";
  const longTid = "z".repeat(128);
  const frameSize = 36750; // near the edge
  const enc = sizedEncoder(frameSize);
  const shortOk = envelopeSizeForFrame(frameSize, shortTid) <= MAX_VISION_ENVELOPE_BYTES;
  const longOk = envelopeSizeForFrame(frameSize, longTid) <= MAX_VISION_ENVELOPE_BYTES;
  // The long trigger id adds ~127 extra chars to the JSON payload, which
  // may push it over the bound.  Either both fit or only the short one fits;
  // the long one must never fit when the short one doesn't.
  if (!shortOk) {
    // Both fail — fitVisionFrame rejects for either id.
    await assert.rejects(
      () => fitVisionFrame(noopDraw, 1920, 1080, shortTid, { ...mockOpts, encoder: enc }),
      FitEncodeError,
    );
  } else if (!longOk) {
    // Short id fits but long id doesn't — fitVisionFrame must fail for long.
    const shortResult = await fitVisionFrame(noopDraw, 1920, 1080, shortTid, { ...mockOpts, encoder: enc });
    assert.ok(shortResult.frame.length > 0, "short trigger id must succeed");
    await assert.rejects(
      () => fitVisionFrame(noopDraw, 1920, 1080, longTid, { ...mockOpts, encoder: enc }),
      FitEncodeError,
      "long trigger id must fail when it pushes envelope over 48 KiB",
    );
  }
  // else both fit — nothing to assert beyond the happy path.
});

test("rejected intermediate buffers are cleared (fill(0) on fail)", async () => {
  // Blob constructor copies the input buffer, so we override arrayBuffer on
  // each blob to return the SAME retained buffer — then fill(0) on the
  // extracted frame also zeros this retained buffer.
  const capturedRetained: ArrayBuffer[] = [];
  let calls = 0;
  const enc = async () => {
    calls++;
    const buf = new Uint8Array(37000);
    buf.fill(99); // non-zero fill
    const blob = new Blob([buf], { type: "image/jpeg" });
    // Override arrayBuffer to return one retained copy.
    const retained = buf.buffer.slice(0);
    capturedRetained.push(retained);
    Object.defineProperty(blob, "arrayBuffer", {
      value: async () => retained,
      configurable: true,
    });
    return blob;
  };
  await assert.rejects(
    () => fitVisionFrame(noopDraw, 1920, 1080, "t", { ...mockOpts, encoder: enc }),
    FitEncodeError,
  );
  assert.equal(calls, 16, "all 16 candidates must be tried");
  assert.equal(capturedRetained.length, 16);
  // The first 15 retained buffers should be zeroed by the catch/fill(0) path.
  // The 16th also fails but the catch block runs fill(0) before the throw.
  for (let i = 0; i < 16; i++) {
    const view = new Uint8Array(capturedRetained[i]);
    const allZero = view.every((b) => b === 0);
    assert.ok(allZero, `candidate ${i + 1} retained buffer must be zeroed after rejection`);
  }
});
test("clamps target width/height to at least 1px (no zero-size canvas)", async () => {
  // Extreme portrait: 1px wide source scaled to max dim 768 would round w→0
  // without the clamp.  The canvas must always be at least 1×1.
  const dims: Array<{ w: number; h: number }> = [];
  const recordDraw = (_ctx: unknown, w: number, h: number) => dims.push({ w, h });
  const enc = sizedEncoder(100);
  const result = await fitVisionFrame(recordDraw, 1, 10000, "t", { ...mockOpts, encoder: enc });
  assert.ok(result.width >= 1, "width must be clamped to >=1");
  assert.ok(result.height >= 1, "height must be clamped to >=1");
  assert.equal(result.width, 1);
  assert.equal(result.height, 768);
  for (const d of dims) {
    assert.ok(d.w >= 1 && d.h >= 1, `all draw dims >=1, got ${d.w}x${d.h}`);
  }
});
