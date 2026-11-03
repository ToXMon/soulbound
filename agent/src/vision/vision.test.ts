// Ticket 008 self-checks. Synthetic fixtures only; no Meta API calls, no
// personal images, no credentials. Run: node --test agent/vision/vision.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import {
  validateObservationRecord,
  observationToExtraction,
  type VisionObservationRecord,
} from "../memory/observation.js";
import { frameHashHex, discardFrame, VisionUnavailable } from "./frame.js";
import { createMetaSamClient, normalizeResponseEvents, parseSegmentationEvents, samInput, toMaskOverlay, MAX_MASK_RASTER_DIM, MAX_MASK_SVG_CHARS, VisionNotConfigured } from "./sam.js";
import { parseImageStream, recordsOfKind } from "@meta-sam/parser";
import { createSparkObserver, buildObservationRequest, validateSparkObservation, VISION_OBSERVATION_JSON_SCHEMA, VISION_OBSERVATION_MAX_TOKENS } from "./spark.js";
import { runTriggeredObservation } from "./observe.js";
import { validateExtraction } from "../memory/schema.js";

const HEX64 = /^[0-9a-f]{64}$/;

function goodRecord(): VisionObservationRecord {
  return validateObservationRecord({
    schema_version: 1,
    kind: "vision_observation",
    character_id: "synthetic-character",
    frame_hash: "ab".repeat(32),
    mask_ref: "synthetic-mask-ref",
    timestamp: "2026-10-31T12:00:00.000Z",
    object_label: "potted plant (synthetic fixture)",
    summary: "SYNTHETIC FIXTURE — a green potted plant on the desk.",
    confidence: 0.5,
    trigger_id: "synthetic-trigger-1",
    synthetic: true,
  });
}

test("REQ-44: observation record validation is strict about provenance fields", () => {
  const ok = goodRecord();
  assert.match(ok.frame_hash, HEX64);
  assert.equal(ok.mask_ref, "synthetic-mask-ref");
  assert.equal(ok.trigger_id, "synthetic-trigger-1");
  assert.equal(ok.synthetic, true);
  for (const drop of ["frame_hash", "mask_ref", "timestamp", "trigger_id", "synthetic"]) {
    const bad = { ...goodRecord() } as Record<string, unknown>;
    delete bad[drop];
    assert.throws(() => validateObservationRecord(bad), new RegExp(drop.replace("_", "_")));
  }
  assert.throws(() => validateObservationRecord({ ...goodRecord(), frame_bytes: [1, 2, 3] }), /unknown field/);
  assert.throws(() => validateObservationRecord({ ...goodRecord(), frame_hash: "not-hex" }), /frame_hash/);
  assert.throws(() => validateObservationRecord({ ...goodRecord(), confidence: 1.5 }), /confidence/);
});

test("004 integration: observation maps to a store-valid extraction (summary recall path)", () => {
  const mapped = observationToExtraction(goodRecord());
  const [accepted] = validateExtraction(
    { memories: [mapped] },
    mapped.source_turn_ids,
  );
  assert.equal(accepted.type, "event");
  assert.match(accepted.summary, /potted plant/);
  assert.deepEqual(accepted.source_turn_ids, [`vision:synthetic-trigger-1:${"ab".repeat(32)}`]);
  const sameTriggerReplay = observationToExtraction(goodRecord());
  assert.deepEqual(sameTriggerReplay.source_turn_ids, mapped.source_turn_ids, "same trigger replay is idempotent");
  const nextTrigger = observationToExtraction(validateObservationRecord({
    ...goodRecord(), trigger_id: "synthetic-trigger-2",
  }));
  assert.notDeepEqual(nextTrigger.source_turn_ids, mapped.source_turn_ids,
    "a new explicit trigger on identical frame bytes is a distinct observation");
});

test("frame hashing uses pinned keccak-256 and matches the known vector", () => {
  try {
    assert.equal(
      frameHashHex(new TextEncoder().encode("abc")),
      "4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45",
    );
  } catch (e) {
    if (e instanceof VisionUnavailable) {
      // Blocked offline: pinned js-sha3 not installed. Run `pnpm install` with
      // the existing lockfile (no new deps) to enable this test.
      throw new Error("BLOCKED: js-sha3 missing; pinned install required before vision verification");
    }
    throw e;
  }
});

test("REQ-43 contract: observation requires an explicit trigger_id and discards the frame", async () => {
  const frame = new Uint8Array([1, 2, 3, 4, 5]);
  await assert.rejects(
    runTriggeredObservation(frame, {
      sam: createMetaSamClient({}), // throws not-configured before any output
      spark: createSparkObserver({}),
      characterId: "synthetic-character",
      triggerId: "",
    }),
    /trigger_id/,
  );
  // Even on failure the frame is zeroed.
  assert.deepEqual([...frame], [0, 0, 0, 0, 0]);
});

test("unconfigured clients never fabricate output", async () => {
  await assert.rejects(createMetaSamClient({}).segment(new Uint8Array([1])), VisionNotConfigured);
  await assert.rejects(
    createSparkObserver({}).observe(buildObservationRequest({
      model: "muse-spark-1.3", frameBase64: "", maskRef: "m", frameHash: "f",
    })),
    /MODEL_API_KEY/,
  );
  // Contributor-tier models are forbidden for frame data even when configured.
  await assert.rejects(
    createSparkObserver({ apiKey: "x" }).observe(buildObservationRequest({
      model: "muse-spark-1.3-contributor", frameBase64: "AA==", maskRef: "m", frameHash: "f",
    })),
    /contributor/,
  );
});

test("SAM adapter parses a split live-shaped event stream (synthetic, offline)", async () => {
  // One 5x5 one_bit mask line, split mid-payload across two deltas, finalized
  // the way the live SAM API finalizes (content_part.done, no output_text.done).
  const text = "<0f>0<|box;x1=0;y1=0;x2=4;y2=4;w=5;h=5|><|mask;x=0;y=0;data=5,5,!!!!!(QO(0lu8?|>";
  const split = text.indexOf("QO(");
  const lane = { item_id: "msg-1", output_index: 0, content_index: 0 };
  const events = [
    { type: "response.output_text.delta", ...lane, delta: text.slice(0, split) },
    { type: "response.output_text.delta", ...lane, delta: text.slice(split) },
    { type: "response.content_part.done", ...lane, part: { type: "output_text", text } },
    { type: "response.completed" },
  ];
  const masks = await parseSegmentationEvents(events as never);
  assert.equal(masks.length, 1);
  assert.equal(masks[0].id, "0");
  assert.deepEqual(masks[0].bbox, [0, 0, 5, 5]);
  assert.ok(masks[0].area > 0 && masks[0].area <= 25);
});

test("observation bbox is optional display metadata, strictly validated", () => {
  const withBox = validateObservationRecord({ ...goodRecord(), bbox: [1, 2, 30, 40] });
  assert.deepEqual(withBox.bbox, [1, 2, 30, 40]);
  // bbox never leaks into the frozen extraction shape.
  const mapped = observationToExtraction(withBox);
  assert.ok(!("bbox" in mapped), "bbox is display-only, not durable memory content");
  assert.throws(() => validateObservationRecord({ ...goodRecord(), bbox: [1, 2, 3] }), /bbox/);
  assert.throws(() => validateObservationRecord({ ...goodRecord(), bbox: [1, 2, -3, 4] }), /bbox/);
  assert.throws(() => validateObservationRecord({ ...goodRecord(), bbox: "0,0,5,5" }), /bbox/);
});

const SYNTHETIC_MASK_TEXT = "<0f>0<|box;x1=0;y1=0;x2=4;y2=4;w=5;h=5|><|mask;x=0;y=0;data=5,5,!!!!!(QO(0lu8?|>";

async function syntheticMaskRecord() {
  const lane = { item_id: "msg-1", output_index: 0, content_index: 0 };
  async function* events() {
    yield { type: "response.output_text.delta", ...lane, delta: SYNTHETIC_MASK_TEXT.slice(0, 20) };
    yield { type: "response.output_text.delta", ...lane, delta: SYNTHETIC_MASK_TEXT.slice(20) };
    yield { type: "response.content_part.done", ...lane, part: { type: "output_text", text: SYNTHETIC_MASK_TEXT } };
    yield { type: "response.completed" };
  }
  const result = await parseImageStream(normalizeResponseEvents(events())).finalResult;
  if (result.outcome.status !== "completed") throw new Error("synthetic stream did not complete");
  const [record] = recordsOfKind(result.records, "mask");
  return record;
}

test("mask overlay encodes actual parser output within transport bounds", async () => {
  const record = await syntheticMaskRecord();
  const overlay = toMaskOverlay(record.mask, record.bounds);
  assert.ok(overlay, "synthetic mask converts to an overlay");
  // Raster dims are the parser's own, echoed exactly — never invented.
  assert.equal(overlay.width, record.mask.width);
  assert.equal(overlay.height, record.mask.height);
  // Source bounds are the record's own bounds, echoed exactly.
  assert.deepEqual(
    [overlay.left, overlay.top, overlay.right, overlay.bottom],
    [record.bounds.left, record.bounds.top, record.bounds.right, record.bounds.bottom],
  );
  assert.ok(overlay.svg.length > 0 && overlay.svg.length <= MAX_MASK_SVG_CHARS);
  assert.match(overlay.svg, /^[Mm]/, "SVG path data");
  // parseSegmentationEvents attaches the same overlay to the chosen mask.
  const lane = { item_id: "msg-1", output_index: 0, content_index: 0 };
  async function* events() {
    yield { type: "response.output_text.delta", ...lane, delta: SYNTHETIC_MASK_TEXT };
    yield { type: "response.content_part.done", ...lane, part: { type: "output_text", text: SYNTHETIC_MASK_TEXT } };
    yield { type: "response.completed" };
  }
  const [mask] = await parseSegmentationEvents(events() as never);
  assert.deepEqual(mask.overlay, overlay);
});

test("mask overlay rejects out-of-bounds and undecodable masks without throwing", async () => {
  const record = await syntheticMaskRecord();
  const good = record.mask;
  const bounds = record.bounds; // 0,0,5,5 for the 5x5 fixture raster
  assert.equal(toMaskOverlay({ ...good, width: 0 }, bounds), null, "zero width");
  assert.equal(toMaskOverlay({ ...good, height: -3 }, bounds), null, "negative height");
  assert.equal(toMaskOverlay({ ...good, width: MAX_MASK_RASTER_DIM + 1 }, bounds), null, "oversized width");
  assert.equal(toMaskOverlay({ ...good, height: MAX_MASK_RASTER_DIM + 1 }, bounds), null, "oversized height");
  assert.equal(toMaskOverlay({ ...good, width: 1.5 }, bounds), null, "fractional width");
  assert.equal(toMaskOverlay({ ...good, payload: "!!!not-a-mask!!!" }, bounds), null, "undecodable payload");
  assert.equal(toMaskOverlay({ ...good, encoding: "bogus" } as never, bounds), null, "unknown encoding");
  assert.equal(toMaskOverlay(null as never, bounds), null, "null mask");
  assert.equal(toMaskOverlay(undefined as never, bounds), null, "missing mask");
  assert.equal(toMaskOverlay(good, null), null, "missing bounds");
  assert.equal(toMaskOverlay(good, undefined), null, "undefined bounds");
});

test("mask overlay requires exact raster/bounds correspondence, else bbox fallback", async () => {
  const record = await syntheticMaskRecord();
  const good = record.mask; // 5x5 fixture raster
  // Offset source box with matching dims: accepted, bounds carried verbatim.
  const offset = toMaskOverlay(good, { left: 211, top: 228, right: 216, bottom: 233 });
  assert.ok(offset, "offset box with matching dims converts");
  assert.deepEqual([offset.left, offset.top, offset.right, offset.bottom], [211, 228, 216, 233]);
  assert.equal(offset.width, 5);
  assert.equal(offset.height, 5);
  // Same offset but one pixel too wide: raster-local pixels cannot be placed.
  assert.equal(toMaskOverlay(good, { left: 211, top: 228, right: 217, bottom: 233 }), null, "width mismatch");
  assert.equal(toMaskOverlay(good, { left: 211, top: 228, right: 216, bottom: 234 }), null, "height mismatch");
  // Malformed bounds: never placed.
  assert.equal(toMaskOverlay(good, { left: -1, top: 0, right: 4, bottom: 5 }), null, "negative left");
  assert.equal(toMaskOverlay(good, { left: 0, top: 0, right: 0, bottom: 5 }), null, "right <= left");
  assert.equal(toMaskOverlay(good, { left: 0, top: 5, right: 5, bottom: 5 }), null, "bottom <= top");
  assert.equal(toMaskOverlay(good, { left: 0.5, top: 0, right: 5, bottom: 5 }), null, "fractional left");
  assert.equal(toMaskOverlay(good, { left: 0, top: 0, right: NaN, bottom: 5 }), null, "non-finite right");
});

test("runTriggeredObservation returns pixels only as a transient overlay, never in the record", async () => {
  const overlay = { svg: "M0 0L5 0L5 5L0 5Z", width: 5, height: 5, left: 0, top: 0, right: 5, bottom: 5 };
  const frame = new Uint8Array([1, 2, 3, 4]);
  const { record, overlay: out } = await runTriggeredObservation(frame, {
    sam: { async segment() { return [{ id: "mask-1", bbox: [0, 0, 5, 5], area: 25, overlay }]; } },
    spark: { async observe() { return { object_label: "synthetic", observation: "SYNTHETIC", confidence: 0.5 }; } },
    characterId: "synthetic-character",
    triggerId: "synthetic-trigger-1",
  });
  assert.deepEqual(out, overlay, "chosen mask overlay forwarded");
  assert.ok(!("overlay" in record), "record carries no overlay field");
  assert.ok(!("mask_overlay" in record), "record carries no response-only field");
  assert.ok(!JSON.stringify(record).includes("M0 0"), "record bytes contain no path data");
  // A mask without an overlay still observes (bbox highlight remains).
  const frame2 = new Uint8Array([1, 2, 3, 4]);
  const noOverlay = await runTriggeredObservation(frame2, {
    sam: { async segment() { return [{ id: "mask-1", bbox: [0, 0, 5, 5], area: 25 }]; } },
    spark: { async observe() { return { object_label: "synthetic", observation: "SYNTHETIC", confidence: 0.5 }; } },
    characterId: "synthetic-character",
    triggerId: "synthetic-trigger-2",
  });
  assert.equal(noOverlay.overlay, null);
  assert.deepEqual(noOverlay.record.bbox, [0, 0, 5, 5]);
});

test("empty SAM result observes via the labeled no-mask fallback instead of failing", async () => {
  // Regression for the live 2026-11-01 failure: SAM 3.1 returns an empty
  // response for generic concepts, which used to throw "SAM returned no mask"
  // and fail the whole look. Now the Spark observation stands, honestly
  // labeled mask_ref "none" with no invented bbox or overlay.
  const frame = new Uint8Array([7, 8, 9]);
  const seen: { samConcepts: string[]; maskRefs: string[] } = { samConcepts: [], maskRefs: [] };
  const { record, overlay } = await runTriggeredObservation(frame, {
    sam: { async segment(_f, concept) { seen.samConcepts.push(String(concept)); return []; } },
    spark: {
      async observe(req) {
        seen.maskRefs.push(JSON.stringify(req).includes("pre-segmentation") ? "pre-segmentation" : "missing");
        return { object_label: "red apple", observation: "A red apple-like shape on gray.", confidence: 0.6 };
      },
    },
    characterId: "synthetic-character",
    triggerId: "synthetic-trigger-3",
  });
  assert.deepEqual([...frame], [0, 0, 0], "frame still discarded on the fallback path");
  assert.equal(record.mask_ref, "none");
  assert.equal(record.bbox, undefined, "no invented bbox");
  assert.equal(record.object_label, "red apple");
  assert.equal(overlay, null);
  assert.deepEqual(seen.maskRefs, ["pre-segmentation"], "Spark ran before SAM with the placeholder ref");
  assert.deepEqual(seen.samConcepts, ["red apple"], "SAM received the Spark-named concept");
  // The fallback record is still fully valid provenance.
  assert.equal(validateObservationRecord(record).mask_ref, "none");
});

test("observation bbox must equal overlay parser bounds, else bbox-only", async () => {
  const spark = { async observe() { return { object_label: "synthetic", observation: "SYNTHETIC", confidence: 0.5 }; } };
  // Overlay bounds disagree with the mask bbox: overlay dropped, bbox kept.
  const skewed = await runTriggeredObservation(new Uint8Array([1, 2, 3, 4]), {
    sam: {
      async segment() {
        return [{
          id: "mask-1", bbox: [0, 0, 5, 5], area: 25,
          overlay: { svg: "M0 0L5 0L5 5L0 5Z", width: 5, height: 5, left: 211, top: 228, right: 216, bottom: 233 },
        }];
      },
    },
    spark,
    characterId: "synthetic-character",
    triggerId: "synthetic-trigger-3",
  });
  assert.equal(skewed.overlay, null, "misaligned overlay is not usable");
  assert.deepEqual(skewed.record.bbox, [0, 0, 5, 5], "bbox highlight remains");
});

test("SAM request builder matches the official Responses image shape", () => {
  const input = samInput("potted plant", "data:image/png;base64,AA==");
  assert.deepEqual(input[0].content[0], { type: "input_text", text: "potted plant" });
  assert.deepEqual(input[0].content[1], { type: "input_image", image_url: "data:image/png;base64,AA==" });
  assert.throws(() => samInput("   ", "data:image/png;base64,AA=="), /noun phrase/);
});

test("Spark request builder is structured-output only and contributor-safe by construction", () => {
  const req = buildObservationRequest({ model: "muse-spark-1.3", frameBase64: "AA==", maskRef: "m1", frameHash: "h1" });
  assert.equal(req.model, "muse-spark-1.3");
  // Locked wire shape: the same OpenAI-compatible structured-output envelope
  // the proven memory extractor uses (extract.ts), so Meta API drift is
  // caught offline. Live behavior remains unverified (no calls permitted).
  assert.deepEqual(req.response_format, {
    type: "json_schema",
    json_schema: { name: "soulbound_vision_observation_v1", strict: true, schema: VISION_OBSERVATION_JSON_SCHEMA },
  });
  assert.equal(req.max_tokens, VISION_OBSERVATION_MAX_TOKENS);
  const out = validateSparkObservation({ object_label: "plant", observation: "synthetic", confidence: 0.9 });
  assert.equal(out.object_label, "plant");
  assert.throws(() => validateSparkObservation({ object_label: "plant", observation: "x", confidence: 2 }), VisionNotConfigured);
  assert.throws(() => validateSparkObservation({ object_label: "plant", observation: "x", confidence: 0.5, extra: true }), /unknown field/);
});

test("clients enforce maxRetries: 0 (one accepted trigger = one billable call)", async () => {
  // Source-code assertion via file URL. The compiled test runs from dist/,
  // so resolve the source .ts files from the sibling src/ directory.
  const { readFileSync } = await import("node:fs");
  const srcDir = new URL("../../src/vision/", import.meta.url);
  const samSrc = readFileSync(new URL("./sam.ts", srcDir), "utf8");
  const sparkSrc = readFileSync(new URL("./spark.ts", srcDir), "utf8");
  const samRetries = samSrc.match(/maxRetries:\s*0/);
  const sparkRetries = sparkSrc.match(/maxRetries:\s*0/);
  assert.ok(samRetries, "sam.ts createMetaSamClient must set maxRetries: 0");
  assert.ok(sparkRetries, "spark.ts createSparkObserver must set maxRetries: 0");
  // Verify the setting is in the OpenAI client constructor region by checking
  // it appears before a `});` closure (constructor block ends with `});`).
  const samBlock = samSrc.slice(samRetries!.index! - 400, samRetries!.index! + 20);
  assert.ok(samBlock.includes("OpenAI"), "sam.ts maxRetries: 0 is within an OpenAI constructor region");
  const sparkBlock = sparkSrc.slice(sparkRetries!.index! - 400, sparkRetries!.index! + 20);
  assert.ok(sparkBlock.includes("OpenAI"), "spark.ts maxRetries: 0 is within an OpenAI constructor region");
});


test("a degenerate Spark answer is retried once and a good retry becomes the observation", async () => {
  let calls = 0;
  const { record } = await runTriggeredObservation(new Uint8Array([1, 2, 3]), {
    sam: { async segment() { return []; } },
    spark: { async observe() {
      calls += 1;
      return calls === 1
        ? { object_label: "unknown", observation: "No image frame provided; unable to determine salient object", confidence: 0 }
        : { object_label: "blue mug", observation: "A blue mug on a table.", confidence: 0.9 };
    } },
    characterId: "synthetic-character",
    triggerId: "degenerate-retry-1",
  });
  assert.equal(calls, 2, "exactly one retry");
  assert.equal(record.object_label, "blue mug");
});

test("two degenerate Spark answers fail the look instead of producing an 'unknown' memory", async () => {
  let calls = 0;
  const frame = new Uint8Array([4, 5, 6]);
  await assert.rejects(
    runTriggeredObservation(frame, {
      sam: { async segment() { throw new Error("SAM must not run"); } },
      spark: { async observe() {
        calls += 1;
        return { object_label: "unknown", observation: "No visual frame available to identify salient object", confidence: 0 };
      } },
      characterId: "synthetic-character",
      triggerId: "degenerate-fail-1",
    }),
    /did not receive or could not read the frame/,
  );
  assert.equal(calls, 2, "never more than one retry");
  assert.deepEqual([...frame], [0, 0, 0], "frame still zeroed on failure");
});
