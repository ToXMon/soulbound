// Ticket 021 self-checks. Synthetic fixtures only; no personal data.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { MemoryStore, verifyProof } from "../dist/memory/store.js";
import { retrieve, bindRecallStore, recallForTurn, MAX_RECALL_CHARS } from "../dist/memory/retrieval.js";
import { conversationMessages, decide, decideStream } from "../dist/decide.js";
import { systemPrompt } from "../dist/orient.js";

const NS = { ownerId: "recall-test-owner", characterId: "recall-test-character" };
const ENV = { MEMORY_ENABLED: "true" };
const NOW = Date.parse("2026-10-31T12:00:00Z");
const options = { topK: 3, maxChars: 1800, now: NOW };
const item = summary => ({ type: "fact", summary, confidence: 1, source_turn_ids: ["synthetic-session:1"] });
const record = (id, summary, epoch = 0, days = 0) => ({ id, summary, epoch, timestamp: new Date(NOW - days * 86400000).toISOString(), content_hash: "0".repeat(64) });
const ids = result => result.recordIds;
const lines = result => result.context.split("\n").filter(l => l.startsWith("{")).map(JSON.parse);
async function fixture(fn) {
  const root = await mkdtemp(join(tmpdir(), "sb021-"));
  let store;
  try { store = await MemoryStore.open(root, NS); await fn(store, root); }
  finally { bindRecallStore(null); await store?.close(); await rm(root, { recursive: true, force: true }); }
}

test("pure ranking: overlap, recency, epoch weight, stable ties, top_k; input unchanged", () => {
  const records = [record("old", "orchid garden", 0, 10), record("recent", "orchid garden"), record("new-epoch", "orchid garden", 1), record("weak", "orchid", 9)];
  const before = JSON.stringify(records);
  assert.deepEqual(ids(retrieve(records, "orchid garden", options)), ["new-epoch", "recent", "old"]);
  assert.deepEqual(ids(retrieve(records, "orchid garden", { ...options, topK: 1 })), ["new-epoch"]);
  const ties = [record("b", "orchid"), record("a", "orchid")];
  assert.deepEqual(ids(retrieve(ties, "ORCHID!", options)), ["a", "b"]);
  assert.deepEqual(retrieve(ties, "orchid", options), retrieve([...ties].reverse(), "orchid", options));
  assert.equal(JSON.stringify(records), before);
});

test("empty, miss, stopwords, invalid knobs and zero budgets inject nothing", () => {
  for (const query of ["", "hello are you there", "volcano"]) assert.equal(retrieve([record("a", "orchid")], query, options).context, "");
  assert.equal(retrieve([], "orchid", options).context, "");
  for (const overrides of [{ topK: 0 }, { topK: -1 }, { topK: 11 }, { topK: 1.5 }, { maxChars: 0 }, { maxChars: Infinity }, { maxChars: MAX_RECALL_CHARS + 1 }, { now: NaN }]) {
    assert.deepEqual(retrieve([record("a", "orchid")], "orchid", { ...options, ...overrides }), { context: "", recordIds: [] });
  }
});

test("full-context cap includes provenance/escaping; records fit exactly or are skipped whole", () => {
  const small = record("a", 'orchid "garden"\n🌱');
  const exact = retrieve([small], "orchid", options);
  assert.equal(lines(exact)[0].summary, small.summary);
  assert.deepEqual(retrieve([small], "orchid", { ...options, maxChars: exact.context.length }), exact);
  assert.equal(retrieve([small], "orchid", { ...options, maxChars: exact.context.length - 1 }).context, "");
  const records = [record("large", "orchid ".repeat(65)), small, ...Array.from({ length: 100 }, (_, i) => record(`z${i}`, "orchid garden"))];
  const bounded = retrieve(records, "orchid", { ...options, maxChars: exact.context.length, topK: 10 });
  assert.deepEqual(ids(bounded), ["a"]);
  assert.ok(bounded.context.length <= exact.context.length);
  assert.deepEqual(lines(bounded), lines(exact));
});

test("live store recall is read-only: no competing lock acquisition, bytes/files unchanged; unbound nonexistent path stays absent", async () => {
  await fixture(async (store, root) => {
    await store.appendExtracted("synthetic:1", [item("The synthetic orchid garden has a blue gate.")]);
    await store.sealEpoch();
    bindRecallStore(store);
    // A second open WOULD collide, but bound recall succeeds while that lock is held.
    await assert.rejects(MemoryStore.open(root, NS), /lock/);
    const files = await readdir(root, { recursive: true });
    const bytes = await readFile(join(store.dir, "store.json"));
    const lock = await stat(join(store.dir, "writer.lock"));
    const result = recallForTurn("orchid garden", "owner", ENV);
    assert.deepEqual(ids(result), [store.records[0].id]);
    assert.deepEqual(await readdir(root, { recursive: true }), files);
    assert.deepEqual(await readFile(join(store.dir, "store.json")), bytes);
    assert.equal((await stat(join(store.dir, "writer.lock"))).ino, lock.ino);
    bindRecallStore(null);
    const missing = join(root, "does-not-exist");
    assert.equal(recallForTurn("orchid", "owner", { ...ENV, MEMORY_STORE_PATH: missing }).context, "");
    await assert.rejects(stat(missing), { code: "ENOENT" });
  });
});

test("only sealed, current records; owner gate, disable, unbind and silent miss", async () => {
  await fixture(async store => {
    const [old] = await store.appendExtracted("one", [item("The orchid gate is teal.")]);
    bindRecallStore(store);
    assert.equal(recallForTurn("orchid", "owner", ENV).context, "");
    await store.sealEpoch();
    assert.deepEqual(ids(recallForTurn("orchid", "owner", ENV)), [old.id]);
    for (const env of [{}, { ...ENV, MEMORY_RECALL_ENABLED: "false" }, { ...ENV, MEMORY_RECALL_TOP_K: "bad" }]) assert.equal(recallForTurn("orchid", "owner", env).context, "");
    assert.equal(recallForTurn("orchid", "stranger", ENV).context, "");
    assert.equal(recallForTurn("volcano", "owner", ENV).context, "");
    await store.appendExtracted("two", [{ ...item("The orchid gate is blue."), type: "correction", supersedes: old.id }]);
    assert.equal(recallForTurn("orchid", "owner", ENV).context, ""); // do not repeat stale sealed facts
    await store.sealEpoch();
    assert.deepEqual(ids(recallForTurn("orchid", "owner", ENV)), [store.records[1].id]);
  });
});

test("restart/session-2 injection carries exact stored content and locally verifiable epoch-0 provenance", async () => {
  const root = await mkdtemp(join(tmpdir(), "sb021-restart-"));
  let store;
  const prior = process.env.MEMORY_ENABLED;
  try {
    store = await MemoryStore.open(root, NS);
    const [saved] = await store.appendExtracted("session-one", [item("The synthetic orchid garden has a blue gate.")]);
    const manifest = await store.sealEpoch();
    await store.close();
    store = await MemoryStore.open(root, NS);
    bindRecallStore(store);
    process.env.MEMORY_ENABLED = "true";
    const messages = conversationMessages({ speaker: "A", text: "Tell me about the orchid garden." }, "owner");
    const context = messages[0].content.slice(systemPrompt("owner").length);
    const injected = lines({ context });
    assert.equal(injected.length, 1);
    for (const entry of injected) {
      const stored = store.records.find(r => r.id === entry.id);
      assert.ok(stored);
      assert.equal(entry.summary, saved.summary);
      assert.equal(entry.content_hash, stored.content_hash);
      assert.equal(entry.epoch, 0);
      const proof = store.proofFor(entry.id);
      assert.equal(proof.manifest.root, manifest.root);
      assert.equal(verifyProof(manifest.root, proof.proof), true);
      assert.equal(store.verifyRecord(stored), true);
    }
    assert.equal(conversationMessages({ speaker: "B", text: "orchid" }, "stranger")[0].content, systemPrompt("stranger"));
    assert.equal(conversationMessages({ speaker: "A", text: "volcano" }, "owner")[0].content, systemPrompt("owner"));
    // Optional real Spark check; synthetic content only, not an owner-voice claim.
    if (process.env.RECALL_LIVE_CHECK === "true") {
      const reply = await decide({ speaker: "A", text: "What colour is the gate in the synthetic orchid garden?" }, "owner");
      assert.match(reply.text, /blue/i);
      console.log(`LIVE_SYNTHETIC_TWO_SESSION_OK record_id=${saved.id} epoch=0 model=${reply.model} (local proof only; no chain read)`);
    }
  } finally {
    if (prior === undefined) delete process.env.MEMORY_ENABLED; else process.env.MEMORY_ENABLED = prior;
    bindRecallStore(null); await store?.close(); await rm(root, { recursive: true, force: true });
  }
});

test("both Spark variants send the same bounded context (offline HTTP fixture)", async () => {
  const captured = [];
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const payload = JSON.parse(body);
    captured.push(payload);
    if (payload.stream) {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.end('data: {"model":"muse-spark-1.3","choices":[{"delta":{"content":"Blue gate."}}]}\n\ndata: [DONE]\n\n');
    } else {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ model: "muse-spark-1.3", choices: [{ message: { content: "Blue gate." } }] }));
    }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const keys = ["MODEL_API_KEY", "MODEL_API_BASE_URL", "MEMORY_ENABLED"];
  const prior = keys.map(k => process.env[k]);
  try {
    process.env.MODEL_API_KEY = "synthetic-offline-fixture";
    process.env.MODEL_API_BASE_URL = `http://127.0.0.1:${server.address().port}/v1`;
    process.env.MEMORY_ENABLED = "true";
    await fixture(async store => {
      await store.appendExtracted("one", [item("The synthetic orchid garden has a blue gate.")]);
      await store.sealEpoch(); bindRecallStore(store);
      const turn = { speaker: "A", text: "orchid garden" };
      assert.equal((await decide(turn, "owner")).text, "Blue gate.");
      assert.equal((await decideStream(turn, "owner")).text, "Blue gate.");
      assert.deepEqual(captured[0].messages, captured[1].messages);
      assert.ok(captured[0].messages[0].content.includes(store.records[0].summary));
      assert.ok(captured[0].messages[0].content.includes(store.records[0].id));
    });
  } finally {
    keys.forEach((k, i) => { if (prior[i] === undefined) delete process.env[k]; else process.env[k] = prior[i]; });
    await new Promise(resolve => server.close(resolve));
  }
});

test("direct recall-call timing: 200 calls over 1000 synthetic sealed records, p50 <30ms", () => {
  const records = Array.from({ length: 1000 }, (_, i) => record(`fixture-${i}`, `Synthetic orchid garden number ${i}.`, 0, i));
  bindRecallStore({ records, manifests: [{ record_ids: records.map(r => r.id) }] });
  try {
    const samples = [];
    for (let i = 0; i < 220; i++) {
      const start = performance.now();
      const result = recallForTurn("orchid garden", "owner", ENV);
      const elapsed = performance.now() - start;
      assert.equal(result.recordIds.length, 3);
      if (i >= 20) samples.push(elapsed);
    }
    samples.sort((a, b) => a - b);
    const p50 = samples[Math.floor(samples.length / 2)];
    console.log(`DIRECT_RECALL_TIMING N=${samples.length} records=1000 top_k=3 max_chars=1800 p50=${p50.toFixed(3)}ms (20 warmups excluded)`);
    assert.ok(p50 < 30, `recall p50 ${p50}ms exceeds budget`);
  } finally { bindRecallStore(null); }
});
