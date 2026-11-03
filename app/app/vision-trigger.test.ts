// Ticket 008 self-checks for the browser trigger gate. Pure fakes; no DOM,
// no camera, no network. Plain `node --test` on the TS source cannot resolve
// the `./vision-trigger.js` specifier, so compile first (tsconfig untouched)
// and run the compiled test:
//   cd app && ./node_modules/.bin/tsc app/vision-trigger.ts app/vision-trigger.test.ts \
//     --outDir /tmp/vt008 --module nodenext --target es2022 \
//     --moduleResolution nodenext --lib es2022,dom --skipLibCheck --strict \
//     && node --test /tmp/vt008/vision-trigger.test.js
import test from "node:test";
import assert from "node:assert/strict";
import {
  VisionTrigger,
  buildVisionFrameEnvelope,
  bytesToBase64,
  newTriggerId,
  VisionEnvelopeError,
  MAX_VISION_FRAME_BYTES,
  MAX_VISION_ENVELOPE_BYTES,
  type VisionObservationView,
} from "./vision-trigger.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function fakeDeps() {
  const calls = { capture: 0, publish: 0 };
  const published: Array<{ data: Uint8Array; triggerId: string }> = [];
  const statuses: string[] = [];
  const frame = new Uint8Array([9, 8, 7]);
  return {
    calls,
    published,
    statuses,
    frame,
    deps: {
      source: {
        capture: async (_triggerId?: string) => {
          calls.capture++;
          // Return raw frame bytes — VisionTrigger.look() builds the
          // envelope via buildVisionFrameEnvelope (Ticket 034).
          return frame;
        },
      },
      transport: {
        publishFrame: async (data: Uint8Array, triggerId: string) => {
          calls.publish++;
          published.push({ data: data.slice(), triggerId });
        },
      },
      onStatus: (s: string) => statuses.push(s),
    },
  };
}

function observationMessage(triggerId: string): VisionObservationView {
  return {
    object_label: "potted plant (synthetic fixture)",
    summary: "SYNTHETIC FIXTURE — not model output.",
    confidence: 0.5,
    frame_hash: "ab".repeat(32),
    mask_ref: "synthetic-mask-ref",
    trigger_id: triggerId,
    synthetic: true,
    durable: false,
  };
}

test("REQ-43: nothing is captured or published before an explicit trigger", async () => {
  const f = fakeDeps();
  const v = new VisionTrigger(f.deps);
  assert.equal(v.currentStatus, "idle");
  assert.equal(v.currentTriggerId, null);
  assert.deepEqual(f.calls, { capture: 0, publish: 0 });
  // Unsolicited observation input is ignored while idle.
  v.handleObservation(new TextEncoder().encode(JSON.stringify(observationMessage("no-such-trigger"))));
  assert.equal(v.currentView, null);
  assert.deepEqual(f.calls, { capture: 0, publish: 0 });
});

test("triggerId minted before capture so bounded encoder gets the real id", async () => {
  let capturedTriggerId: string | undefined;
  const f = fakeDeps();
  f.deps.source.capture = async (tid?: string) => {
    capturedTriggerId = tid;
    return new Uint8Array([1, 2, 3]);
  };
  const v = new VisionTrigger(f.deps);
  await v.look();
  assert.ok(capturedTriggerId, "triggerId must be passed to capture");
  assert.match(capturedTriggerId!, UUID_RE);
  assert.equal(capturedTriggerId, v.currentTriggerId);
});

test("one trigger mints a fresh UUID and publishes the exact agent envelope", async () => {
  const f = fakeDeps();
  const v = new VisionTrigger(f.deps);
  await v.look();
  assert.deepEqual(f.calls, { capture: 1, publish: 1 });
  assert.match(v.currentTriggerId ?? "", UUID_RE);
  assert.equal(f.published.length, 1);
  assert.equal(f.published[0].triggerId, v.currentTriggerId);
  // Exact envelope fields the agent handler validates.
  const env = JSON.parse(new TextDecoder().decode(f.published[0].data)) as Record<string, unknown>;
  assert.deepEqual(Object.keys(env).sort(), ["image_base64", "mime", "trigger_id", "version"]);
  assert.equal(env.version, 1);
  assert.equal(env.trigger_id, v.currentTriggerId);
  assert.equal(env.mime, "image/jpeg");
  assert.equal(env.image_base64, bytesToBase64(new Uint8Array([9, 8, 7])));
  assert.equal(v.currentStatus, "sent");
  // Each explicit look mints a new id: the previous trigger is invalidated.
  const first = v.currentTriggerId!;
  await v.look();
  assert.notEqual(v.currentTriggerId, first);
  assert.match(v.currentTriggerId ?? "", UUID_RE);
});

test("observation accepted only on matching trigger_id; stale/foreign ignored", async () => {
  const f = fakeDeps();
  const v = new VisionTrigger(f.deps);
  await v.look();
  const mine = v.currentTriggerId!;
  // Foreign trigger id: ignored, still waiting.
  v.handleObservation(new TextEncoder().encode(JSON.stringify(observationMessage("someone-elses-trigger"))));
  assert.equal(v.currentView, null);
  assert.equal(v.currentStatus, "sent");
  // Malformed packet: ignored.
  v.handleObservation(new TextEncoder().encode("not json"));
  assert.equal(v.currentView, null);
  // Missing trigger_id: ignored.
  const { trigger_id: _drop, ...noTrigger } = observationMessage(mine);
  v.handleObservation(new TextEncoder().encode(JSON.stringify(noTrigger)));
  assert.equal(v.currentView, null);
  // Matching trigger: accepted.
  v.handleObservation(new TextEncoder().encode(JSON.stringify(observationMessage(mine))));
  assert.equal(v.currentStatus, "observed");
  const observed = v.currentView as unknown as VisionObservationView | null;
  assert.equal(observed?.object_label, "potted plant (synthetic fixture)");
  assert.equal(observed?.trigger_id, mine);
  assert.equal(observed?.durable, false, "transient result is not presented as saved memory");
  assert.equal(v.currentTriggerId, null);
  v.discard();
  assert.equal(v.currentView, null);
  assert.equal(v.currentStatus, "idle");
});

test("matching observation with bbox lands in the view (mask overlay path)", async () => {
  const f = fakeDeps();
  const v = new VisionTrigger(f.deps);
  await v.look();
  const mine = v.currentTriggerId!;
  v.handleObservation(new TextEncoder().encode(JSON.stringify({
    ...observationMessage(mine),
    bbox: [10, 20, 100, 80],
  })));
  assert.equal(v.currentStatus, "observed");
  const observed: VisionObservationView | null = v.currentView;
  assert.deepEqual(observed?.bbox, [10, 20, 100, 80]);
  // Malformed bbox: view still accepted, overlay data stripped.
  const g = fakeDeps();
  const w = new VisionTrigger(g.deps);
  await w.look();
  const other = w.currentTriggerId!;
  w.handleObservation(new TextEncoder().encode(JSON.stringify({
    ...observationMessage(other),
    bbox: [1, "x", null, 4],
  })));
  assert.equal(w.currentStatus, "observed");
  assert.equal(w.currentView?.bbox, undefined);
});

test("discard and re-look invalidate outstanding triggers (late responses never display)", async () => {
  const f = fakeDeps();
  const v = new VisionTrigger(f.deps);
  await v.look();
  const stale = v.currentTriggerId!;
  v.discard();
  v.handleObservation(new TextEncoder().encode(JSON.stringify(observationMessage(stale))));
  assert.equal(v.currentView, null, "post-discard response must not display");
  await v.look();
  const fresh = v.currentTriggerId!;
  assert.notEqual(fresh, stale);
  v.handleObservation(new TextEncoder().encode(JSON.stringify(observationMessage(stale))));
  assert.equal(v.currentView, null, "superseded trigger response must not display");
  assert.equal(v.currentStatus, "sent");
  v.handleObservation(new TextEncoder().encode(JSON.stringify(observationMessage(fresh))));
  assert.equal(v.currentStatus, "observed");
});

test("capture/envelope failure publishes nothing and fails closed", async () => {
  const f = fakeDeps();
  const v = new VisionTrigger({
    ...f.deps,
    source: { capture: async () => { throw new Error("no camera"); } },
  });
  await v.look();
  assert.equal(v.currentStatus, "unavailable");
  assert.equal(v.currentTriggerId, null);
  assert.equal(f.calls.publish, 0, "no frame is published when capture fails");
  // Ticket 034: look() builds the envelope so an injected source returning
  // an oversized frame is still rejected before publish.
  const oversizedSource = {
    capture: async () => new Uint8Array(MAX_VISION_FRAME_BYTES + 1),
  };
  const g = fakeDeps();
  const w = new VisionTrigger({ ...g.deps, source: oversizedSource });
  await w.look();
  assert.equal(w.currentStatus, "unavailable", "oversized frame from injected source must fail");
  assert.equal(g.calls.publish, 0, "oversized frame must not be published");
  // buildVisionFrameEnvelope still rejects on its own (direct-call guard).
  assert.throws(() => buildVisionFrameEnvelope(new Uint8Array(MAX_VISION_FRAME_BYTES + 1), "t", "image/jpeg"), VisionEnvelopeError);
  assert.throws(() => buildVisionFrameEnvelope(new Uint8Array(0), "t", "image/jpeg"), VisionEnvelopeError);
  assert.throws(() => buildVisionFrameEnvelope(new Uint8Array([1]), "", "image/jpeg"), VisionEnvelopeError);
  assert.throws(() => buildVisionFrameEnvelope(new Uint8Array([1]), "t", "image/gif"), VisionEnvelopeError);
  // Ticket 034: envelope that fits the frame-byte pre-check but exceeds the
  // post-encode envelope bound must still be rejected.
  const largeFrame = new Uint8Array(37000); // base64 → ~49334 + JSON → >49152
  assert.throws(
    () => buildVisionFrameEnvelope(largeFrame, "00000000-0000-4000-8000-000000000000", "image/jpeg"),
    VisionEnvelopeError,
    "envelope over 49152B must be rejected",
  );

  // Ticket 034: previously large capture cannot bypass 48 KiB bound.
  // A source that returns a 37KB raw frame (would produce >48 KiB envelope
  // after base64+JSON) is rejected by look()'s buildVisionFrameEnvelope call.
  const largeFrameSource = {
    capture: async () => new Uint8Array(37000),
  };
  const h = fakeDeps();
  const u = new VisionTrigger({ ...h.deps, source: largeFrameSource });
  await u.look();
  assert.equal(u.currentStatus, "unavailable",
    "previously large capture (37KB raw) must not bypass 48 KiB envelope bound");
  assert.equal(h.calls.publish, 0, "oversized frame must not publish");

  // Ticket 034: max trigger id byte escaping — a 128-char trigger id with
  // high-entropy printable chars does not break envelope validation.
  const maxTid = "z".repeat(128);
  assert.ok(buildVisionFrameEnvelope(new Uint8Array([9, 8, 7]), maxTid, "image/jpeg").length > 0,
    "max-length trigger id must be accepted");
  // 129 chars fails.
  assert.throws(
    () => buildVisionFrameEnvelope(new Uint8Array([9, 8, 7]), "z".repeat(129), "image/jpeg"),
    VisionEnvelopeError,
    "trigger id > 128 chars must be rejected",
  );
  // Non-printable chars in trigger id fail.
  assert.throws(
    () => buildVisionFrameEnvelope(new Uint8Array([9, 8, 7]), "abc\ndef", "image/jpeg"),
    VisionEnvelopeError,
    "newline in trigger id must be rejected",
  );

  // Ticket 034: cancellation — source returning null must not publish.
  const nullSource = { capture: async () => null as unknown as Uint8Array };
  const i = fakeDeps();
  const x = new VisionTrigger({ ...i.deps, source: nullSource });
  await x.look();
  assert.equal(x.currentStatus, "unavailable");
  assert.equal(i.calls.publish, 0);
});

test("trigger ids are unique per click", () => {
  const ids = new Set([newTriggerId(), newTriggerId(), newTriggerId()]);
  assert.equal(ids.size, 3);
  for (const id of ids) assert.match(id, UUID_RE);
});

function failurePacket(triggerId: string, error = "observation-failed"): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({ trigger_id: triggerId, error }));
}

test("matching failure packet ends the wait with a failure status, not a view", async () => {
  const f = fakeDeps();
  const v = new VisionTrigger(f.deps);
  await v.look();
  const mine = v.currentTriggerId!;
  // Foreign trigger failure: ignored, still waiting.
  v.handleObservation(failurePacket("someone-elses-trigger", "persist-failed"));
  assert.equal(v.currentStatus, "sent");
  assert.equal(v.currentView, null);
  assert.equal(v.currentFailureCode, null);
  // Unknown error code: ignored (closed code set, no internals passthrough).
  v.handleObservation(failurePacket(mine, "disk exploded: /var/lib/secret"));
  assert.equal(v.currentStatus, "sent");
  assert.equal(v.currentFailureCode, null);
  // Non-string error: ignored.
  v.handleObservation(new TextEncoder().encode(JSON.stringify({ trigger_id: mine, error: 500 })));
  assert.equal(v.currentStatus, "sent");
  // Matching failure: status failed, no view, trigger consumed.
  v.handleObservation(failurePacket(mine, "persist-failed"));
  assert.equal(v.currentStatus, "failed");
  assert.equal(v.currentView, null);
  assert.equal(v.currentFailureCode, "persist-failed");
  assert.equal(v.currentTriggerId, null);
  // A late observation for the consumed trigger never displays.
  v.handleObservation(new TextEncoder().encode(JSON.stringify(observationMessage(mine))));
  assert.equal(v.currentView, null);
  assert.equal(v.currentStatus, "failed");
  // Recovery: discard returns to idle, and a fresh look works.
  v.discard();
  assert.equal(v.currentStatus, "idle");
  assert.equal(v.currentFailureCode, null);
  await v.look();
  assert.equal(v.currentStatus, "sent");
  const fresh = v.currentTriggerId!;
  assert.notEqual(fresh, mine);
  v.handleObservation(new TextEncoder().encode(JSON.stringify(observationMessage(fresh))));
  assert.equal(v.currentStatus, "observed");
});

function overlayMessage(triggerId: string, maskOverlay: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({
    ...observationMessage(triggerId),
    bbox: [0, 0, 10, 10],
    mask_overlay: maskOverlay,
  }));
}

test("mask overlay renders from actual worker outline; malformed overlay falls back to bbox", async () => {
  // Offset source bounds with matching dims: placed from overlay bounds, not bbox.
  const good = { svg: "M0 0L5 0L5 5L0 5Z", width: 5, height: 5, left: 211, top: 228, right: 216, bottom: 233 };
  const f = fakeDeps();
  const v = new VisionTrigger(f.deps);
  await v.look();
  const mine = v.currentTriggerId!;
  v.handleObservation(overlayMessage(mine, good));
  assert.equal(v.currentStatus, "observed");
  assert.deepEqual(v.currentView?.mask_overlay, good);
  assert.deepEqual(v.currentView?.bbox, [0, 0, 10, 10]);
  // Malformed overlays are dropped; the view and bbox highlight remain.
  const badOverlays: Array<[string, unknown]> = [
    ["oversized-dims", { ...good, width: 5000 }],
    ["zero-height", { ...good, height: 0 }],
    ["fractional-width", { ...good, width: 2.5 }],
    ["empty-svg", { ...good, svg: "" }],
    ["oversized-svg", { ...good, svg: `M${"0 ".repeat(9000)}` }],
    ["markup-in-svg", { ...good, svg: "M0 0<script>alert(1)</script>" }],
    ["missing-height", { svg: good.svg, width: 5, left: 211, top: 228, right: 216, bottom: 233 }],
    ["width-mismatch", { ...good, right: 217 }],
    ["height-mismatch", { ...good, bottom: 234 }],
    ["negative-left", { ...good, left: -1, right: 4 }],
    ["unordered", { ...good, left: 211, right: 211 }],
    ["fractional-top", { ...good, top: 228.5 }],
    ["missing-bounds", { svg: good.svg, width: 5, height: 5 }],
    ["not-an-object", "M0 0Z"],
  ];
  for (const [name, bad] of badOverlays) {
    const g = fakeDeps();
    const w = new VisionTrigger(g.deps);
    await w.look();
    w.handleObservation(overlayMessage(w.currentTriggerId!, bad));
    assert.equal(w.currentStatus, "observed", name);
    assert.equal(w.currentView?.mask_overlay, undefined, `${name}: no pixels kept`);
    assert.deepEqual(w.currentView?.bbox, [0, 0, 10, 10], `${name}: bbox fallback remains`);
  }
  // No overlay at all: bbox-only view, explicitly a bounding-box highlight.
  const h = fakeDeps();
  const u = new VisionTrigger(h.deps);
  await u.look();
  u.handleObservation(new TextEncoder().encode(JSON.stringify({
    ...observationMessage(u.currentTriggerId!),
    bbox: [1, 2, 30, 40],
  })));
  assert.equal(u.currentStatus, "observed");
  assert.equal(u.currentView?.mask_overlay, undefined);
});

test("failure packet for every stable worker code is accepted on a matching trigger", async () => {
  for (const code of ["observation-failed", "persist-failed", "sidecar-failed"]) {
    const f = fakeDeps();
    const v = new VisionTrigger(f.deps);
    await v.look();
    v.handleObservation(failurePacket(v.currentTriggerId!, code));
    assert.equal(v.currentStatus, "failed", code);
    assert.equal(v.currentFailureCode, code, code);
  }
});

// ---- Ticket 034 regression tests: late-capture / late-publish invalidation ----

test("late capture after discard never publishes and stays idle", async () => {
  let resolveCapture: ((b: Uint8Array) => void) | undefined;
  const retained = new Uint8Array([9, 9, 9]);
  let publishes = 0;
  const v = new VisionTrigger({
    source: {
      capture: () => new Promise<Uint8Array>((resolve) => { resolveCapture = resolve; }),
    },
    transport: {
      publishFrame: async () => { publishes++; },
    },
    onStatus: () => {},
  });
  const lookPromise = v.look();
  assert.equal(v.currentStatus, "capturing");
  // Discard while capture is still pending: generation bumps, state resets.
  v.discard();
  assert.equal(v.currentStatus, "idle");
  resolveCapture!(retained);
  await lookPromise;
  assert.equal(publishes, 0, "late capture must not publish after discard");
  assert.equal(v.currentStatus, "idle", "late capture must not resurrect state");
  assert.equal(v.currentTriggerId, null);
  // Owned frame bytes are zeroed on the discarded path.
  assert.deepEqual([...retained], [0, 0, 0], "discarded frame bytes must be cleared");
});

test("late capture failure after discard does not overwrite idle status", async () => {
  let rejectCapture: ((e: Error) => void) | undefined;
  let publishes = 0;
  const v = new VisionTrigger({
    source: {
      capture: () => new Promise<Uint8Array>((_resolve, reject) => { rejectCapture = reject; }),
    },
    transport: {
      publishFrame: async () => { publishes++; },
    },
    onStatus: () => {},
  });
  const lookPromise = v.look();
  v.discard();
  rejectCapture!(new Error("cancelled"));
  await lookPromise;
  // A stale capture failure must not be reported as a fresh unavailable.
  assert.equal(v.currentStatus, "idle");
  assert.equal(publishes, 0);
});

test("discard during publish never resurrects sent state", async () => {
  let v!: VisionTrigger;
  const published: string[] = [];
  v = new VisionTrigger({
    source: { capture: async () => new Uint8Array([4, 5, 6]) },
    transport: {
      publishFrame: async (_data, triggerId) => {
        published.push(triggerId);
        // Discard lands while publish is in-flight.
        v.discard();
      },
    },
    onStatus: () => {},
  });
  await v.look();
  assert.equal(published.length, 1, "the already-started publish still completes");
  assert.equal(v.currentStatus, "idle", "post-publish discard must win");
  assert.equal(v.currentTriggerId, null, "no outstanding trigger after discard");
});

test("re-look after discard: stale capture dropped, fresh capture publishes once", async () => {
  const pending: Array<(b: Uint8Array) => void> = [];
  const published: Array<{ triggerId: string; bytes: number[] }> = [];
  const v = new VisionTrigger({
    source: {
      capture: () => new Promise<Uint8Array>((resolve) => { pending.push(resolve); }),
    },
    transport: {
      publishFrame: async (data, triggerId) => {
        published.push({ triggerId, bytes: [...data] });
      },
    },
    onStatus: () => {},
  });
  const firstLook = v.look();
  const staleId = v.currentTriggerId; // null while capturing
  v.discard();
  const secondLook = v.look();
  assert.equal(pending.length, 2, "two captures are in-flight after re-look");
  // Resolve the stale first capture: it must be dropped, not published.
  pending[0](new Uint8Array([1, 1, 1]));
  await firstLook;
  assert.equal(published.length, 0, "stale capture must not publish");
  // Resolve the fresh second capture: it publishes exactly once.
  pending[1](new Uint8Array([2, 2, 2]));
  await secondLook;
  assert.equal(published.length, 1, "only the fresh capture publishes");
  assert.equal(v.currentStatus, "sent");
  assert.match(v.currentTriggerId ?? "", UUID_RE);
  assert.notEqual(v.currentTriggerId, staleId);
});

test("post-discard observation for a late-published trigger is ignored", async () => {
  let v!: VisionTrigger;
  let sentId: string | null = null;
  v = new VisionTrigger({
    source: { capture: async () => new Uint8Array([7, 7, 7]) },
    transport: {
      publishFrame: async (_data, triggerId) => {
        sentId = triggerId;
        v.discard(); // drop while publishing
      },
    },
    onStatus: () => {},
  });
  await v.look();
  assert.ok(sentId);
  // Even an observation echoing the late trigger id must not display.
  v.handleObservation(new TextEncoder().encode(JSON.stringify(observationMessage(sentId!))));
  assert.equal(v.currentView, null);
  assert.equal(v.currentStatus, "idle");
});

// ---- Ticket 034: owned-buffer clearing (frame + envelope) ----

test("source frame bytes are zeroed after a successful publish", async () => {
  const frame = new Uint8Array([9, 8, 7]);
  const published: Uint8Array[] = [];
  const v = new VisionTrigger({
    source: { capture: async () => frame },
    transport: {
      publishFrame: async (data) => {
        // Transport copies what it needs before the promise resolves.
        published.push(data.slice());
      },
    },
    onStatus: () => {},
  });
  await v.look();
  assert.equal(v.currentStatus, "sent");
  assert.deepEqual([...frame], [0, 0, 0], "source bytes must be cleared after publish settles");
  // The transport copy still carries the expected frame data.
  const env = JSON.parse(new TextDecoder().decode(published[0])) as Record<string, unknown>;
  assert.equal(env.image_base64, bytesToBase64(new Uint8Array([9, 8, 7])));
});

test("source frame bytes are zeroed when publish fails", async () => {
  const frame = new Uint8Array([4, 5, 6]);
  const v = new VisionTrigger({
    source: { capture: async () => frame },
    transport: { publishFrame: async () => { throw new Error("network down"); } },
    onStatus: () => {},
  });
  await v.look();
  assert.equal(v.currentStatus, "unavailable");
  assert.deepEqual([...frame], [0, 0, 0], "source bytes must be cleared after a failed publish");
});

test("oversized source frame bytes are zeroed after rejection", async () => {
  const frame = new Uint8Array(MAX_VISION_FRAME_BYTES + 1).fill(1);
  let publishes = 0;
  const v = new VisionTrigger({
    source: { capture: async () => frame },
    transport: { publishFrame: async () => { publishes++; } },
    onStatus: () => {},
  });
  await v.look();
  assert.equal(v.currentStatus, "unavailable");
  assert.equal(publishes, 0, "oversized frame must not publish");
  assert.ok(frame.every((b) => b === 0), "oversized frame bytes must be cleared");
});

test("envelope is zeroed only after async publish settles, never while pending", async () => {
  const frame = new Uint8Array([1, 2, 3]);
  let envelopeRef: Uint8Array | null = null;
  let copy: Uint8Array | null = null;
  let releasePublish!: () => void;
  let publishStarted!: () => void;
  const started = new Promise<void>((resolve) => { publishStarted = resolve; });
  const v = new VisionTrigger({
    source: { capture: async () => frame },
    transport: {
      publishFrame: async (data) => {
        envelopeRef = data; // reference, not a copy
        copy = data.slice(); // what a real transport would snapshot
        publishStarted();
        await new Promise<void>((resolve) => { releasePublish = resolve; });
      },
    },
    onStatus: () => {},
  });
  const lookPromise = v.look();
  await started;
  // No clearing while publish is still pending.
  assert.ok(frame.some(Boolean), "source bytes must survive while publish is pending");
  assert.ok(envelopeRef!.some(Boolean), "envelope must survive while publish is pending");
  releasePublish();
  await lookPromise;
  assert.equal(v.currentStatus, "sent");
  assert.deepEqual([...frame], [0, 0, 0], "source bytes zeroed after publish settles");
  assert.ok(envelopeRef!.every((b) => b === 0), "envelope zeroed after publish settles");
  // The transport's snapshot still holds the transmitted payload.
  const env = JSON.parse(new TextDecoder().decode(copy!)) as Record<string, unknown>;
  assert.equal(env.image_base64, bytesToBase64(new Uint8Array([1, 2, 3])));
});
