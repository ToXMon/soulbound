// Ticket 008 offline self-checks for the private vision provenance sidecar.
// Synthetic metadata only; no frames, no network, no credentials. Run after
// build: node --test dist/memory/vision-sidecar.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  VisionSidecarStore,
  validateSidecarEntry,
  MAX_SIDECAR_ENTRIES,
} from "./vision-sidecar.js";

const NS = { ownerId: "owner-1", characterId: "character-1" };
const HEX = "ab".repeat(32);

function goodEntry(overrides: Record<string, unknown> = {}) {
  return validateSidecarEntry({
    schema_version: 1,
    record_id: "mem-record-1",
    character_id: NS.characterId,
    frame_hash: HEX,
    mask_ref: "mask-1",
    timestamp: "2026-11-01T12:00:00.000Z",
    trigger_id: "trigger-1",
    ...overrides,
  });
}

function freshRoot(): string {
  return mkdtempSync(join(tmpdir(), "vision-sidecar-test-"));
}

test("entry validation is strict and metadata-only", () => {
  const ok = goodEntry();
  assert.equal(ok.record_id, "mem-record-1");
  // Raw bytes / payloads / transcripts have no field here and are rejected.
  for (const smuggled of ["frame_bytes", "image_base64", "mask_bytes", "mask_bitmap", "transcript", "extra"]) {
    assert.throws(() => validateSidecarEntry({ ...ok, [smuggled]: "x" }), /unknown field/, smuggled);
  }
  assert.throws(() => validateSidecarEntry({ ...ok, frame_hash: "not-hex" }), /frame_hash/);
  assert.throws(() => validateSidecarEntry({ ...ok, mask_ref: "x".repeat(257) }), /mask_ref/);
  assert.throws(() => validateSidecarEntry({ ...ok, trigger_id: "" }), /trigger_id/);
  assert.throws(() => validateSidecarEntry({ ...ok, timestamp: "not-a-date" }), /timestamp/);
  assert.throws(() => validateSidecarEntry({ ...ok, record_id: "" }), /record_id/);
  // Character binding: another character's entry is rejected for this namespace.
  assert.throws(
    () => validateSidecarEntry({ ...ok, character_id: "other-character" }, NS.characterId),
    /character_id/,
  );
});

test("link + get round-trip; identical relink idempotent, conflicting relink throws", async () => {
  const store = await VisionSidecarStore.open(freshRoot(), NS);
  assert.deepEqual(store.stats(), { entries: 0 });
  assert.equal(store.get("mem-record-1"), null);
  await store.link(goodEntry());
  assert.deepEqual(store.get("mem-record-1"), goodEntry());
  assert.deepEqual(store.stats(), { entries: 1 });
  // Identical relink (retry path): no duplicate.
  await store.link(goodEntry());
  assert.deepEqual(store.stats(), { entries: 1 });
  // Conflicting entry for the same record id: tamper signal, throws.
  await assert.rejects(store.link(goodEntry({ mask_ref: "different-mask" })), /conflicting/);
  await assert.rejects(store.link(goodEntry({ trigger_id: "different-trigger" })), /conflicting/);
  assert.deepEqual(store.stats(), { entries: 1 });
});

test("failed sidecar write rolls back memory state and allows retry", async () => {
  const root = freshRoot();
  const store = await VisionSidecarStore.open(root, NS);
  const path = join(store.dir, "vision-sidecar.json");
  unlinkSync(path);
  mkdirSync(path); // rename(temp, existing directory) fails after entry is staged
  await assert.rejects(store.link(goodEntry()), /EISDIR|ENOTEMPTY|directory/i);
  assert.deepEqual(store.stats(), { entries: 0 }, "failed write must roll back the in-memory entry");
  rmSync(path, { recursive: true });
  await store.link(goodEntry());
  assert.deepEqual(store.stats(), { entries: 1 }, "same entry can be retried successfully");
});

test("entries persist across reopen and carry no byte payloads", async () => {
  const root = freshRoot();
  const first = await VisionSidecarStore.open(root, NS);
  await first.link(goodEntry());
  await first.link(goodEntry({ record_id: "mem-record-2", trigger_id: "trigger-2" }));
  const second = await VisionSidecarStore.open(root, NS);
  assert.deepEqual(second.stats(), { entries: 2 });
  assert.equal(second.get("mem-record-2")?.trigger_id, "trigger-2");
  // The file on disk is JSON metadata only — no byte-carrying keys anywhere.
  const text = readFileSync(join(second.dir, "vision-sidecar.json"), "utf8");
  for (const banned of ["base64", "frame_bytes", "mask_bytes", "mask_bitmap", "transcript", "data:"]) {
    assert.ok(!text.includes(banned), `sidecar file must not contain ${banned}`);
  }
});

test("corrupt or foreign sidecar files throw and are never overwritten", async () => {
  const root = freshRoot();
  const seed = await VisionSidecarStore.open(root, NS);
  await seed.link(goodEntry());
  const path = join(seed.dir, "vision-sidecar.json");
  const pristine = readFileSync(path, "utf8");
  // Garbage: open throws.
  writeFileSync(path, "not json{{", "utf8");
  await assert.rejects(VisionSidecarStore.open(root, NS), /./);
  // Foreign namespace content: open throws.
  writeFileSync(path, JSON.stringify({ schema_version: 1, owner_id: "intruder", character_id: NS.characterId, entries: [] }), "utf8");
  await assert.rejects(VisionSidecarStore.open(root, NS), /namespace|corrupt/);
  // Duplicate record ids: corrupt.
  writeFileSync(path, JSON.stringify({
    schema_version: 1, owner_id: NS.ownerId, character_id: NS.characterId,
    entries: [goodEntry(), goodEntry()],
  }), "utf8");
  await assert.rejects(VisionSidecarStore.open(root, NS), /duplicate/);
  // Nothing was clobbered by the failed opens: restore and reopen cleanly.
  writeFileSync(path, pristine, "utf8");
  const recovered = await VisionSidecarStore.open(root, NS);
  assert.deepEqual(recovered.stats(), { entries: 1 });
});

test("entry bound is enforced", async () => {
  const root = freshRoot();
  const store = await VisionSidecarStore.open(root, NS);
  assert.deepEqual(store.stats(), { entries: 0 });
  // Craft a full sidecar file directly (one write), then prove the next link
  // is refused instead of growing past the bound.
  const entries = Array.from({ length: MAX_SIDECAR_ENTRIES }, (_, i) =>
    goodEntry({ record_id: `mem-record-${i}`, trigger_id: `trigger-${i}` }),
  );
  writeFileSync(
    join(store.dir, "vision-sidecar.json"),
    JSON.stringify({ schema_version: 1, owner_id: NS.ownerId, character_id: NS.characterId, entries }),
    "utf8",
  );
  const full = await VisionSidecarStore.open(root, NS);
  assert.deepEqual(full.stats(), { entries: MAX_SIDECAR_ENTRIES });
  await assert.rejects(full.link(goodEntry({ record_id: "one-too-many", trigger_id: "t" })), /bound/);
});
