#!/usr/bin/env node
// Cron-invocable, operator-only. Never imported by the live voice worker.
import { parseArgs } from "node:util";
import { readFile, access, open, rm, lstat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { namespaceDirName, validateStoreFile } from "../dist/memory/store.js";
import { validateRecord } from "../dist/memory/schema.js";
import { contentHash } from "../dist/memory/merkle.js";
import { DreamChain, PROGRAM_ID, DEVNET_GENESIS, sha256, type Snapshot } from "./chain.ts";
import { dreamModels, CONSOLIDATION_MODEL, type DreamMemory } from "./consolidator.ts";
import { WONDER_MODEL } from "./wonder-prompt.ts";
import { applyChanges, writeJournal, readJournal, privateDirectory, commitTraits, type DreamJournal } from "./journal.ts";

// 004 persists by atomic rename: a read-only file snapshot is coherent even while
// the voice worker holds its lifetime writer lock. Reuse its authoritative validators.
export async function readMemoryGraph(root: string, ns: { ownerId: string; characterId: string }): Promise<DreamMemory[]> {
  const path = join(root, namespaceDirName(ns), "store.json");
  const info = await lstat(path);
  if (!info.isFile() || (info.mode & 0o077) || info.size > 2_000_000) throw new Error("memory snapshot must be bounded private regular file");
  const file = JSON.parse(await readFile(path, "utf8"));
  if (file.schema_version !== 1 || file.owner_id !== ns.ownerId || file.character_id !== ns.characterId ||
      !Array.isArray(file.records) || !file.records.length || file.records.length > 200 || !Array.isArray(file.manifests) ||
      !Array.isArray(file.processed_jobs) || !Number.isInteger(file.next_epoch)) throw new Error("invalid/empty/oversized memory snapshot");
  for (const r of file.records) {
    validateRecord(r, ns.characterId);
    if (contentHash(r) !== r.content_hash) throw new Error("memory snapshot content hash mismatch");
  }
  validateStoreFile(file, ns);
  return file.records.map((m: DreamMemory) => ({ id: m.id, content_hash: m.content_hash, summary: m.summary, timestamp: m.timestamp,
    ...(m.supersedes ? { supersedes: m.supersedes } : {}) }));
}

export async function main(args = process.argv.slice(2)) {
  const { values: v } = parseArgs({ args, strict: true, allowPositionals: false, options: {
    character: { type: "string", default: "genesis" }, out: { type: "string" },
    fixture: { type: "string" }, "live-models": { type: "boolean" }, journal: { type: "string" },
    ledger: { type: "string" }, send: { type: "boolean" }, "dry-run": { type: "boolean" },
    approval: { type: "string" }, help: { type: "boolean" },
  } });
  if (v.help) {
    console.log("run-once.ts --character genesis --out JOURNAL [--fixture FILE | --live-models]\nReconcile/simulate: --journal JOURNAL --ledger LEDGER [--send --approval PRIVATE_JSON]\nDefault: labeled offline fixtures; no model calls or RPC. See docs/dreams.md."); return;
  }
  if (v.send && (v["dry-run"] || !v.journal || !v.approval)) throw new Error("--send requires existing --journal and --approval; cannot combine with --dry-run");
  if (v.fixture && v["live-models"]) throw new Error("fixture and live models are mutually exclusive");
  const setting = (key: string) => { const s = process.env[key]; if (!s) throw new Error(`missing setting ${key}`); return s; };
  const chain = () => new DreamChain(setting("MEMORY_COMMIT_RPC_URL"));
  if (v.journal) {
    if (v.out || v.fixture || v["live-models"] || !v.ledger) throw new Error("submission requires --journal and --ledger only (plus send/approval flags)");
    const { journal, hash } = await readJournal(v.journal);
    const approval = v.approval ? JSON.parse(await readFile(v.approval, "utf8")) : undefined;
    const result = await commitTraits(journal, hash, chain(), v.ledger, !!v.send, approval);
    console.log(JSON.stringify(result));
    if (["pending", "expired-review-required"].includes(result.state)) process.exitCode = 2;
    return result;
  }
  if (!v.out || v.ledger || v.approval || v.send) throw new Error("journal generation requires --out, without submission flags");
  const fixture = !v["live-models"];
  let snapshot: Snapshot, memories: DreamMemory[], output;
  // Lock the output throughout inference: a second cron invocation cannot race the same scheduled slot.
  if (fixture) { await import("node:fs/promises").then(fs => fs.mkdir(dirname(v.out!), { recursive: true })); }
  else await privateDirectory(dirname(v.out));
  const lock = await open(`${v.out}.lock`, "wx", 0o600);
  try {
    await lock.writeFile(JSON.stringify({ pid: process.pid })); await lock.sync();
    try { await access(v.out); throw new Error("dream journal already exists; use --journal to reconcile, never overwrite"); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
    if (fixture) {
      if (v.character !== "genesis") throw new Error("built-in fixture is genesis-only");
      const path = v.fixture ?? fileURLToPath(new URL("./fixtures/recorded.json", import.meta.url));
      const recorded = JSON.parse(await readFile(path, "utf8"));
      if (recorded.fixture !== true) throw new Error("fixture must be explicitly labeled");
      snapshot = recorded.snapshot; memories = recorded.memories;
      output = { consolidation: recorded.consolidation, review: recorded.review };
    } else {
      const ns = { ownerId: setting("MEMORY_OWNER_ID"), characterId: v.character === "genesis" ? "895354" : v.character! };
      if (ns.characterId !== setting("MEMORY_CHARACTER_ID")) throw new Error("requested character must match explicit memory namespace");
      snapshot = await chain().snapshot(ns, setting("MEMORY_COMMIT_RUNTIME_PUBLIC_KEY"), setting("MEMORY_COMMIT_FEE_PAYER"));
      const root = setting("MEMORY_STORE_PATH");
      memories = await readMemoryGraph(root, ns); // never create, lock, or modify the voice store
      // ponytail: bounded full-graph input; add hierarchical batching above 200 memories/150KB, never silently truncate.
      if (!memories.length || memories.length > 200 || Buffer.byteLength(JSON.stringify(memories)) > 150_000) throw new Error("dream graph empty or exceeds bounded input; batching requires a separate ticket");
      output = await dreamModels(memories, snapshot.attributes);
    }
    const journal: DreamJournal = { schema_version: 1, fixture, created_at: new Date().toISOString(), program: PROGRAM_ID, genesis: DEVNET_GENESIS,
      snapshot, memories, models: { consolidation: CONSOLIDATION_MODEL, review: WONDER_MODEL }, ...output,
      new_attributes: applyChanges(snapshot, output.review) };
    const hash = await writeJournal(v.out, journal);
    const result = { state: fixture ? "fixture-journal-written" : "journal-written-offchain", fixture, journalHash: hash,
      memoryReferences: memories.length, proposalHash: sha256(JSON.stringify(journal.new_attributes)) };
    console.log(JSON.stringify(result)); return result;
  } finally { await lock.close(); await rm(`${v.out}.lock`, { force: true }); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => { console.error("[dream] operation failed; no secrets/provider bodies printed. Check flags, private paths, namespace, locks and model credentials; see docs/dreams.md."); process.exitCode = 1; });
}
