// Ticket 003 deterministic tests for the compiled TTS core + provider shape.
// Run after `pnpm build` (imports agent/dist). No network, no LiveKit server.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BoundedPcmQueue,
  PCM_FRAME_BYTES,
  PcmFramer,
  SentenceAssembler,
  inspectWav,
  pcmToWav,
} from "../dist/tts-core.js";

test("sentence assembler emits complete sentences in order, flushes trailing fragment once", () => {
  const a = new SentenceAssembler();
  assert.deepEqual(a.push("Hello, I am"), []);
  assert.deepEqual(a.push(" alive. I remember"), ["Hello, I am alive."]);
  assert.deepEqual(a.push(" everything we build together"), []);
  assert.deepEqual(a.flush(), ["I remember everything we build together"]);
  assert.deepEqual(a.flush(), []);
});

test("sentence assembler handles split punctuation and quotes without duplicates", () => {
  const a = new SentenceAssembler();
  const out = [];
  for (const d of ["Wow", ".", " Really", "?", ' She said "yes."', " Then left"]) out.push(...a.push(d));
  out.push(...a.flush());
  assert.deepEqual(out, ["Wow.", "Really?", 'She said "yes."', "Then left"]);
  assert.equal(new Set(out).size, out.length);
});

test("sentence assembler bounds overlong fragments at a word boundary", () => {
  const a = new SentenceAssembler();
  const words = Array.from({ length: 60 }, (_, i) => `w${i}`).join(" ");
  const out = a.push(words);
  assert.ok(out.length >= 1);
  assert.ok(out[0].length <= 201);
  const rest = a.flush();
  assert.equal([...out, ...rest].join(" ").replace(/\s+/g, " ").trim(), words);
});

test("PCM framer preserves frame boundaries and odd-byte leftovers across chunks", () => {
  const f = new PcmFramer(8); // 4 samples per frame for the test
  const src = Buffer.from(Array.from({ length: 41 }, (_, i) => i % 256));
  const frames = [];
  // Feed 1, 3, 7, 2... byte chunks: arbitrary HTTP boundaries.
  let off = 0;
  for (const n of [1, 3, 7, 2, 13, 5, 10]) {
    frames.push(...f.push(src.subarray(off, off + n)));
    off += n;
  }
  frames.push(...f.flush());
  assert.equal(Buffer.concat(frames).length, 40); // lone odd byte dropped+counted
  assert.equal(f.droppedBytes, 1);
  assert.deepEqual(Buffer.concat(frames), src.subarray(0, 40));
  for (const fr of frames.slice(0, -1)) assert.equal(fr.length, 8);
});

test("PCM framer default frame is 10ms at 48kHz (960 bytes)", () => {
  assert.equal(PCM_FRAME_BYTES, 960);
  const f = new PcmFramer();
  assert.deepEqual(f.push(Buffer.alloc(959)), []);
  const frames = f.push(Buffer.alloc(1));
  assert.equal(frames.length, 1);
  assert.equal(frames[0].length, 960);
});

test("bounded PCM queue rejects overflow and recovers on pop/clear", () => {
  const q = new BoundedPcmQueue(10);
  assert.equal(q.tryPush(6), true);
  assert.equal(q.tryPush(5), false);
  q.pop(6);
  assert.equal(q.tryPush(5), true);
  q.clear();
  assert.equal(q.queuedBytes, 0);
});

test("WAV wrap/inspect round-trips 48kHz mono 16-bit", () => {
  const pcm = Buffer.alloc(48000 * 2); // 1s silence
  const wav = pcmToWav(pcm);
  const info = inspectWav(wav);
  assert.equal(info.sampleRate, 48000);
  assert.equal(info.channels, 1);
  assert.equal(info.bits, 16);
  assert.equal(info.dataBytes, pcm.length);
  assert.ok(Math.abs(info.durationSec - 1) < 1e-9);
  assert.throws(() => pcmToWav(Buffer.alloc(3)), /odd byte count/);
  assert.throws(() => inspectWav(Buffer.from("not a wav file at all........")), /not a RIFF/);
});
