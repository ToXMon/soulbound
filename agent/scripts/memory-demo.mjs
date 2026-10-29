#!/usr/bin/env node
// Ticket 004 memory demo. Two modes:
//   --offline  OFFLINE FIXTURE: deterministic fake extractor, NOT live inference.
//   --live     Real non-contributor Spark structured extraction (synthetic facts only).
// Report contains counts, opaque ids, root and verification only — never summaries/inputs.
import { readdir } from "node:fs/promises";
import { MemoryStore } from "../dist/memory/store.js";
import { MemoryQueue } from "../dist/memory/queue.js";
import { SparkExtractor } from "../dist/memory/extract.js";
import { verifyProof } from "../dist/memory/merkle.js";

const args = process.argv.slice(2);
const mode = args.includes("--live") ? "live" : args.includes("--offline") ? "offline" : null;
const storePath = args[args.indexOf("--store") + 1];
const reopen = args.includes("--reopen");
if (!mode || !storePath || args.indexOf("--store") < 0) {
  console.error("usage: memory-demo.mjs --offline|--live --store <dir> [--reopen]");
  process.exit(2);
}
try {
  const entries = await readdir(storePath).catch(() => []);
  // Safety: never delete or silently reuse an operator store.
  if (entries.length > 0 && !reopen) { console.error(`refusing existing nonempty store: ${storePath} (pass --reopen to reuse)`); process.exit(2); }
} catch { /* fresh path */ }

const ns = {
  ownerId: process.env.MEMORY_OWNER_ID || "demo-owner-public-key",
  characterId: process.env.MEMORY_CHARACTER_ID || "demo-character",
};
// Synthetic public fixture (no personal content).
const turns = [
  { id: "demo-session:1", speakerKind: "owner", userText: "Please remember: my favourite colour is teal.", replyText: "I will remember that your favourite colour is teal." },
  { id: "demo-session:2", speakerKind: "owner", userText: "I walked by the sea this morning.", replyText: "That sounds lovely." },
  { id: "demo-session:3", speakerKind: "owner", userText: "Actually, correction: my favourite colour is blue now, not teal.", replyText: "Understood, blue it is." },
];

// OFFLINE FIXTURE extractor — deterministic rules, clearly not inference.
const offlineExtractor = {
  async extract(ts, prior) {
    const t = ts[0];
    if (/actually|correction/i.test(t.userText)) {
      const target = prior.find((p) => /colour/i.test(p.summary));
      return [{ type: "correction", summary: "Favourite colour is blue (corrected).", confidence: 0.95, source_turn_ids: [t.id], ...(target ? { supersedes: target.id } : {}) }];
    }
    if (/colour/i.test(t.userText)) return [{ type: "fact", summary: "Favourite colour is teal.", confidence: 0.9, source_turn_ids: [t.id] }];
    return [{ type: "event", summary: "Walked by the sea.", confidence: 0.8, source_turn_ids: [t.id] }];
  },
};

const store = await MemoryStore.open(storePath, ns);
const extractor = mode === "live" ? new SparkExtractor() : offlineExtractor;
const queue = new MemoryQueue(store, extractor, { timeoutMs: 60_000 });
turns.forEach((t, i) => queue.enqueue({ key: `demo:${t.id}:${i}`, turns: [t] }));
const drained = await queue.flush(120_000);
const manifest = await store.sealEpoch();
let proofOk = false, tamperOk = false;
if (manifest && store.records.length) {
  const { proof } = store.proofFor(store.records[0].id);
  proofOk = verifyProof(manifest.root, proof);
  tamperOk = !store.verifyRecord({ ...store.records[0], summary: "tampered" });
}
await store.close(); // release the single-writer lock before reopening
const reopened = await MemoryStore.open(storePath, ns);
console.log(JSON.stringify({
  mode: mode === "live" ? "live" : "offline-fixture",
  model: mode === "live" ? (process.env.MODEL_NAME || "muse-spark-1.3") : "none (fake extractor)",
  drained, queue: queue.getStats(),
  records: reopened.records.length,
  versions: reopened.records.map((r) => r.version),
  epoch: manifest?.epoch ?? null,
  root: manifest?.root ?? null,
  proofVerified: proofOk,
  tamperRejected: tamperOk,
  persistedAcrossReopen: reopened.records.length === store.records.length,
}, null, 2));
if (!drained || !manifest || !proofOk || !tamperOk) process.exit(1);
