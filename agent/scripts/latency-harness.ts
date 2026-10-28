// REQ-40 latency harness (Ticket 016).
// --wav mode: replays a real WAV through the Muse VT WebSocket at real-time
// pacing, so every "diarized" line and sttMs is live VT output, then runs each
// turn through orient -> decide -> act.
// No --wav: scripted turns enter at the transcript boundary; every line is
// labeled decide-only and sttMs=0. No mocks in either mode.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
// Imports the compiled pipeline (run `pnpm build` first, as verification does).
import { runTurn } from "../dist/pipeline.js";
import { VoiceTranscribeStream } from "../dist/observe.js";
import type { DiarizedTurn } from "../dist/orient.js";

// Minimal agent/.env loader (stdlib only; existing env always wins).
const envPath = fileURLToPath(new URL("../.env", import.meta.url));
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
// agent/.env carries the Muse Code credential name; Spark/VT read MODEL_API_KEY.
if (!process.env.MODEL_API_KEY && process.env.META_API_KEY) process.env.MODEL_API_KEY = process.env.META_API_KEY;

const args = process.argv.slice(2);
const argOf = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const turnsWanted = Number(argOf("--turns") ?? 20);
const out = argOf("--out");
const wav = argOf("--wav");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const lines: string[] = [];

function readWavPcm(path: string): { pcm: Buffer; rate: number } {
  const buf = readFileSync(path);
  if (buf.toString("ascii", 0, 4) !== "RIFF") throw new Error(`${path}: not a WAV file`);
  let rate = 0, channels = 0, bits = 0, data: Buffer | null = null;
  for (let off = 12; off + 8 <= buf.length;) {
    const id = buf.toString("ascii", off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    const body = off + 8;
    if (id === "fmt ") { channels = buf.readUInt16LE(body + 2); rate = buf.readUInt32LE(body + 4); bits = buf.readUInt16LE(body + 14); }
    if (id === "data") data = buf.subarray(body, body + size);
    off = body + size + (size % 2);
  }
  if (!data) throw new Error(`${path}: no data chunk`);
  if (channels !== 1 || bits !== 16) throw new Error(`${path}: need mono 16-bit WAV (got ${channels}ch ${bits}-bit)`);
  return { pcm: Buffer.from(data), rate };
}

interface Collected { turn: DiarizedTurn; sttMs: number }

async function collectFromWav(path: string, wanted: number): Promise<Collected[]> {
  const { pcm, rate } = readWavPcm(path);
  process.env.MUSE_VT_ENCODING = rate === 24000 ? "PCM_24KHZ" : rate === 16000 ? "PCM_16KHZ" : "";
  if (!process.env.MUSE_VT_ENCODING) throw new Error(`${path}: sample rate ${rate} not supported (need 16000 or 24000)`);
  const collected: Collected[] = [];
  const chunkBytes = Math.floor(rate * 2 * 0.08); // 80ms frames, cookbook cadence
  for (let replay = 0; replay < 3 && collected.length < wanted; replay++) {
    const vt = new VoiceTranscribeStream((turn, sttMs) => collected.push({ turn, sttMs }));
    const sessionId = await vt.connect();
    lines.push(`vt session ${sessionId} replay=${replay + 1} wav=${path}`);
    for (let off = 0; off < pcm.length; off += chunkBytes) {
      vt.sendAudio(pcm.subarray(off, off + chunkBytes));
      await sleep(80); // real-time pacing: the server drops sessions paced wrong
    }
    await vt.endStream();
    vt.close();
  }
  return collected;
}

let failures = 0;
let diarizedCount = 0;
const lat: number[] = [];
const labels = new Set<string>();

async function runCollected(items: Collected[], mode: string): Promise<void> {
  for (let i = 0; i < Math.min(items.length, turnsWanted); i++) {
    const { turn, sttMs } = items[i];
    try {
      const rec = await runTurn(turn, sttMs);
      lat.push(rec.sttToReplyMs);
      if (rec.diarized) diarizedCount++;
      if (turn.speaker) labels.add(turn.speaker);
      lines.push(`turn ${i + 1} [${mode}]: diarized=${rec.diarized} speaker=${rec.speaker ?? "?"} kind=${rec.kind} sttMs=${sttMs} stt->reply=${rec.sttToReplyMs}ms model=${rec.model} reply="${rec.reply.slice(0, 80)}"`);
    } catch (err) {
      failures++;
      lines.push(`turn ${i + 1} [${mode}]: FAILED ${(err as Error).message}`);
    }
  }
}

lines.push(`REQ-40 latency harness — ${new Date().toISOString()}`);
lines.push(`turns requested: ${turnsWanted}`);

if (wav) {
  lines.push("mode: wav-replay (live Muse VT WebSocket; sttMs is real VT output)");
  try {
    const collected = await collectFromWav(wav, turnsWanted);
    lines.push(`vt turns collected: ${collected.length} speakers=${[...new Set(collected.map((c) => c.turn.speaker).filter(Boolean))].join(",") || "none"}`);
    await runCollected(collected, "wav");
    if (collected.length === 0) { failures++; lines.push("FAILED: VT produced no turns from the WAV"); }
  } catch (err) {
    failures++;
    lines.push(`FAILED wav replay: ${(err as Error).message}`);
  }
} else {
  lines.push("mode: decide-only (scripted transcripts; sttMs=0 — NOT turn latency)");
  process.env.OWNER_SPEAKER_LABEL ??= "A"; // scripted owner letter for the decide-only path
  const SCRIPT: DiarizedTurn[] = [
    { speaker: "A", text: "Hello, are you there?" },
    { speaker: "A", text: "What should I call you?" },
    { speaker: null, text: "Hi, I just walked up." }, // ambiguous -> stranger (REQ-42)
    { speaker: "B", text: "Hello, new voice here." },
    { speaker: "A", text: "Tell me something you are curious about." },
  ];
  const items: Collected[] = Array.from({ length: turnsWanted }, (_, i) => ({ turn: SCRIPT[i % SCRIPT.length], sttMs: 0 }));
  await runCollected(items, "decide-only");
}

if (lat.length) {
  const sorted = [...lat].sort((a, b) => a - b);
  lines.push(`completed: ${lat.length}/${turnsWanted} diarized: ${diarizedCount} speaker labels: ${[...labels].join(",") || "none"} p50 stt->reply: ${sorted[Math.floor(sorted.length / 2)]}ms`);
}
lines.push(failures ? `RESULT: BLOCKED — ${failures} failure(s); see above.` : `RESULT: OK (${wav ? "wav-replay, VT leg live" : "decide-only, VT leg not exercised"})`);

const text = lines.join("\n");
console.log(text);
if (out) { mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, text + "\n"); }
if (failures) process.exitCode = 1;
