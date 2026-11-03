// Ticket 008 verification harness (offline by default).
//
//   node agent/scripts/vision-demo.ts --synthetic-fixture --out /tmp/vision.json
//   node agent/scripts/vision-demo.ts --fixture app/fixtures/plant.jpg --out ...
//
// Fixture mode tests ONLY trigger/state/privacy plumbing: frame hash, record
// validation, extraction mapping, discard. It never represents synthetic
// output as SAM/Spark behavior. --live invokes the real adapters (SAM 3.1 via
// Responses API + @meta-sam/parser, then Spark structured observation) and is
// blocked unless META_API_KEY/MODEL_API_KEY is set AND --approve-live is also
// passed (explicit per-run confirmation required); no billable call is made
// by this harness without both. One live invocation = exactly one SAM + one
// Spark call (no cap option; there is no multi-call loop).
import { parseArgs } from "node:util";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { deflateSync } from "node:zlib";
import { frameHashHex } from "../src/vision/frame.js";
import { createMetaSamClient } from "../src/vision/sam.js";
import { createSparkObserver } from "../src/vision/spark.js";
import { runTriggeredObservation } from "../src/vision/observe.js";
import {
  validateObservationRecord,
  observationToExtraction,
} from "../src/memory/observation.js";
import { validateExtraction } from "../src/memory/schema.js";

// ---- synthetic PNG generator (valid minimal RGB PNG; labeled synthetic) ----

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "ascii"), data])), 8 + data.length);
  return out;
}
export function makeSyntheticPng(width = 64, height = 64, rgb: [number, number, number] = [40, 160, 80]): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0; // 8-bit RGB
  const scanline = Buffer.alloc(1 + width * 3);
  const rows = Buffer.alloc((scanline.length) * height);
  for (let y = 0; y < height; y++) {
    rows.set(scanline, y * scanline.length);
    for (let x = 0; x < width; x++) {
      const o = y * scanline.length + 1 + x * 3;
      rows[o] = rgb[0]; rows[o + 1] = rgb[1]; rows[o + 2] = rgb[2];
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(rows)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// --live: exactly one SAM segmentation + one Spark structured observation on
// an operator-supplied fixture. Requires explicit per-run approval and a
// configured key. The report carries metadata only — never frame bytes,
// base64, or credentials.
async function runLive(
  fixture: string | undefined,
  out: string | undefined,
  concept: string,
) {
  if (!fixture) throw new Error("--live requires --fixture PATH");
  const apiKey = process.env.META_API_KEY ?? process.env.MODEL_API_KEY;
  if (!apiKey) {
    throw new Error("BLOCKED: META_API_KEY/MODEL_API_KEY is not set; no billable call attempted");
  }

  let frame: Uint8Array;
  try {
    frame = new Uint8Array(await readFile(fixture));
  } catch {
    throw new Error(`BLOCKED: fixture image not found at ${fixture}`);
  }
  const frameBytes = frame.length;
  const mime = /\.jpe?g$/i.test(fixture) ? "image/jpeg" : "image/png";
  // Overlay intentionally dropped here: the report carries the pixel-free
  // record only, never mask pixels.
  const { record } = await runTriggeredObservation(frame, {
    sam: createMetaSamClient({ apiKey, concept }),
    spark: createSparkObserver({ apiKey }),
    characterId: "live-trigger-character",
    triggerId: `live-trigger-${Date.now()}`,
    mime,
  });
  const report = {
    schema: "vision-demo-report",
    fixture: true,
    synthetic: false,
    live: true,
    live_model_calls: 2,
    fixture_label: fixture,
    frame_bytes: frameBytes,
    sam_model: "sam-3.1",
    spark_model: "muse-spark-1.3",
    observation_record: record,
    generated_at: new Date().toISOString(),
  };
  const json = JSON.stringify(report, null, 2);
  if (out) {
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, json + "\n", "utf8");
  }
  console.log(json);
}

async function main() {
  const { values } = parseArgs({
    options: {
      fixture: { type: "string" },
      "synthetic-fixture": { type: "boolean", default: false },
      out: { type: "string" },
      live: { type: "boolean", default: false },
      "approve-live": { type: "boolean", default: false },
      concept: { type: "string", default: "potted plant" },
    },
  });
  if (!values.fixture && !values["synthetic-fixture"] && !values.live) {
    throw new Error("pass --fixture PATH, --synthetic-fixture, or --live");
  }
  if (values.live) {
    if (!values["approve-live"]) {
      throw new Error(
        "BLOCKED: --live requires --approve-live (explicit per-run confirmation). " +
        "This will make 1 billable SAM segmentation + 1 billable Spark observation. " +
        "Pass --approve-live to confirm."
      );
    }
    await runLive(values.fixture, values.out, values.concept ?? "potted plant");
    return;
  }
  if (values.fixture && values["synthetic-fixture"]) {
    throw new Error("--fixture and --synthetic-fixture are mutually exclusive");
  }

  const blocked: string[] = [];
  let frame: Uint8Array;
  let fixtureLabel: string;
  if (values.fixture) {
    try {
      frame = new Uint8Array(await readFile(values.fixture));
      fixtureLabel = values.fixture;
    } catch {
      throw new Error(`BLOCKED: fixture image not found at ${values.fixture} (operator-supplied fixture required)`);
    }
  } else {
    frame = new Uint8Array(makeSyntheticPng());
    fixtureLabel = "in-memory synthetic PNG (generated; not a photograph)";
  }

  let frameHash: string;
  try {
    frameHash = frameHashHex(frame);
  } catch (e) {
    blocked.push(`frame hashing unavailable: ${(e as Error).message}`);
    throw e;
  }

  // Synthetic observation — explicitly labeled; NOT SAM/Spark output.
  const record = validateObservationRecord({
    schema_version: 1,
    kind: "vision_observation",
    character_id: "fixture-character",
    frame_hash: frameHash,
    mask_ref: "synthetic-fixture-mask-ref",
    timestamp: new Date().toISOString(),
    object_label: "synthetic object (fixture)",
    summary: "SYNTHETIC FIXTURE — validates plumbing only; no segmentation or model inference occurred.",
    confidence: 1,
    trigger_id: `fixture-trigger-${Date.now()}`,
    synthetic: true,
  });
  const mapped = observationToExtraction(record);
  const [accepted] = validateExtraction(
    { memories: [mapped] },
    mapped.source_turn_ids,
  );
  frame.fill(0); // discard

  // Presence-only checks (never print values): fixture mode makes no network
  // calls, so these just describe what --live would still need. Either key
  // unlocks --live (runLive accepts META_API_KEY ?? MODEL_API_KEY).
  const hasSparkKey = Boolean(process.env.META_API_KEY ?? process.env.MODEL_API_KEY);
  let samPresent = false;
  try {
    await import("@meta-sam/parser");
    samPresent = true;
  } catch {
    samPresent = false;
  }
  blocked.push(hasSparkKey
    ? "META_API_KEY/MODEL_API_KEY present in env — Spark vision inference still not attempted (fixture mode makes zero live calls)"
    : "META_API_KEY/MODEL_API_KEY not set in this session's env — Spark vision inference not attempted");
  blocked.push(samPresent
    ? "@meta-sam/parser resolvable — SAM segmentation still not attempted (fixture mode only)"
    : "@meta-sam/parser not installed — SAM segmentation not attempted");

  const report = {
    schema: "vision-demo-report",
    fixture: true,
    synthetic: true,
    live: false,
    not_model_output: true,
    live_model_calls: 0,
    fixture_label: fixtureLabel,
    frame_bytes: frame.length,
    frame_hash: frameHash,
    frame_discarded: frame.every((b) => b === 0),
    observation_record_valid: true,
    extraction_mapping_valid: mapped.type === "event",
    observation_record: record,
    blocked,
    live_acceptance_unverified: true,
    generated_at: new Date().toISOString(),
  };
  const json = JSON.stringify(report, null, 2);
  if (values.out) {
    await mkdir(dirname(values.out), { recursive: true });
    await writeFile(values.out, json + "\n", "utf8");
  }
  console.log(json);
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  main().then(
    () => {},
    (err: unknown) => {
      console.error(`vision-demo: ${(err as Error).message}`);
      process.exitCode = 2;
    },
  );
}
