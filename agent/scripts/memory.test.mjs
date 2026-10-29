// Ticket 004 deterministic tests — OFFLINE FIXTURES ONLY (fake extractor).
// No network, no real inference. Run after `pnpm build`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, readdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalJson } from "../dist/memory/canonical.js";
import { keccakHex, contentHash, merkleRoot, merkleProof, verifyProof } from "../dist/memory/merkle.js";
import { MemoryStore } from "../dist/memory/store.js";
import { MemoryQueue, publishThenEnqueue } from "../dist/memory/queue.js";
import { validateExtraction } from "../dist/memory/schema.js";
import { memoryConfigFromEnv } from "../dist/memory/config.js";

const NS = { ownerId: "owner-pubkey-1", characterId: "char-elder" };
const tmp = () => mkdtemp(join(tmpdir(), "sb004-"));
const turn = (id, userText) => ({ id, speakerKind: "owner", userText, replyText: "Noted." });

// Fake extractor (OFFLINE FIXTURE): deterministic rules over synthetic text.
function fakeExtractor() {
  return {
    async extract(turns, prior) {
      const t = turns[0];
      if (t.userText.toLowerCase().includes("actually")) {
        const target = prior.find((p) => p.summary.includes("colour"));
        return [{ type: "correction", summary: "Owner's favourite colour is blue (corrected).", confidence: 0.95, source_turn_ids: [t.id], ...(target ? { supersedes: target.id } : {}) }];
      }
      if (t.userText.includes("colour")) return [{ type: "fact", summary: "Owner's favourite colour is teal.", confidence: 0.9, source_turn_ids: [t.id] }];
      return [{ type: "event", summary: "Owner mentioned a walk by the sea.", confidence: 0.8, source_turn_ids: [t.id] }];
    },
  };
}
async function seededStore() {
  const root = await tmp();
  const store = await MemoryStore.open(root, NS);
  const q = new MemoryQueue(store, fakeExtractor());
  q.enqueue({ key: "job:1", turns: [turn("s:1", "My favourite colour is teal.")] });
  q.enqueue({ key: "job:2", turns: [turn("s:2", "I walked by the sea today.")] });
  q.enqueue({ key: "job:3", turns: [turn("s:3", "Actually, my favourite colour is blue now.")] });
  assert.equal(await q.flush(5000), true);
  return { root, store, q };
}

test("canonical JSON is stable across property insertion order; rejects undefined/non-finite", () => {
  assert.equal(canonicalJson({ b: 1, a: { d: [1, 2], c: "x" } }), canonicalJson({ a: { c: "x", d: [1, 2] }, b: 1 }));
  assert.throws(() => canonicalJson({ a: undefined }), /undefined/);
  assert.throws(() => canonicalJson({ a: Infinity }), /non-finite/);
  assert.throws(() => canonicalJson({ a: () => {} }), /unsupported/);
});

test("keccak-256 known vectors (not sha3-256)", () => {
  assert.equal(keccakHex(""), "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470");
  assert.equal(keccakHex("abc"), "4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45");
});

test("three-turn fact/correction: persistence, superseding v2, v1 retained, idempotent replay", async () => {
  const { root, store, q } = await seededStore();
  assert.equal(store.records.length, 3);
  const v1 = store.records.find((r) => r.summary.includes("teal"));
  const v2 = store.records.find((r) => r.type === "correction");
  assert.ok(v1 && v2);
  assert.equal(v2.supersedes, v1.id);
  assert.equal(v2.version, v1.version + 1);
  // Replay same job keys: no duplicates.
  q.enqueue({ key: "job:1", turns: [turn("s:1", "My favourite colour is teal.")] });
  assert.equal(await q.flush(5000), true);
  assert.equal(store.records.length, 3);
  // Fresh-process reopen (new instance over same files; writer lock released first).
  await store.close();
  const reopened = await MemoryStore.open(root, NS);
  assert.equal(reopened.records.length, 3);
  assert.deepEqual(reopened.records.map((r) => r.id), store.records.map((r) => r.id));
  assert.equal(reopened.records.find((r) => r.id === v1.id).summary, v1.summary); // v1 bytes unchanged
  await reopened.close();
});

test("namespaces isolated; traversal/invalid ids rejected; cross-namespace supersedes rejected", async () => {
  const root = await tmp();
  const a = await MemoryStore.open(root, NS);
  const b = await MemoryStore.open(root, { ownerId: "owner-pubkey-1", characterId: "char-other" });
  await a.appendExtracted("j1", [{ type: "fact", summary: "A secret fact.", confidence: 1, source_turn_ids: ["t1"] }]);
  assert.equal(b.records.length, 0);
  await assert.rejects(() => b.appendExtracted("j2", [{ type: "correction", summary: "Hijack.", confidence: 1, source_turn_ids: ["t1"], supersedes: a.records[0].id }]), /not found in this namespace/);
  await assert.rejects(() => MemoryStore.open(root, { ownerId: "../evil", characterId: "x" }), /invalid identifier/);
  await assert.rejects(() => MemoryStore.open(root, { ownerId: "ok", characterId: "a/b" }), /invalid identifier/);
  assert.equal((await readdir(root)).length, 2);
});

test("malformed extraction rejected: extra fields, bad confidence, foreign provenance/supersedes", async () => {
  assert.throws(() => validateExtraction({ memories: [{ type: "fact", summary: "x", confidence: 2, source_turn_ids: ["t1"] }] }, ["t1"]), /confidence/);
  assert.throws(() => validateExtraction({ memories: [{ type: "fact", summary: "x", confidence: 0.5, source_turn_ids: ["foreign"] }] }, ["t1"]), /submitted turns/);
  assert.throws(() => validateExtraction({ memories: [{ type: "fact", summary: "x", confidence: 0.5, source_turn_ids: ["t1"], hacked: true }] }, ["t1"]), /unknown field/);
  assert.throws(() => validateExtraction({ memories: [], extra: 1 }, ["t1"]), /unknown field/);
  // Foreign supersedes through the store path also fails visibly.
  const store = await MemoryStore.open(await tmp(), NS);
  await assert.rejects(() => store.appendExtracted("j", [{ type: "correction", summary: "x", confidence: 0.5, source_turn_ids: ["t1"], supersedes: "no-such-id" }]), /not found/);
  assert.equal(store.records.length, 0);
});

test("corrupt store throws visibly; orphan tmp from interrupted write is ignored", async () => {
  const { root, store } = await seededStore();
  await store.close();
  const { namespaceDirName } = await import("../dist/memory/store.js");
  const dir = join(root, namespaceDirName(NS));
  await writeFile(join(dir, "store.json.dead.tmp"), "{partial");
  const reopened = await MemoryStore.open(root, NS); // tmp ignored, good data loads
  assert.equal(reopened.records.length, store.records.length);
  await reopened.close();
  await writeFile(join(dir, "store.json"), "{corrupt");
  await assert.rejects(() => MemoryStore.open(root, NS), /JSON|Unexpected|corrupt/i);
});

test("merkle: empty/single/odd/multiple, valid proof, tamper fails loudly (REQ-51/52)", async () => {
  assert.equal(merkleRoot([]), null);
  const leaf = (s) => Buffer.from(keccakHex(s), "hex");
  const leaves = ["a", "b", "c", "d", "e"].map(leaf);
  assert.equal(merkleRoot([leaves[0]]).toString("hex"), leaves[0].toString("hex"));
  for (const batch of [leaves.slice(0, 2), leaves.slice(0, 3), leaves]) {
    const root = merkleRoot(batch).toString("hex");
    for (const l of batch) assert.equal(verifyProof(root, merkleProof(batch, l)), true);
    assert.equal(verifyProof(root, { ...merkleProof(batch, batch[0]), leaf: keccakHex("tampered") }), false);
  }
  // Deterministic regardless of input order.
  assert.equal(merkleRoot([...leaves].reverse()).toString("hex"), merkleRoot(leaves).toString("hex"));
  // Content hash stable across insertion order.
  assert.equal(contentHash({ b: 1, a: "x", content_hash: "0".repeat(64) }), contentHash({ a: "x", b: 1 }));
});

test("sealed epoch manifest survives restart; late records enter a new epoch; tampered record fails verify", async () => {
  const { root, store } = await seededStore();
  const m1 = await store.sealEpoch();
  assert.ok(m1 && m1.root && m1.record_ids.length === 3);
  assert.equal(await store.sealEpoch(), null); // empty epoch: no root
  const { proof, manifest } = store.proofFor(store.records[0].id);
  assert.equal(verifyProof(manifest.root, proof), true);
  assert.equal(store.verifyRecord(store.records[0]), true);
  assert.equal(store.verifyRecord({ ...store.records[0], summary: "tampered summary" }), false);
  await store.close();
  const reopened = await MemoryStore.open(root, NS);
  assert.deepEqual(reopened.manifests, store.manifests);
  await reopened.appendExtracted("late:1", [{ type: "fact", summary: "Late fact.", confidence: 0.5, source_turn_ids: ["t9"] }]);
  assert.equal(reopened.records.at(-1).epoch, m1.epoch + 1);
  assert.equal(reopened.manifests.length, 1); // sealed epoch unchanged
  await reopened.close();
});

test("queue: bounded capacity reports overflow; timeout fails visibly; shutdown drain reports incomplete", async () => {
  const store = await MemoryStore.open(await tmp(), NS);
  const slow = { extract: () => new Promise(() => {}) }; // never settles
  const q = new MemoryQueue(store, slow, { capacity: 1, timeoutMs: 100 });
  assert.equal(q.enqueue({ key: "a", turns: [turn("s:1", "x")] }), true);
  assert.equal(q.enqueue({ key: "b", turns: [turn("s:2", "y")] }), false); // overflow, counted
  assert.equal(q.getStats().droppedOverflow, 1);
  assert.equal(await q.flush(50), false); // bounded drain: incomplete, reported
  const q2 = new MemoryQueue(store, { extract: async () => { await new Promise((r) => setTimeout(r, 10)); return []; } }, { timeoutMs: 1000 });
  q2.enqueue({ key: "c", turns: [turn("s:3", "z")] });
  assert.equal(await q2.flush(5000), true);
  assert.equal(q2.getStats().completed, 1);
});

test("publication occurs before extraction settles (voice path never awaits memory)", async () => {
  const store = await MemoryStore.open(await tmp(), NS);
  const order = [];
  let release;
  const gate = new Promise((r) => { release = r; });
  const q = new MemoryQueue(store, { extract: async () => { await gate; order.push("extracted"); return []; } });
  await publishThenEnqueue(async () => { order.push("published"); }, q, { key: "k", turns: [turn("s:1", "hi")] });
  assert.deepEqual(order, ["published"]); // published while extraction still pending
  release();
  assert.equal(await q.flush(5000), true);
  assert.deepEqual(order, ["published", "extracted"]);
});

test("REGRESSION review: manifest with self-consistent root over unrelated leaves is rejected on reopen", async () => {
  const { root, store } = await seededStore();
  await store.sealEpoch();
  await store.close();
  const { namespaceDirName } = await import("../dist/memory/store.js");
  const path = join(root, namespaceDirName(NS), "store.json");
  const file = JSON.parse(await readFile(path, "utf8"));
  const fake = ["a", "b", "c"].map((s) => keccakHex(`unrelated-${s}`));
  file.manifests[0].leaf_hashes = fake;
  file.manifests[0].record_ids = ["fake-1", "fake-2", "fake-3"];
  file.manifests[0].root = merkleRoot(fake.map((h) => Buffer.from(h, "hex"))).toString("hex");
  await writeFile(path, JSON.stringify(file));
  await assert.rejects(() => MemoryStore.open(root, NS), /manifest/);
});

test("REGRESSION review: manifest epoch progression and duplicate record ids are rejected on reopen", async () => {
  const { root, store } = await seededStore();
  await store.sealEpoch();
  await store.close();
  const { namespaceDirName } = await import("../dist/memory/store.js");
  const path = join(root, namespaceDirName(NS), "store.json");
  const original = await readFile(path, "utf8");
  const bad1 = JSON.parse(original);
  bad1.next_epoch = 99;
  await writeFile(path, JSON.stringify(bad1));
  await assert.rejects(() => MemoryStore.open(root, NS), /manifest|epoch/);
  const bad2 = JSON.parse(original);
  bad2.records.push({ ...bad2.records[0] });
  await writeFile(path, JSON.stringify(bad2));
  await assert.rejects(() => MemoryStore.open(root, NS), /duplicate|manifest/);
});

test("REGRESSION review: malformed proof metadata and encodings are rejected", () => {
  const leaf = (s) => Buffer.from(keccakHex(s), "hex");
  const leaves = ["a", "b", "c"].map(leaf);
  const root = merkleRoot(leaves).toString("hex");
  const good = merkleProof(leaves, leaves[0]);
  assert.equal(verifyProof(root, good), true);
  assert.equal(verifyProof(root, { ...good, leafIndex: -10, leafCount: 0 }), false);
  assert.equal(verifyProof(root, { ...good, leafIndex: 3 }), false);
  assert.equal(verifyProof(root, { ...good, leafCount: 999 }), false);
  assert.equal(verifyProof(root, { ...good, leafCount: 1 }), false);
  assert.equal(verifyProof(root, { ...good, leaf: "zz" + good.leaf.slice(2) }), false);
  assert.equal(verifyProof(root, { ...good, leaf: good.leaf.slice(0, 62) }), false);
  assert.equal(verifyProof("not-hex", good), false);
  assert.equal(verifyProof(root, { ...good, siblings: [...good.siblings, good.siblings[0]] }), false);
  assert.equal(verifyProof(root, { ...good, siblings: [] }), false);
  assert.equal(verifyProof(root, null), false);
  // Odd-node duplication: proof for the last of 3 leaves must duplicate itself.
  const oddProof = merkleProof(leaves, [...leaves].sort(Buffer.compare).at(-1));
  assert.equal(verifyProof(root, oddProof), true);
  assert.equal(verifyProof(root, { ...oddProof, siblings: [keccakHex("other"), ...oddProof.siblings.slice(1)] }), false);
});

test("REGRESSION review: single-writer exclusion across instances and processes, stale lock recovers", async () => {
  const root = await tmp();
  const first = await MemoryStore.open(root, NS);
  await assert.rejects(() => MemoryStore.open(root, NS), /writer|lock/i);
  await first.close();
  const second = await MemoryStore.open(root, NS); // released lock reopens fine
  await second.close();

  // Cross-process: child holds the store; parent is rejected; after the child
  // is killed (no clean close), the stale lock is recovered safely.
  const storeUrl = new URL("../dist/memory/store.js", import.meta.url).href;
  const child = spawn(process.execPath, ["--input-type=module", "-e",
    `import { MemoryStore } from ${JSON.stringify(storeUrl)}; const s = await MemoryStore.open(${JSON.stringify(root)}, ${JSON.stringify(NS)}); console.log("READY"); setInterval(() => {}, 1000);`],
    { stdio: ["ignore", "pipe", "pipe"] });
  try {
    await new Promise((resolve, reject) => {
      child.stdout.on("data", (d) => String(d).includes("READY") && resolve());
      child.stderr.on("data", (d) => process.stderr.write(d));
      child.on("exit", (c) => reject(new Error(`child exited ${c}`)));
      setTimeout(() => reject(new Error("child ready timeout")), 10000);
    });
    await assert.rejects(() => MemoryStore.open(root, NS), /writer|lock/i);
  } finally { child.kill("SIGKILL"); await new Promise((r) => child.on("exit", r)); }
  const recovered = await MemoryStore.open(root, NS); // stale pid lock recovered
  await recovered.appendExtracted("after-crash:1", [{ type: "fact", summary: "Recovered writer fact.", confidence: 0.5, source_turn_ids: ["t1"] }]);
  assert.equal(recovered.records.length, 1);
  await recovered.close();
});

test("config: disabled preserves loop; enabled without identity is a startup error", () => {
  assert.equal(memoryConfigFromEnv({}), null);
  assert.equal(memoryConfigFromEnv({ MEMORY_ENABLED: "false" }), null);
  assert.throws(() => memoryConfigFromEnv({ MEMORY_ENABLED: "true" }), /required/);
  assert.throws(() => memoryConfigFromEnv({ MEMORY_ENABLED: "true", MEMORY_STORE_PATH: "/tmp/x", MEMORY_OWNER_ID: "../bad", MEMORY_CHARACTER_ID: "c" }), /invalid identifier/);
  const cfg = memoryConfigFromEnv({ MEMORY_ENABLED: "true", MEMORY_STORE_PATH: "/tmp/x", MEMORY_OWNER_ID: "owner1", MEMORY_CHARACTER_ID: "char1" });
  assert.equal(cfg.namespace.characterId, "char1");
});
