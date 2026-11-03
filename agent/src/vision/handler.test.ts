// Ticket 008 offline self-checks for the agent-side vision-frame handler.
// Synthetic fixtures only; no Meta API calls, no personal images, no
// credentials. SAM/Spark/store/publish are injected fakes. Run after build:
//   node --test dist/vision/handler.test.js
// (Compiled-run: tsc's NodeNext build requires `.js` specifiers, which plain
// `node --test` on TS sources cannot resolve — so tests run from dist.)
import test from "node:test";
import assert from "node:assert/strict";
import {
  handleVisionFrame,
  isKnownSender,
  isTransportableOverlay,
  parseVisionFrameEnvelope,
  SenderInflightGate,
  toFailureMessage,
  toObservationMessage,
  VISION_FAILURE_CODES,
  VisionFrameRejected,
  type VisionFrameDeps,
} from "./handler.js";
import { frameHashHex } from "./frame.js";
import { VISION_OBSERVATION_MAX_TOKENS } from "./spark.js";
import { observationToExtraction } from "../memory/observation.js";
import { validateExtraction } from "../memory/schema.js";

const OWNER = "owner-browser-1";
const CHARACTER = "test-character";

function envelope(overrides: Record<string, unknown> = {}): Uint8Array {
  const frame = new Uint8Array([1, 2, 3, 4]);
  const base = {
    version: 1,
    trigger_id: "trigger-1",
    mime: "image/png",
    image_base64: Buffer.from(frame).toString("base64"),
  };
  return new TextEncoder().encode(JSON.stringify({ ...base, ...overrides }));
}

interface FakeCalls {
  sam: number;
  spark: number;
  published: Uint8Array[];
  persisted: unknown[];
  sidecarLinked: unknown[];
  seenFrames: Uint8Array[];
  lastSparkReq: Record<string, unknown> | null;
}

function fakes(opts: { samThrows?: boolean; persistThrows?: boolean; sidecarThrows?: boolean; overlay?: { svg: string; width: number; height: number; left: number; top: number; right: number; bottom: number } | null } = {}): { deps: VisionFrameDeps; calls: FakeCalls } {
  const calls: FakeCalls = { sam: 0, spark: 0, published: [], persisted: [], sidecarLinked: [], seenFrames: [], lastSparkReq: null };
  const deps: VisionFrameDeps = {
    sam: {
      async segment(frame: Uint8Array) {
        calls.sam++;
        calls.seenFrames.push(frame);
        if (opts.samThrows) throw new Error("synthetic sam failure");
        return [{ id: "mask-1", bbox: [0, 0, 2, 2], area: 4, ...(opts.overlay ? { overlay: opts.overlay } : {}) }];
      },
    },
    spark: {
      async observe(req) {
        calls.spark++;
        calls.lastSparkReq = req as unknown as Record<string, unknown>;
        return { object_label: "synthetic widget", observation: "SYNTHETIC — a small test widget.", confidence: 0.7 };
      },
    },
    characterId: CHARACTER,
    gate: new SenderInflightGate(),
    publish: async (data: Uint8Array) => {
      calls.published.push(data);
    },
    persist: async (record) => {
      if (opts.persistThrows) throw new Error("synthetic store failure");
      calls.persisted.push(record);
      return `mem-record-for-${(record as { trigger_id: string }).trigger_id}`;
    },
    linkSidecar: async (entry) => {
      if (opts.sidecarThrows) throw new Error("synthetic sidecar failure");
      calls.sidecarLinked.push(entry);
    },
  };
  return { deps, calls };
}

test("validation rejects malformed envelopes; pipeline, publish and persist untouched", async () => {
  const bad: Array<[string, Uint8Array]> = [
    ["empty", new Uint8Array()],
    ["raw-bytes", new Uint8Array([1, 2, 3, 4])],
    ["not-json", new TextEncoder().encode("not json")],
    ["array", new TextEncoder().encode("[1,2]")],
    ["unknown-field", envelope({ extra: true })],
    ["bad-version", envelope({ version: 2 })],
    ["missing-trigger", envelope({ trigger_id: undefined })],
    ["empty-trigger", envelope({ trigger_id: "" })],
    ["bad-mime", envelope({ mime: "image/gif" })],
    ["bad-base64-chars", envelope({ image_base64: "!!!not-base64!!!" })],
    ["bad-base64-padding", envelope({ image_base64: "ABC" })],
    ["empty-image", envelope({ image_base64: "" })],
  ];
  for (const [name, payload] of bad) {
    const { deps, calls } = fakes();
    const out = await handleVisionFrame(payload, OWNER, deps);
    assert.equal(out.ok, false, name);
    assert.equal(calls.sam, 0, `${name}: sam called`);
    assert.equal(calls.spark, 0, `${name}: spark called`);
    assert.equal(calls.published.length, 0, `${name}: published`);
    assert.equal(calls.persisted.length, 0, `${name}: persisted`);
  }
  assert.throws(() => parseVisionFrameEnvelope(new Uint8Array([9])), VisionFrameRejected);
});

test("sender policy: empty identity rejected; any nonempty participant admitted (demo access, no allowlist)", async () => {
  const good = envelope();
  for (const identity of [undefined, null, ""]) {
    const { deps, calls } = fakes();
    const out = await handleVisionFrame(good, identity as string | undefined, deps);
    assert.deepEqual(out, { ok: false, code: "unknown-sender" });
    assert.equal(calls.sam, 0);
    assert.equal(calls.spark, 0);
    assert.equal(calls.published.length, 0);
  }
  assert.ok(!isKnownSender(undefined));
  assert.ok(!isKnownSender(""));
  assert.ok(isKnownSender(OWNER));
  // A self-asserted guest name is admitted: participant demo access, not
  // owner authentication. No allowlist is consulted.
  for (const guest of ["stranger-guest", "guest-ab12cd"]) {
    const { deps, calls } = fakes();
    const out = await handleVisionFrame(envelope({ trigger_id: `trigger-${guest}` }), guest, deps);
    assert.equal(out.ok, true, `guest ${guest} must be admitted`);
    assert.equal(calls.sam, 1);
    assert.equal(calls.published.length, 1);
    const msg = JSON.parse(new TextDecoder().decode(calls.published[0])) as Record<string, unknown>;
    assert.equal(msg.trigger_id, `trigger-${guest}`);
  }
});

test("pipeline failure persists nothing but notifies the browser; frame zeroed", async () => {
  const { deps, calls } = fakes({ samThrows: true });
  const out = await handleVisionFrame(envelope(), OWNER, deps);
  assert.deepEqual(out, { ok: false, code: "observation-failed" });
  assert.equal(calls.persisted.length, 0);
  assert.equal(calls.seenFrames.length, 1);
  assert.ok(calls.seenFrames[0].every((b) => b === 0), "frame buffer zeroed on failure");
  // Exactly one metadata-only failure packet carrying the original trigger,
  // so the browser stops waiting instead of hanging on "sent".
  assert.equal(calls.published.length, 1);
  const text = new TextDecoder().decode(calls.published[0]);
  assert.deepEqual(JSON.parse(text), { trigger_id: "trigger-1", error: "observation-failed" });
  assert.ok(!text.includes("AQIDBA=="), "no frame content in failure packet");
});

test("success: one SAM + one Spark call, store persist + sidecar link, metadata-only publish, zeroed frame", async () => {
  const { deps, calls } = fakes();
  const out = await handleVisionFrame(envelope({ trigger_id: "trigger-9" }), OWNER, deps);
  assert.equal(calls.sam, 1);
  assert.equal(calls.spark, 1);
  const expectedHash = frameHashHex(new Uint8Array([1, 2, 3, 4]));
  assert.deepEqual(out, { ok: true, frameHash: expectedHash, triggerId: "trigger-9", durable: true });
  // Persisted via the existing extraction mapping.
  assert.equal(calls.persisted.length, 1);
  const mapped = observationToExtraction(calls.persisted[0] as never);
  const [accepted] = validateExtraction({ memories: [mapped] }, mapped.source_turn_ids);
  assert.equal(accepted.type, "event");
  assert.deepEqual(mapped.source_turn_ids, [`vision:trigger-9:${expectedHash}`]);
  // Frozen 004 schema carries no mask_ref: the gap is pinned, not widened.
  assert.ok(!("mask_ref" in mapped), "mask_ref has no MemoryStore field (frozen schema)");
  // Sidecar linked to the created record id with metadata only.
  assert.equal(calls.sidecarLinked.length, 1);
  const link = calls.sidecarLinked[0] as Record<string, unknown>;
  assert.deepEqual(Object.keys(link).sort(),
    ["character_id", "frame_hash", "mask_ref", "record_id", "schema_version", "timestamp", "trigger_id"]);
  assert.equal(link.record_id, "mem-record-for-trigger-9");
  assert.equal(link.character_id, CHARACTER);
  assert.equal(link.frame_hash, expectedHash);
  assert.equal(link.mask_ref, "mask-1");
  assert.equal(link.trigger_id, "trigger-9");
  // Published message is metadata only, with the display bbox for the overlay.
  assert.equal(calls.published.length, 1);
  const text = new TextDecoder().decode(calls.published[0]);
  const msg = JSON.parse(text) as Record<string, unknown>;
  assert.equal(msg.object_label, "synthetic widget");
  assert.equal(msg.frame_hash, expectedHash);
  assert.equal(msg.mask_ref, "mask-1");
  assert.equal(msg.trigger_id, "trigger-9");
  assert.equal(msg.synthetic, false);
  assert.equal(msg.durable, true);
  assert.deepEqual(msg.bbox, [0, 0, 2, 2]);
  assert.ok(!text.includes("AQIDBA=="), "no base64 in published message");
  assert.ok(!text.includes("mime"), "no mime/bytes in published message");
  // Frame zeroed on success too.
  assert.ok(calls.seenFrames[0].every((b) => b === 0), "frame buffer zeroed on success");
  // toObservationMessage never embeds bytes.
  assert.deepEqual(Object.keys(toObservationMessage(calls.persisted[0] as never)).sort(),
    ["bbox", "confidence", "durable", "frame_hash", "mask_ref", "object_label", "summary", "synthetic", "trigger_id"]);
});

test("observer receives the cookbook structured-output request shape", async () => {
  const { deps, calls } = fakes();
  await handleVisionFrame(envelope(), OWNER, deps);
  const req = calls.lastSparkReq!;
  assert.equal(req.model, "muse-spark-1.3");
  assert.equal(req.max_tokens, VISION_OBSERVATION_MAX_TOKENS);
  const fmt = req.response_format as Record<string, Record<string, unknown>>;
  assert.equal(fmt.json_schema.strict, true);
  assert.equal(fmt.json_schema.name, "soulbound_vision_observation_v1");
  const messages = req.messages as Array<{ role: string; content: unknown }>;
  const userParts = messages.find((m) => m.role === "user")!.content as Array<Record<string, unknown>>;
  const img = userParts.find((p) => p.type === "image_url")!.image_url as { url: string };
  assert.ok(img.url.startsWith("data:image/png;base64,"), "image sent as data URL, not raw bytes");
  // JPEG envelope (what the browser trigger sends) reaches Spark as a JPEG data URL.
  const jpeg = fakes();
  await handleVisionFrame(envelope({ mime: "image/jpeg", trigger_id: "trigger-jpeg" }), OWNER, jpeg.deps);
  const jpegUrl = ((jpeg.calls.lastSparkReq!.messages as Array<{ role: string; content: Array<Record<string, unknown>> }>)
    .find((m) => m.role === "user")!.content.find((p) => p.type === "image_url")!.image_url as { url: string }).url;
  assert.ok(jpegUrl.startsWith("data:image/jpeg;base64,"), "Spark data URL MIME matches the envelope");
});

test("persistence disabled publishes non-durable; persist/sidecar failure notifies, never success", async () => {
  const { deps, calls } = fakes();
  const { persist: _dropPersist, linkSidecar: _dropSidecar, ...noStore } = deps;
  const out = await handleVisionFrame(envelope(), OWNER, noStore);
  assert.deepEqual(out, { ok: true, frameHash: frameHashHex(new Uint8Array([1, 2, 3, 4])), triggerId: "trigger-1", durable: false });
  assert.equal(calls.published.length, 1);
  // Transient result is labeled durable:false, never presented as saved memory.
  const transient = JSON.parse(new TextDecoder().decode(calls.published[0])) as Record<string, unknown>;
  assert.equal(transient.durable, false);
  assert.equal(transient.trigger_id, "trigger-1");
  // Store failure: no durable success is reported; one failure packet instead.
  const failing = fakes({ persistThrows: true });
  const out2 = await handleVisionFrame(envelope(), OWNER, failing.deps);
  assert.deepEqual(out2, { ok: false, code: "persist-failed" });
  assert.equal(failing.calls.sidecarLinked.length, 0, "sidecar never links without a record id");
  assert.equal(failing.calls.published.length, 1, "browser is notified instead of waiting forever");
  assert.deepEqual(JSON.parse(new TextDecoder().decode(failing.calls.published[0])), { trigger_id: "trigger-1", error: "persist-failed" });
  // Sidecar failure: same — no success claim, one failure packet.
  const sidecarFailing = fakes({ sidecarThrows: true });
  const out3 = await handleVisionFrame(envelope(), OWNER, sidecarFailing.deps);
  assert.deepEqual(out3, { ok: false, code: "sidecar-failed" });
  assert.equal(sidecarFailing.calls.persisted.length, 1, "store append already happened (sequential link)");
  assert.equal(sidecarFailing.calls.published.length, 1);
  assert.deepEqual(JSON.parse(new TextDecoder().decode(sidecarFailing.calls.published[0])), { trigger_id: "trigger-1", error: "sidecar-failed" });
});

test("mask overlay travels only in the correlated response, never into memory", async () => {
  const overlay = { svg: "M0 0L2 0L2 2L0 2Z", width: 2, height: 2, left: 0, top: 0, right: 2, bottom: 2 };
  const { deps, calls } = fakes({ overlay });
  const out = await handleVisionFrame(envelope({ trigger_id: "trigger-mask" }), OWNER, deps);
  assert.equal(out.ok, true);
  assert.equal(calls.published.length, 1);
  const msg = JSON.parse(new TextDecoder().decode(calls.published[0])) as Record<string, unknown>;
  assert.deepEqual(msg.mask_overlay, overlay, "response carries the actual outline");
  assert.equal(msg.trigger_id, "trigger-mask", "overlay is correlated to its trigger");
  assert.deepEqual(msg.bbox, [0, 0, 2, 2], "bbox still present as the fallback");
  // Privacy: persisted record, sidecar entry, and extraction carry no pixels.
  assert.ok(!JSON.stringify(calls.persisted[0]).includes("mask_overlay"), "store record has no overlay");
  assert.ok(!JSON.stringify(calls.persisted[0]).includes("M0 0"), "store record has no path data");
  assert.ok(!JSON.stringify(calls.sidecarLinked[0]).includes("mask_overlay"), "sidecar has no overlay");
  const mapped = observationToExtraction(calls.persisted[0] as never);
  assert.ok(!JSON.stringify(mapped).includes("mask_overlay"), "memory/Merkle path has no overlay");
});

test("message boundary drops malformed overlays; bbox highlight remains", async () => {
  const { deps, calls } = fakes();
  const out = await handleVisionFrame(envelope({ trigger_id: "trigger-bbox" }), OWNER, deps);
  assert.equal(out.ok, true);
  const record = calls.persisted[0] as never;
  const box = { left: 0, top: 0, right: 2, bottom: 2 };
  assert.ok(isTransportableOverlay({ svg: "M0 0L2 0L2 2L0 2Z", width: 2, height: 2, ...box }));
  const bad: Array<[string, unknown]> = [
    ["oversized-dims", { svg: "M0 0Z", width: 5000, height: 5, ...box }],
    ["zero-dims", { svg: "M0 0Z", width: 0, height: 5, ...box }],
    ["fractional-dims", { svg: "M0 0Z", width: 2.5, height: 2, ...box }],
    ["empty-svg", { svg: "", width: 2, height: 2, ...box }],
    ["oversized-svg", { svg: `M${"0 ".repeat(9000)}`, width: 2, height: 2, ...box }],
    ["markup-in-svg", { svg: "M0 0<script>", width: 2, height: 2, ...box }],
    ["missing-width", { svg: "M0 0Z", height: 2, ...box }],
    ["missing-bounds", { svg: "M0 0Z", width: 2, height: 2 }],
    ["width-mismatch", { svg: "M0 0Z", width: 2, height: 2, left: 211, top: 228, right: 214, bottom: 230 }],
    ["height-mismatch", { svg: "M0 0Z", width: 2, height: 2, left: 0, top: 0, right: 2, bottom: 3 }],
    ["negative-left", { svg: "M0 0Z", width: 2, height: 2, left: -1, top: 0, right: 1, bottom: 2 }],
    ["unordered", { svg: "M0 0Z", width: 2, height: 2, left: 0, top: 0, right: 0, bottom: 2 }],
    ["fractional-top", { svg: "M0 0Z", width: 2, height: 2, left: 0, top: 0.5, right: 2, bottom: 2 }],
    ["null", null],
  ];
  for (const [name, overlay] of bad) {
    assert.ok(!isTransportableOverlay(overlay), name);
    const bare = JSON.parse(JSON.stringify(toObservationMessage(record, true, overlay as never))) as Record<string, unknown>;
    assert.ok(!("mask_overlay" in bare), `${name}: no overlay on the wire`);
    assert.deepEqual(bare.bbox, [0, 0, 2, 2], `${name}: bbox fallback remains`);
  }
});

test("failure packets are a closed metadata-only schema; pre-trigger rejections stay silent", async () => {
  // Exact keys: trigger correlation plus one bounded code. No content fields.
  assert.deepEqual(Object.keys(toFailureMessage("t-1", "persist-failed")).sort(), ["error", "trigger_id"]);
  for (const code of VISION_FAILURE_CODES) {
    const text = JSON.stringify(toFailureMessage("t-1", code));
    assert.ok(text.length < 256, "failure packet is tiny metadata");
    assert.ok(!text.includes("base64") && !text.includes("mime"), "no frame/content keys in failure packet");
  }
  // No established trigger means no correlation target: silent rejection.
  for (const [name, payload, sender] of [
    ["bad-envelope", new TextEncoder().encode("not json"), OWNER],
    ["unknown-sender", envelope(), ""],
  ] as Array<[string, Uint8Array, string]>) {
    const { deps, calls } = fakes();
    const out = await handleVisionFrame(payload, sender, deps);
    assert.equal(out.ok, false, name);
    assert.equal(calls.published.length, 0, `${name}: nothing to correlate, nothing published`);
  }
});

test("one in-flight request per sender; gate releases after completion", async () => {
  // Contended SAM: the first trigger parks inside segment until released.
  let release!: () => void;
  const gate = new SenderInflightGate();
  const { deps, calls } = fakes();
  const parked = new Promise<void>((resolve) => { release = resolve; });
  const blockingSam = {
    async segment(frame: Uint8Array) {
      calls.sam++;
      calls.seenFrames.push(frame);
      await parked;
      return [{ id: "mask-1", bbox: [0, 0, 2, 2] as [number, number, number, number], area: 4 }];
    },
  };
  const blockingDeps = { ...deps, sam: blockingSam, gate };
  const first = handleVisionFrame(envelope({ trigger_id: "trigger-a" }), OWNER, blockingDeps);
  // Spark-first: the first trigger reaches SAM after its Spark call resolves.
  for (let i = 0; i < 100 && calls.sam === 0; i++) await new Promise((r) => setTimeout(r, 5));
  assert.equal(calls.sam, 1, "first trigger is parked inside SAM");
  // Same sender while the first is in flight: rejected before any new SAM call.
  const samBefore = calls.sam;
  const second = await handleVisionFrame(envelope({ trigger_id: "trigger-b" }), OWNER, { ...deps, gate });
  assert.deepEqual(second, { ok: false, code: "trigger-in-flight" });
  assert.equal(calls.sam, samBefore, "concurrent trigger runs no new pipeline work");
  // A different participant sender is unaffected.
  const other = await handleVisionFrame(envelope({ trigger_id: "trigger-c" }), "second-sender", {
    ...deps, gate,
  });
  assert.equal(other.ok, true);
  release();
  const done = await first;
  assert.equal(done.ok, true);
  // Gate released: the same sender may trigger again.
  const retry = await handleVisionFrame(envelope({ trigger_id: "trigger-d" }), OWNER, { ...deps, gate });
  assert.equal(retry.ok, true);
  assert.equal(gate.size, 0, "gate holds no stale sender");
});
