import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile, chmod, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main, readMemoryGraph } from "./run-once.ts";
import { MemoryStore, namespaceDirName } from "../dist/memory/store.js";
import { validateConsolidation, validateReview, structured, dreamModels, CONSOLIDATION_MODEL } from "./consolidator.ts";
import { applyChanges, validateJournal, writeJournal, readJournal, commitTraits, type DreamJournal, type TraitChain } from "./journal.ts";
import { decodeAttributes, sha256, dreamAddress, traitInstruction, PROGRAM_ID, DEVNET_GENESIS, type Snapshot } from "./chain.ts";
const recorded = JSON.parse(await readFile(new URL("./fixtures/recorded.json", import.meta.url), "utf8"));
function journal(): DreamJournal {
  const f = structuredClone(recorded);
  return { schema_version: 1, fixture: true, created_at: "2026-10-30T00:00:00.000Z", program: PROGRAM_ID, genesis: DEVNET_GENESIS,
    snapshot: f.snapshot, memories: f.memories, models: { consolidation: CONSOLIDATION_MODEL, review: "muse-wonder-1.0" },
    consolidation: f.consolidation, review: f.review, new_attributes: applyChanges(f.snapshot, f.review) };
}
test("versioned responses reject invented references, reserved keys, duplicates and malformed values", async () => {
  const j = journal(); await validateJournal(j);
  for (const mutate of [
    (v: any) => v.changes[0].memory_ids.push("invented"),
    (v: any) => v.changes[0].key = "life_stage",
    (v: any) => v.changes.push(v.changes[0]),
    (v: any) => v.changes[0].value = "é".repeat(65),
    (v: any) => v.unexpected = true,
  ]) { const bad = structuredClone(j.review); mutate(bad); assert.throws(() => validateReview(bad, j.memories)); }
  assert.throws(() => validateConsolidation({ schema_version: 1, themes: [{ summary: "x", memory_ids: ["unknown"] }] }, j.memories));
  const custom = { ...j.snapshot, attributes: [...j.snapshot.attributes, { key: "custom", value: "preserve me" }], memoryEpoch: "12" };
  const attrs = applyChanges(custom, j.review);
  assert.equal(attrs.find(a => a.key === "custom")?.value, "preserve me");
  assert.equal(attrs.find(a => a.key === "memory_epoch")?.value, "12");
  const tampered = journal(); tampered.new_attributes[1].value = "not the reviewed proposal";
  await assert.rejects(validateJournal(tampered), /proposal mismatch/);
});
test("read-only graph snapshot works with the voice writer lock held, validates hashes, never writes source", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sb006-memory-"));
  const ns = { ownerId: recorded.snapshot.owner, characterId: recorded.snapshot.characterId };
  const store = await MemoryStore.open(dir, ns);
  try {
    await store.appendExtracted("fixture-job", [{ type: "event", summary: "FIXTURE: shared experiment", confidence: 1, source_turn_ids: ["fixture-turn"] }]);
    await store.sealEpoch();
    const path = join(dir, namespaceDirName(ns), "store.json"), before = await readFile(path);
    const graph = await readMemoryGraph(dir, ns);
    assert.equal(graph.length, 1); assert.equal(graph[0].id, store.records[0].id);
    assert.deepEqual(await readFile(path), before);
    assert.ok(await access(join(dir, namespaceDirName(ns), "writer.lock")).then(() => true));
    const corrupt = JSON.parse(before.toString()); corrupt.records[0].summary = "tampered";
    await writeFile(path, JSON.stringify(corrupt));
    await assert.rejects(readMemoryGraph(dir, ns), /hash mismatch/);
    await writeFile(path, before);
  } finally { await store.close(); await rm(dir, { recursive: true, force: true }); }
});
test("recorded model responses use structured output and the fixed Meta model ID", async () => {
  let request: any;
  // Explicit fake provider: no network calls or claims of live inference.
  const fake = { chat: { completions: { create: async (body: any) => {
    request = body; return { choices: [{ finish_reason: "stop", message: { content: JSON.stringify(recorded.consolidation) } }] };
  } } } };
  const result = await structured(fake as any, CONSOLIDATION_MODEL, "test-only prompt", { type: "object" }, { memories: recorded.memories });
  assert.equal(request.model, "muse-spark-1.3"); assert.equal(request.response_format.json_schema.strict, true);
  assert.deepEqual(validateConsolidation(result, recorded.memories), recorded.consolidation);
});
test("approved provider substitution uses one Meta client for Spark consolidation and Wonder review", async () => {
  const requests: any[] = [];
  const fake = { chat: { completions: { create: async (body: any) => {
    requests.push(body);
    return { choices: [{ finish_reason: "stop", message: { content: JSON.stringify(
      body.model === "muse-spark-1.3" ? recorded.consolidation : recorded.review) } }] };
  } } } };
  const result = await dreamModels(recorded.memories, recorded.snapshot.attributes, fake as any);
  assert.deepEqual(requests.map(r => r.model), ["muse-spark-1.3", "muse-wonder-1.0"]);
  assert.ok(requests.every(r => !r.model.includes("contributor") && r.response_format.json_schema.strict));
  assert.deepEqual(JSON.parse(requests[1].messages[1].content).consolidation, recorded.consolidation);
  assert.deepEqual(result.review, recorded.review);
});
test("run-once writes immutable, hash-linkable fixture journal; fixture can never send", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sb006-"));
  try {
    const out = join(dir, "journal.json");
    const result = await main(["--character", "genesis", "--out", out]);
    assert.equal(result?.state, "fixture-journal-written");
    const read = await readJournal(out);
    assert.ok(result && "journalHash" in result);
    assert.equal(result.journalHash, read.hash); assert.equal(read.hash, sha256(await readFile(out)));
    assert.equal(read.journal.fixture, true); assert.ok(read.journal.created_at); assert.ok(read.journal.memories[0].id);
    await assert.rejects(main(["--character", "genesis", "--out", out]), /already exists/);
    await assert.rejects(commitTraits(read.journal, read.hash, {} as TraitChain, join(dir, "submission.json"), true), /fixture journal/);
    await assert.rejects(access(`${out}.lock`));
    await chmod(out, 0o644); await assert.rejects(readJournal(out), /private regular file/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test("trait encoding matches generated IDL discriminator and Borsh full list", async () => {
  const j = journal(); const hash = sha256("FIXTURE journal");
  const ix = traitInstruction({ ...j.snapshot, journalHash: hash, newAttributes: j.new_attributes }, await dreamAddress(j.snapshot.config));
  const idl = JSON.parse(await readFile(new URL("../../programs/soulbound/idl/soulbound.json", import.meta.url), "utf8"));
  assert.deepEqual([...ix.data.subarray(0, 8)], idl.instructions.find((i: any) => i.name === "evolve_traits").discriminator);
  assert.equal(ix.data.readBigUInt64LE(8), 0n); assert.equal(ix.data.subarray(16, 48).toString("hex"), hash);
  assert.equal(ix.data.readUInt32LE(48), j.new_attributes.length); assert.equal(ix.accounts.length, 7);
});
test("Core decoder agrees with actual LiteSVM mpl_core.so output and rejects bad authority/bounds", async () => {
  const f = JSON.parse(await readFile(new URL("./fixtures/core-asset.json", import.meta.url), "utf8"));
  const bytes = Buffer.from(f.data, "base64");
  assert.deepEqual(decodeAttributes(bytes, f.config), f.attributes);
  assert.throws(() => decodeAttributes(bytes, PROGRAM_ID), /authority/);
  for (const truncated of [bytes.subarray(0, 10), bytes.subarray(0, bytes.length - 4)]) assert.throws(() => decodeAttributes(truncated, f.config));
});
function fakeChain(j: DreamJournal) {
  let state = structuredClone(j.snapshot), signed = 0, broadcasts = 0, applied = false, status = "absent", height = 1;
  const chain: TraitChain = {
    inspect: async () => structuredClone(state),
    simulate: async () => ({ feeLamports: 10_000, maximumRentLamports: 1_600_000, balanceLamports: 20_000_000, units: 10_000 }),
    sign: async () => { signed++; return { signature: "1".repeat(64), lastValidBlockHeight: 10, wire: "FIXTURE, NOT A REAL TRANSACTION" }; },
    broadcast: async () => { broadcasts++; if (applied) state = { ...state, attributes: j.new_attributes, revision: "1", journalHash: sha256("test journal") }; throw new Error("simulated ambiguous transport"); },
    status: async () => status, finalizedHeight: async () => height,
  };
  return { chain, counts: () => ({ signed, broadcasts }), accept: () => { applied = true; },
    stale: () => { state.revision = "2"; }, expire: () => { height = 11; },
    statusError: () => { status = "error"; } };
}
test("dry-run, exact approval, ambiguous send, durable signature, expiry: never blind re-sign", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sb006-ledger-"));
  try {
    // Synthetic journal and fake chain ONLY; fixture bit unset to exercise the guarded branch.
    const j = journal(); j.fixture = false;
    const fake = fakeChain(j), hash = sha256("test journal"), ledger = join(dir, "submission.json");
    const dry = await commitTraits(j, hash, fake.chain, ledger);
    assert.equal(dry.state, "dry-run"); assert.deepEqual(fake.counts(), { signed: 0, broadcasts: 0 });
    const approval = { action: "evolve_traits", approvedBy: "Tolu", program: PROGRAM_ID, genesis: DEVNET_GENESIS,
      intentHash: dry.intentHash, maximumLamports: 2_000_000, expiresAt: new Date(Date.now() + 60_000).toISOString() };
    await assert.rejects(commitTraits(j, hash, fake.chain, ledger, true, { ...approval, maximumLamports: 1 }), /cost cap/);
    await assert.rejects(commitTraits(j, hash, fake.chain, ledger, true, { ...approval, intentHash: "wrong" }), /mismatched/);
    const originalBroadcast = fake.chain.broadcast;
    fake.chain.broadcast = async s => { const record = JSON.parse(await readFile(ledger, "utf8")); assert.equal(record.signature, s.signature); return originalBroadcast(s); };
    const sent = await commitTraits(j, hash, fake.chain, ledger, true, approval);
    assert.equal(sent.state, "pending"); assert.deepEqual(fake.counts(), { signed: 1, broadcasts: 1 });
    const retry = await commitTraits(j, hash, fake.chain, ledger, true, approval);
    assert.equal(retry.state, "pending"); fake.expire();
    const expired = await commitTraits(j, hash, fake.chain, ledger, true, approval);
    assert.equal(expired.state, "expired-review-required"); assert.deepEqual(fake.counts(), { signed: 1, broadcasts: 1 });
    fake.statusError(); await assert.rejects(commitTraits(j, hash, fake.chain, ledger), /failed/);
    assert.equal(JSON.parse(await readFile(ledger, "utf8")).state, "error");
    await assert.rejects(access(`${ledger}.lock`));
    const stale = fakeChain(j); stale.stale(); await assert.rejects(commitTraits(j, hash, stale.chain, join(dir, "stale.json")), /stale/);
    const confirmed = fakeChain(j); confirmed.accept();
    const other = join(dir, "confirmed.json"); const done = await commitTraits(j, hash, confirmed.chain, other, true, approval);
    assert.equal(done.state, "confirmed");
    await commitTraits(j, hash, confirmed.chain, other); assert.deepEqual(confirmed.counts(), { signed: 1, broadcasts: 1 });
    await writeFile(`${other}.lock`, "test held lock"); await assert.rejects(commitTraits(j, hash, confirmed.chain, other));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
