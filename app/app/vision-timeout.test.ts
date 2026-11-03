import test from "node:test";
import assert from "node:assert/strict";
import { VisionTrigger } from "./vision-trigger.js";

test("hung camera acquisition times out, cancels, and clears a late frame", async () => {
  let resolveCapture!: (frame: Uint8Array) => void;
  let cancelled = 0;
  let published = 0;
  const trigger = new VisionTrigger({
    captureTimeoutMs: 15,
    source: {
      capture: () => new Promise(resolve => { resolveCapture = resolve; }),
      cancel: () => { cancelled++; },
    },
    transport: { publishFrame: async () => { published++; } },
    onStatus: () => {},
  });
  await trigger.look();
  assert.equal(trigger.currentStatus, "unavailable");
  assert.equal(cancelled, 1);
  const late = new Uint8Array([1, 2, 3]);
  resolveCapture(late);
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.ok(late.every(byte => byte === 0));
  assert.equal(published, 0);
});

test("stalled publication times out without clearing transport-owned bytes early", async () => {
  let finish!: () => void;
  let sent!: Uint8Array;
  const trigger = new VisionTrigger({
    publishTimeoutMs: 15,
    source: { capture: async () => new Uint8Array([1, 2]) },
    transport: { publishFrame: data => { sent = data; return new Promise(resolve => { finish = resolve; }); } },
    onStatus: () => {},
  });
  await trigger.look();
  assert.equal(trigger.currentStatus, "unavailable");
  assert.ok(sent.some(byte => byte !== 0));
  finish();
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.ok(sent.every(byte => byte === 0));
  assert.equal(trigger.currentStatus, "unavailable");
});

test("missing observation ends in unavailable rather than sent forever", async () => {
  const trigger = new VisionTrigger({
    responseTimeoutMs: 15,
    source: { capture: async () => new Uint8Array([1]) },
    transport: { publishFrame: async () => {} },
    onStatus: () => {},
  });
  await trigger.look();
  assert.equal(trigger.currentStatus, "sent");
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(trigger.currentStatus, "unavailable");
  assert.equal(trigger.currentTriggerId, null);
});

test("discard during capture cancels hardware and ignores late completion", async () => {
  let resolveCapture!: (frame: Uint8Array) => void;
  let cancelled = 0;
  const trigger = new VisionTrigger({
    source: {
      capture: () => new Promise(resolve => { resolveCapture = resolve; }),
      cancel: () => { cancelled++; },
    },
    transport: { publishFrame: async () => { throw Error("must not publish"); } },
    onStatus: () => {},
  });
  const work = trigger.look();
  trigger.discard();
  resolveCapture(new Uint8Array([1]));
  await work;
  assert.equal(cancelled, 1);
  assert.equal(trigger.currentStatus, "idle");
});
