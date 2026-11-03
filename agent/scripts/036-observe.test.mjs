import { test } from "node:test";
import assert from "node:assert/strict";
import { WebSocketServer } from "ws";
import { VoiceTranscribeStream } from "../dist/observe.js";

const waitFor = async predicate => {
  const deadline = Date.now() + 2000;
  while (!predicate()) {
    if (Date.now() > deadline) throw Error("Timed out waiting for expected event");
    await new Promise(r => setTimeout(r, 10));
  }
};
test("rejected first callback is caught; second turn works; unexpected close is reported", async () => {
  const server = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  await new Promise(r => server.once("listening", r));
  const saved = { url: process.env.MUSE_VT_WS_URL, key: process.env.MODEL_API_KEY, label: process.env.OWNER_SPEAKER_LABEL };
  process.env.MUSE_VT_WS_URL = `ws://127.0.0.1:${server.address().port}`;
  process.env.MODEL_API_KEY = "local-test-not-a-real-key";
  let peer;
  server.on("connection", socket => { peer = socket; socket.once("message", () => socket.send(JSON.stringify({ sessionId: "fixture" }))); });
  const turns = [], failures = [];
  const vt = new VoiceTranscribeStream(async turn => { turns.push(turn.text); if (turns.length === 1) throw Error("synthetic failure"); }, code => failures.push(code));
  try {
    await vt.connect();
    const emit = (id, text) => { peer.send(JSON.stringify({ type: "speechStart", turnId: id })); peer.send(JSON.stringify({ type: "speaker", turnId: id, label: "A" })); peer.send(JSON.stringify({ type: "speechComplete", turnId: id, transcript: text })); };
    emit(1, "first sample");
    await waitFor(() => failures.includes("turn-failed"));
    emit(2, "second sample");
    await waitFor(() => turns.length === 2);
    assert.deepEqual(turns, ["first sample", "second sample"]);
    peer.close();
    await waitFor(() => failures.includes("transcription-closed"));
  } finally {
    vt.close();
    for (const client of server.clients) client.terminate();
    await new Promise(r => server.close(r));
    for (const [name, value] of [["MUSE_VT_WS_URL",saved.url],["MODEL_API_KEY",saved.key],["OWNER_SPEAKER_LABEL",saved.label]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});
