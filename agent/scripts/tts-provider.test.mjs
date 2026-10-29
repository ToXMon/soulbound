// Ticket 003 provider tests: local loopback HTTP server only (no Akash, no
// paid endpoint). Verifies the pinned request shape, incremental chunk
// arrival, auth header, error mapping, and cancellation.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { VoxCpm2Provider, stripWavHeader } from "../dist/tts.js";
import { pcmToWav } from "../dist/tts-core.js";

async function withServer(handler, fn) {
  const server = http.createServer(handler);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(base);
  } finally {
    server.closeAllConnections?.();
    await new Promise((r) => server.close(r));
  }
}

test("VoxCPM2 provider sends live-verified WAV-stream request, strips header, yields PCM incrementally", async () => {
  let seen = null;
  const wav = pcmToWav(Buffer.concat([Buffer.alloc(100, 1), Buffer.alloc(50, 2)]));
  await withServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      seen = { url: req.url, auth: req.headers.authorization, json: JSON.parse(body) };
      res.writeHead(200, { "Content-Type": "audio/wav" });
      res.write(wav.subarray(0, 20)); // header split across chunks on purpose
      setTimeout(() => {
        res.write(wav.subarray(20));
        res.end();
      }, 30);
    });
  }, async (base) => {
    const p = new VoxCpm2Provider(base, "test-key");
    let firstAt = 0;
    const chunks = [];
    const t0 = Date.now();
    for await (const c of p.synthesize({
      text: "Hello, I am alive.",
      voiceDescription: "warm young voice",
      seed: 42,
      onFirstChunk: () => { firstAt = Date.now() - t0; },
    })) chunks.push(c);
    assert.equal(seen.url, "/v1/audio/speech");
    assert.equal(seen.auth, "Bearer test-key");
    assert.equal(seen.json.input, "(warm young voice)Hello, I am alive.");
    assert.equal(seen.json.response_format, "wav");
    assert.equal(seen.json.stream, true);
    assert.equal(seen.json.stream_format, "audio");
    assert.equal(seen.json.seed, 42);
    assert.equal(seen.json.model, "openbmb/VoxCPM2");
    const pcm = Buffer.concat(chunks);
    assert.equal(pcm.length, 150); // WAV header stripped, pure PCM only
    assert.ok(firstAt >= 30, "first PCM must wait for header completion");
  });
});

test("stripWavHeader validates format and rejects mismatches", () => {
  const good = pcmToWav(Buffer.alloc(100));
  assert.equal(stripWavHeader(good.subarray(0, 20)), null); // need more bytes
  assert.equal(stripWavHeader(Buffer.from(good)).length, 100);
  const bad = Buffer.from(good);
  bad.writeUInt32LE(44100, 24);
  assert.throws(() => stripWavHeader(bad), /format mismatch/);
  assert.throws(() => stripWavHeader(Buffer.alloc(64, 7)), /not WAV/);
});

test("VoxCPM2 provider maps HTTP errors and rejects empty input without a request", async () => {
  await withServer((req, res) => {
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end("boom");
  }, async (base) => {
    const p = new VoxCpm2Provider(base, "test-key");
    await assert.rejects(
      async () => {
        for await (const _ of p.synthesize({ text: "Hi.", voiceDescription: "warm", seed: null })) { /* drain */ }
      },
      /HTTP 500/,
    );
    await assert.rejects(
      async () => {
        for await (const _ of p.synthesize({ text: "  ", voiceDescription: "warm", seed: null })) { /* drain */ }
      },
      /empty sentence/,
    );
  });
});

test("VoxCPM2 provider honours caller cancellation", async () => {
  await withServer((req, res) => {
    res.writeHead(200, { "Content-Type": "audio/wav" });
    res.write(pcmToWav(Buffer.alloc(10, 1))); // valid header + first PCM, then hang
    // Never end: client must cancel.
  }, async (base) => {
    const p = new VoxCpm2Provider(base, "test-key", "voxcpm2", 60000);
    const ac = new AbortController();
    const gen = p.synthesize({ text: "Hi.", voiceDescription: "warm", seed: null, signal: ac.signal });
    const first = await gen.next();
    assert.equal(first.done, false);
    ac.abort();
    await assert.rejects(async () => { await gen.next(); });
  });
});
