// Ticket 003 + Ticket 035 provider tests: local loopback HTTP server only
// (no Akash, no paid endpoint). Verifies the pinned request shape,
// incremental chunk arrival, auth header, error mapping, cancellation, and
// opt-in synthetic reference (ref_audio) support.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { MmsTtsProvider, VoxCpm2Provider, stripWavHeader, ttsProviderFromEnv } from "../dist/tts.js";
import { pcmToWav } from "../dist/tts-core.js";
import { loadRefAudio, refAudioFromEnv, REF_AUDIO_MAX_BYTES } from "../dist/tts-ref.js";

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

// Meta MMS provider (submission renderer, docs/029): same WAV-stream contract,
// no voice-description requirement, seed ignored, no seed field sent.
test("MMS provider sends Meta model request, ignores voice design, strips header", async () => {
  let seen = null;
  const wav = pcmToWav(Buffer.alloc(90, 3));
  await withServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      seen = { url: req.url, auth: req.headers.authorization, json: JSON.parse(body) };
      res.writeHead(200, { "Content-Type": "audio/wav" });
      res.write(wav.subarray(0, 10));
      setTimeout(() => { res.write(wav.subarray(10)); res.end(); }, 20);
    });
  }, async (base) => {
    const p = new MmsTtsProvider(base, "mms-key");
    const chunks = [];
    for await (const c of p.synthesize({
      text: "I remember that.",
      voiceDescription: "", // MMS has a fixed single voice; empty description is fine
      seed: null,
    })) chunks.push(c);
    assert.equal(seen.url, "/v1/audio/speech");
    assert.equal(seen.auth, "Bearer mms-key");
    assert.equal(seen.json.input, "I remember that.");
    assert.equal(seen.json.model, "facebook/mms-tts-eng");
    assert.equal(seen.json.response_format, "wav");
    assert.equal(seen.json.stream, true);
    assert.equal(seen.json.stream_format, "audio");
    assert.equal("seed" in seen.json, false);
    assert.equal(Buffer.concat(chunks).length, 90);
  });
});

test("MMS provider refuses empty input without a request and maps HTTP errors", async () => {
  await withServer((req, res) => {
    res.writeHead(401, { "Content-Type": "text/plain" });
    res.end("no");
  }, async (base) => {
    const p = new MmsTtsProvider(base, "mms-key");
    await assert.rejects(async () => {
      for await (const _ of p.synthesize({ text: "  ", voiceDescription: "", seed: null })) { /* drain */ }
    }, /empty sentence/);
    await assert.rejects(async () => {
      for await (const _ of p.synthesize({ text: "Hi.", voiceDescription: "", seed: null })) { /* drain */ }
    }, /HTTP 401/);
  });
});

test("ttsProviderFromEnv selects by TTS_PROVIDER and validates the value", () => {
  const saved = { ...process.env };
  try {
    process.env.TTS_BASE_URL = "http://127.0.0.1:9";
    process.env.TTS_API_KEY = "k";
    process.env.TTS_PROVIDER = "mms";
    assert.equal(ttsProviderFromEnv().name, "meta-mms-tts-eng");
    process.env.TTS_PROVIDER = "voxcpm2";
    assert.equal(ttsProviderFromEnv().name, "voxcpm2-vllm-omni");
    process.env.TTS_PROVIDER = "wat";
    assert.throws(() => ttsProviderFromEnv(), /TTS_PROVIDER/);
    delete process.env.TTS_PROVIDER; // legacy default: voxcpm2 local dev
    assert.equal(ttsProviderFromEnv().name, "voxcpm2-vllm-omni");
  } finally {
    for (const k of ["TTS_BASE_URL", "TTS_API_KEY", "TTS_PROVIDER"]) {
      if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    }
  }
});

// ---- Ticket 035: opt-in synthetic reference (ref_audio) ----

function tmpRefWav() {
  // Minimal valid 48kHz mono 16-bit WAV with a short silent data chunk.
  const pcm = Buffer.alloc(960, 0); // 10ms silence
  const wav = pcmToWav(pcm);
  const path = join(tmpdir(), `soulbound-test-ref-${Date.now()}.wav`);
  writeFileSync(path, wav);
  const digest = createHash("sha256").update(wav).digest("hex");
  return { path, digest, wav };
}

function withRef(fn) {
  const { path, digest, wav } = tmpRefWav();
  try {
    fn(path, digest, wav);
  } finally {
    try { unlinkSync(path); } catch { /* ok */ }
  }
}

test("loadRefAudio loads valid WAV, verifies digest, returns data URI", () => {
  withRef((path, digest) => {
    const uri = loadRefAudio(path, digest);
    assert.ok(uri.startsWith("data:audio/wav;base64,"));
    // Round-trip: decode and verify it's the same WAV bytes.
    const b64 = uri.slice(uri.indexOf(",") + 1);
    const decoded = Buffer.from(b64, "base64");
    const redigest = createHash("sha256").update(decoded).digest("hex");
    assert.equal(redigest, digest);
    assert.ok(decoded.length > 44);
  });
});

test("loadRefAudio rejects missing file", () => {
  assert.throws(
    () => loadRefAudio("/nonexistent/ref.wav", "a".repeat(64)),
    /cannot open ref audio file/,
  );
});

test("loadRefAudio does not leak path in error messages", () => {
  // Use a distinct name so we can verify it does not appear in any error.
  const secretPath = "/tmp/soulbound-secret-user-voice-ref.wav";
  try {
    loadRefAudio(secretPath, "a".repeat(64));
    assert.fail("expected throw");
  } catch (e) {
    assert.ok(
      !e.message.includes("soulbound-secret-user-voice-ref"),
      `error must not contain path, got: ${e.message}`,
    );
    assert.ok(
      !e.message.includes("/tmp"),
      `error must not contain path prefix, got: ${e.message}`,
    );
  }
});

test("loadRefAudio rejects directory path", () => {
  assert.throws(
    () => loadRefAudio(tmpdir(), "a".repeat(64)),
    /not a regular file/,
  );
});

test("loadRefAudio rejects malformed fmt — non-PCM format", () => {
  withRef((path, _digest, wav) => {
    // Corrupt AudioFormat field from 1 (PCM) to 2 (ADPCM).
    const bad = Buffer.from(wav);
    bad.writeUInt16LE(2, 20); // AudioFormat at offset 20 in fmt subchunk
    const digest = createHash("sha256").update(bad).digest("hex");
    writeFileSync(path, bad);
    assert.throws(
      () => loadRefAudio(path, digest),
      /must be PCM/,
    );
  });
});

test("loadRefAudio rejects malformed fmt — unsupported channel count", () => {
  withRef((path, _digest, wav) => {
    // Set channels to 0.
    const bad = Buffer.from(wav);
    bad.writeUInt16LE(0, 22);
    const digest = createHash("sha256").update(bad).digest("hex");
    writeFileSync(path, bad);
    assert.throws(
      () => loadRefAudio(path, digest),
      /must be mono or stereo/,
    );
  });
});

test("loadRefAudio rejects malformed fmt — implausible sample rate", () => {
  withRef((path, _digest, wav) => {
    const bad = Buffer.from(wav);
    bad.writeUInt32LE(1000, 24); // 1 kHz — below 8 kHz floor
    const digest = createHash("sha256").update(bad).digest("hex");
    writeFileSync(path, bad);
    assert.throws(
      () => loadRefAudio(path, digest),
      /sample rate out of plausible range/,
    );
  });
});

test("loadRefAudio rejects malformed fmt — blockAlign mismatch", () => {
  withRef((path, _digest, wav) => {
    const bad = Buffer.from(wav);
    bad.writeUInt16LE(999, 32); // blockAlign should be channels * 2 = 2 (mono)
    const digest = createHash("sha256").update(bad).digest("hex");
    writeFileSync(path, bad);
    assert.throws(
      () => loadRefAudio(path, digest),
      /blockAlign mismatch/,
    );
  });
});

test("loadRefAudio rejects malformed fmt — byteRate mismatch", () => {
  withRef((path, _digest, wav) => {
    const bad = Buffer.from(wav);
    bad.writeUInt32LE(1, 28); // byteRate should be sampleRate * blockAlign
    const digest = createHash("sha256").update(bad).digest("hex");
    writeFileSync(path, bad);
    assert.throws(
      () => loadRefAudio(path, digest),
      /byteRate mismatch/,
    );
  });
});

test("loadRefAudio rejects empty file", () => {
  withRef((path, digest) => {
    writeFileSync(path, Buffer.alloc(0));
    assert.throws(
      () => loadRefAudio(path, digest),
      /ref audio file is empty/,
    );
  });
});

test("loadRefAudio rejects digest mismatch", () => {
  withRef((path, _digest) => {
    const wrong = "b".repeat(64);
    assert.throws(
      () => loadRefAudio(path, wrong),
      /digest mismatch/,
    );
  });
});

test("loadRefAudio rejects invalid digest format", () => {
  withRef((path, _digest) => {
    assert.throws(
      () => loadRefAudio(path, "short"),
      /64-character hex SHA256/,
    );
  });
});

test("loadRefAudio rejects non-WAV file", () => {
  withRef((path, digest) => {
    writeFileSync(path, Buffer.alloc(100, 0));
    assert.throws(
      () => loadRefAudio(path, digest),
      /not a valid RIFF.WAVE/,
    );
  });
});

test("loadRefAudio rejects oversized file before allocation", () => {
  withRef((path, _digest) => {
    const big = Buffer.alloc(REF_AUDIO_MAX_BYTES + 1, 0);
    writeFileSync(path, big);
    // Digest must match the oversized file.
    const digest = createHash("sha256").update(big).digest("hex");
    assert.throws(
      () => loadRefAudio(path, digest),
      /byte limit/,
    );
  });
});

test("loadRefAudio rejects missing path with present digest", () => {
  assert.throws(
    () => loadRefAudio("", "a".repeat(64)),
    /must be set together/,
  );
});

test("loadRefAudio rejects missing digest with present path", () => {
  withRef((path, _digest) => {
    assert.throws(
      () => loadRefAudio(path, ""),
      /must be set together/,
    );
  });
});

test("refAudioFromEnv returns null when neither var is set", () => {
  const saved = { ...process.env };
  try {
    delete process.env.TTS_REF_AUDIO_PATH;
    delete process.env.TTS_REF_AUDIO_DIGEST;
    assert.equal(refAudioFromEnv(), null);
  } finally {
    for (const k of ["TTS_REF_AUDIO_PATH", "TTS_REF_AUDIO_DIGEST"]) {
      if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    }
  }
});

// VoxCPM2 provider sends ref_audio in payload when configured.
test("VoxCPM2 provider includes ref_audio in request when configured", async () => {
  const { path, digest, wav } = tmpRefWav();
  try {
    const refUri = loadRefAudio(path, digest);
    let seen = null;
    await withServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        seen = JSON.parse(body);
        res.writeHead(200, { "Content-Type": "audio/wav" });
        res.end(wav);
      });
    }, async (base) => {
      const p = new VoxCpm2Provider(base, "test-key", "openbmb/VoxCPM2", 60000, refUri);
      for await (const _ of p.synthesize({
        text: "Hello.",
        voiceDescription: "warm voice",
        seed: 42,
      })) { /* drain */ }
      assert.equal(seen.ref_audio, refUri);
      assert.ok(seen.ref_audio.startsWith("data:audio/wav;base64,"));
    });
  } finally {
    try { unlinkSync(path); } catch { /* ok */ }
  }
});

// VoxCPM2 provider does NOT send ref_audio when not configured (old path).
test("VoxCPM2 provider omits ref_audio when not configured", async () => {
  let seen = null;
  const wav = pcmToWav(Buffer.alloc(100, 0));
  await withServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      seen = JSON.parse(body);
      res.writeHead(200, { "Content-Type": "audio/wav" });
      res.end(wav);
    });
  }, async (base) => {
    const p = new VoxCpm2Provider(base, "test-key");
    for await (const _ of p.synthesize({
      text: "Hello.",
      voiceDescription: "warm voice",
      seed: 42,
    })) { /* drain */ }
    assert.equal("ref_audio" in seen, false);
  });
});

// Two different texts with same ref_audio pass the same ref_audio URI.
test("VoxCPM2 provider sends same ref_audio across different texts", async () => {
  const { path, digest, wav } = tmpRefWav();
  try {
    const refUri = loadRefAudio(path, digest);
    const seenRefs = [];
    await withServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        seenRefs.push(JSON.parse(body).ref_audio);
        res.writeHead(200, { "Content-Type": "audio/wav" });
        res.end(wav);
      });
    }, async (base) => {
      const p = new VoxCpm2Provider(base, "test-key", "openbmb/VoxCPM2", 60000, refUri);
      for await (const _ of p.synthesize({
        text: "Hello, first text.",
        voiceDescription: "warm voice",
        seed: 42,
      })) { /* drain */ }
      for await (const _ of p.synthesize({
        text: "Second, different text here.",
        voiceDescription: "warm voice",
        seed: 42,
      })) { /* drain */ }
      assert.equal(seenRefs.length, 2);
      assert.equal(seenRefs[0], refUri);
      assert.equal(seenRefs[1], refUri); // same reference for every request
    });
  } finally {
    try { unlinkSync(path); } catch { /* ok */ }
  }
});

// Cancellation still works with reference configured.
test("VoxCPM2 provider with ref_audio honours caller cancellation", async () => {
  const { path, digest, wav } = tmpRefWav();
  try {
    const refUri = loadRefAudio(path, digest);
    await withServer((req, res) => {
      res.writeHead(200, { "Content-Type": "audio/wav" });
      res.write(wav); // valid header + first PCM, then hang
      // Never end: client must cancel.
    }, async (base) => {
      const p = new VoxCpm2Provider(base, "test-key", "openbmb/VoxCPM2", 60000, refUri);
      const ac = new AbortController();
      const gen = p.synthesize({
        text: "Hi.",
        voiceDescription: "warm",
        seed: null,
        signal: ac.signal,
      });
      const first = await gen.next();
      assert.equal(first.done, false);
      ac.abort();
      await assert.rejects(async () => { await gen.next(); });
    });
  } finally {
    try { unlinkSync(path); } catch { /* ok */ }
  }
});
