import { test } from "node:test";
import assert from "node:assert/strict";
import { SessionContext } from "../dist/session-context.js";
import { conversationMessages } from "../dist/decide.js";

test("second request contains the preceding user and assistant pair", () => {
  const ctx = new SessionContext();
  ctx.append("My favourite colour is cerulean blue.", "I will remember blue.", "owner");
  const msgs = conversationMessages({ speaker: "A", text: "What is my favourite colour?" }, "owner", ctx.getMessages());
  assert.deepEqual(msgs.map(m => m.role), ["system", "user", "assistant", "user"]);
  assert.equal(msgs[1].content, "My favourite colour is cerulean blue.");
  assert.equal(msgs[2].content, "I will remember blue.");
});
test("separate room jobs and reset do not share history", () => {
  const a = new SessionContext(), b = new SessionContext();
  a.append("private", "reply", "owner");
  assert.equal(b.length, 0);
  a.reset();
  assert.equal(a.length, 0);
});
test("retains complete pairs under turn and character limits", () => {
  const ctx = new SessionContext({ maxTurns: 2, maxChars: 100, maxMessageChars: 20 });
  for (let i = 0; i < 5; i++) ctx.append(`turn${i}`, `reply${i}`, "owner");
  assert.equal(ctx.turnCount, 2);
  assert.equal(ctx.getMessages()[0].content, "turn3");
  assert.ok(ctx.totalChars <= 100);
  assert.deepEqual(ctx.getMessages().map(m => m.role), ["user", "assistant", "user", "assistant"]);
});
test("stranger context is never stored or supplied", () => {
  const ctx = new SessionContext();
  ctx.append("visitor", "hello", "stranger");
  ctx.append("owner fact", "owner reply", "owner");
  assert.equal(ctx.turnCount, 1);
  assert.deepEqual(ctx.getMessages("stranger"), []);
  assert.equal(conversationMessages({ speaker: "B", text: "hello" }, "stranger", ctx.getMessages()).length, 2);
});
test("bounds reject invalid configuration and cap individual messages", () => {
  assert.throws(() => new SessionContext({ maxTurns: -1 }));
  const ctx = new SessionContext({ maxMessageChars: 5 });
  ctx.append("abcdefgh", "ijklmnop", "owner");
  assert.deepEqual(ctx.getMessages().map(m => m.content), ["abcde", "ijklm"]);
});
