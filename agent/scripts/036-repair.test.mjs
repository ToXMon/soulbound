import { test } from "node:test";
import assert from "node:assert/strict";
import { SessionContext } from "../dist/session-context.js";
import { conversationMessages } from "../dist/decide.js";
import { runTurn } from "../dist/pipeline.js";

test("stranger requests never receive owner session history even if supplied", () => {
  const messages = conversationMessages({ speaker: "B", text: "hello" }, "stranger",
    [{ role: "user", content: "private owner fact" }, { role: "assistant", content: "private response" }]);
  assert.equal(messages.length, 2);
  assert.ok(!JSON.stringify(messages).includes("private owner fact"));
});
test("session context never stores stranger turns", () => {
  const context = new SessionContext();
  context.append("stranger", "response", "stranger");
  assert.equal(context.length, 0);
});
test("total character budget is a hard bound including a single pair", () => {
  const context = new SessionContext({ maxChars: 100, maxMessageChars: 1000 });
  context.append("x".repeat(90), "y".repeat(20), "owner");
  assert.ok(context.totalChars <= 100);
});
test("history snapshots cannot mutate stored messages", () => {
  const context = new SessionContext();
  context.append("original", "reply", "owner");
  context.getMessages()[0].content = "tampered";
  assert.equal(context.getMessages()[0].content, "original");
});
test("stale cancelled TTS cannot clear a newer turn sharing the audio sink", async () => {
  let failOld;
  let startedOld;
  const started = new Promise(resolve => { startedOld = resolve; });
  const blocked = new Promise((_, reject) => { failOld = reject; });
  let cleared = 0;
  const audio = [];
  const sink = { publishPcm: async b => audio.push(b[0]), clear: () => { cleared++; audio.length = 0; }, flush: async () => {}, close: async () => {} };
  const streamReply = async () => ({ text: "reply", model: "muse-spark-1.3", latencyMs: 0 });
  const voice = { description: "synthetic", seed: 42 };
  const oldAbort = new AbortController();
  const old = runTurn({ speaker: "A", text: "old" }, 0, {
    streamReply, voice, sink, signal: oldAbort.signal,
    tts: { name: "old", async *synthesize() { startedOld(); await blocked; } },
  });
  await started;
  oldAbort.abort();
  await runTurn({ speaker: "A", text: "new" }, 0, {
    streamReply, voice, sink,
    tts: { name: "new", async *synthesize() { yield Buffer.from([2, 0]); } },
  });
  failOld(new Error("late old cancellation"));
  await old;
  assert.equal(cleared, 0, "old turn does not own the current sink");
  assert.deepEqual(audio, [2]);
});
