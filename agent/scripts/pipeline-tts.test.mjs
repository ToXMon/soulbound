// Ticket 003 regression tests for reply-level TTS in the pipeline.
// Uses the injected streamReply seam with fakes — no Spark, no LiveKit, no
// network. Locks in the Tolu consistency verdict: ONE synthesis request per
// reply (independent per-sentence requests changed voice identity), ordered
// PCM publication, and text preservation on TTS failure/cancellation.
import { test } from "node:test";
import assert from "node:assert/strict";
import { runTurn } from "../dist/pipeline.js";
import { reasoningEffort } from "../dist/decide.js";

const FULL = "Hello, I am alive. I remember everything. What shall we create?";

function fakeStream(text = FULL) {
  return async (_turn, _kind, cb) => {
    cb?.onFirstToken?.();
    // Stream in pieces that split sentences mid-token.
    for (const d of ["Hello, I am", " alive. I remember", " everything. What shall", " we create?"]) {
      await cb?.onDelta?.(d);
    }
    return { text, model: "muse-spark-1.3", latencyMs: 12 };
  };
}

function fakeProvider(failWith = null) {
  const calls = [];
  return {
    name: "fake-tts",
    format: { sampleRate: 48000, channels: 1, encoding: "pcm_s16le" },
    calls,
    async *synthesize(req) {
      calls.push(req);
      if (failWith) throw failWith;
      req.onFirstChunk?.();
      yield Buffer.alloc(960, 1);
      yield Buffer.alloc(960, 2);
    },
  };
}

function fakeSink() {
  const published = [];
  return {
    published,
    cleared: 0,
    async publishPcm(chunk) { published.push(Buffer.from(chunk)); },
    clear() { this.cleared++; },
    async close() {},
    async flush() {},
  };
}

const turn = { speaker: "speaker_0", text: "hello", confidence: 0.99 };
const voice = { description: "a warm, youthful voice", seed: 42 };

test("one synthesis request per reply with full text, PCM published in order", async () => {
  const provider = fakeProvider();
  const sink = fakeSink();
  const rec = await runTurn(turn, 100, {
    streamReply: fakeStream(),
    tts: provider,
    voice,
    sink,
  });
  assert.equal(provider.calls.length, 1, "must not synthesize per sentence");
  assert.equal(provider.calls[0].text, FULL);
  assert.equal(provider.calls[0].seed, 42);
  assert.equal(rec.reply, FULL);
  assert.equal(rec.tts?.status, "ok");
  assert.equal(rec.tts?.sentences, 1);
  assert.deepEqual(sink.published.map((b) => b[0]), [1, 2]); // order preserved
  assert.ok(rec.timing?.firstSentenceMs !== null);
  assert.ok(rec.timing?.firstTtsChunkMs !== null);
  assert.ok(rec.timing?.firstAudioPublishMs !== null);
});

test("TTS failure preserves the text reply and reports failed status", async () => {
  const provider = fakeProvider(new Error("endpoint exploded"));
  const sink = fakeSink();
  const rec = await runTurn(turn, 100, {
    streamReply: fakeStream(),
    tts: provider,
    voice,
    sink,
  });
  assert.equal(rec.reply, FULL);
  assert.equal(rec.tts?.status, "failed");
  assert.match(rec.tts?.error ?? "", /endpoint exploded/);
  assert.ok(sink.cleared >= 1);
});

test("cancellation reports cancelled and preserves text", async () => {
  const ac = new AbortController();
  const provider = fakeProvider();
  const sink = fakeSink();
  ac.abort();
  const rec = await runTurn(turn, 100, {
    streamReply: fakeStream(),
    tts: provider,
    voice,
    sink,
    signal: ac.signal,
  });
  assert.equal(rec.reply, FULL);
  assert.equal(rec.tts?.status, "cancelled");
  assert.equal(provider.calls.length, 0);
});

test("reasoning effort defaults to minimal for voice latency and validates env", () => {
  const prev = process.env.MODEL_REASONING_EFFORT;
  try {
    delete process.env.MODEL_REASONING_EFFORT;
    assert.equal(reasoningEffort(), "minimal");
    process.env.MODEL_REASONING_EFFORT = "low";
    assert.equal(reasoningEffort(), "low");
    process.env.MODEL_REASONING_EFFORT = "none";
    assert.throws(() => reasoningEffort(), /must be one of/);
    process.env.MODEL_REASONING_EFFORT = "turbo";
    assert.throws(() => reasoningEffort(), /must be one of/);
  } finally {
    if (prev === undefined) delete process.env.MODEL_REASONING_EFFORT;
    else process.env.MODEL_REASONING_EFFORT = prev;
  }
});

test("no TTS configured keeps the text-only path", async () => {
  const rec = await runTurn(turn, 100, { streamReply: fakeStream() });
  assert.equal(rec.reply, FULL);
  assert.equal(rec.tts?.status, "not-configured");
  assert.equal(rec.timing?.ttsMs, null);
});
