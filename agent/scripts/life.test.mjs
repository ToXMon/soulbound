// Ticket 015 self-checks. Synthetic private canary never appears in public data.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getAddressEncoder, getBase58Decoder } from "@solana/kit";
import { MemoryStore } from "../dist/memory/store.js";
import { deriveIdentity, discriminator, PROGRAM_ID, DEVNET_GENESIS, HISTORY_SIZE } from "../dist/memory/committer.js";
import { readLife, readProof, readCommitments, coreAttributes, rpcReader } from "../dist/life-read.js";
import { lifeServer } from "../dist/life-server.js";

const ns = { ownerId: "CdvYdEJUk4gxXhz53v7SAKggzfyKx5ho85uRhhvnMKs1", characterId: "895354" };
const asset = "8ra3ckcmgWRhFyWBiCz6KPLM76hugAYhjeEzZCxc8fHU";
const CORE = "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d";
const key = value => Buffer.from(getAddressEncoder().encode(value));
const u32 = n => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
const u64 = n => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
const str = s => Buffer.concat([u32(Buffer.byteLength(s)), Buffer.from(s)]);
const signature = "1".repeat(88);
const account = (owner, b, executable = false) => ({ owner, executable, data: [b.toString("base64"), "base64"] });
function core(config, attrs = [["trait_vector", "current:calm,curious"], ["mood", "curious"], ["life_stage", "born"], ["memory_epoch", "0"]]) {
  const base = Buffer.concat([Buffer.from([1]), key(ns.ownerId), Buffer.from([1]), key(config), str("SOULBOUND Character"), str(""), Buffer.from([0])]);
  const attributes = Buffer.concat([Buffer.from([6]), u32(attrs.length), ...attrs.flatMap(([k, v]) => [str(k), str(v)])]);
  const pluginOffset = base.length + 9, registryOffset = pluginOffset + attributes.length;
  return Buffer.concat([base, Buffer.from([3]), u64(registryOffset), attributes, Buffer.from([4]), u32(1), Buffer.from([6, 2]), u64(pluginOffset), u32(0)]);
}
async function fixture(fn) {
  const root = await mkdtemp(join(tmpdir(), "sb015-"));
  const store = await MemoryStore.open(root, ns);
  try {
    await store.appendExtracted("job-1", [{ type: "event", summary: "PRIVATE_CANARY_015_NEVER_PUBLIC", source_turn_ids: ["private-turn"], confidence: 0.9 }]);
    const manifest = await store.sealEpoch();
    const id = store.records[0].id, identity = await deriveIdentity(ns);
    const config = Buffer.alloc(154);
    discriminator("account", "CharacterConfig").copy(config); key(ns.ownerId).copy(config, 8); u64(ns.characterId).copy(config, 40); key(ns.ownerId).copy(config, 48); key(asset).copy(config, 80); config[153] = identity.configBump;
    const history = Buffer.alloc(HISTORY_SIZE);
    discriminator("account", "MemoryRootHistory").copy(history); key(identity.config).copy(history, 8); history[40] = identity.historyBump;
    history.writeUInt32LE(1, 41); Buffer.from(manifest.root, "hex").copy(history, 53);
    const state = { genesis: DEVNET_GENESIS, config, history: account(PROGRAM_ID, history), core: core(identity.config), transaction: null };
    const instructions = [{ programIdIndex: 3, accounts: [0, 1, 2], data: getBase58Decoder().decode(Buffer.concat([
      discriminator("global", "initialize_character"), u64(ns.characterId), key(ns.ownerId), str("genesis:calm,curious,bold"),
    ])) }];
    state.transaction = { meta: { err: null }, transaction: { message: { accountKeys: [ns.ownerId, identity.config, asset, PROGRAM_ID], instructions } } };
    const rpc = async (method) => {
      if (method === "getGenesisHash") return state.genesis;
      if (method === "getMultipleAccounts") return { context: { slot: 123 }, value: [account("loader", Buffer.alloc(0), true), account(PROGRAM_ID, state.config), state.history] };
      if (method === "getAccountInfo") return { context: { slot: 123 }, value: account(CORE, state.core) };
      if (method === "getSignaturesForAddress") return [{ signature }];
      if (method === "getTransaction") return state.transaction;
      throw new Error("unexpected RPC; reads only");
    };
    const env = { MEMORY_OWNER_ID: ns.ownerId, MEMORY_CHARACTER_ID: ns.characterId, MEMORY_STORE_PATH: root };
    await fn({ root, store, id, identity, state, env, rpc });
  } finally { await store.close(); await rm(root, { recursive: true, force: true }); }
}

test("REQ-51/70: public snapshot is live, allowlisted, private and writer-lock-free", async () => fixture(async ({ store, env, rpc, id }) => {
  const path = join(store.dir, "store.json"), before = await readFile(path);
  const data = await readLife(env, rpc);
  assert.equal(data.chain.stage, "born"); assert.equal(data.chain.slot, 123);
  assert.equal(data.chain.genesisVector, "genesis:calm,curious,bold");
  assert.equal(data.memories[0].id, id); assert.equal(data.memories[0].epoch, 0);
  assert.equal(JSON.stringify(data).includes("PRIVATE_CANARY"), false);
  for (const forbidden of ["summary", "provenance", "private-turn", env.MEMORY_STORE_PATH]) assert.equal(JSON.stringify(data).includes(forbidden), false);
  assert.deepEqual(await readFile(path), before); // live writer still holds its lock
  assert.deepEqual(data.turns, []); assert.deepEqual(data.receipts, []);
}));
test("REQ-51/52: committed epoch zero passes; tampered copy fails; store unchanged", async () => fixture(async ({ store, env, rpc, id }) => {
  const path = join(store.dir, "store.json"), before = await readFile(path);
  const good = await readProof(env, rpc, id), bad = await readProof(env, rpc, id, true);
  assert.equal(good.status, "valid"); assert.equal(bad.status, "invalid");
  assert.notEqual(good.proof.leaf, bad.proof.leaf); assert.equal(good.root, bad.root);
  assert.equal(JSON.stringify(good).includes("PRIVATE_CANARY"), false);
  assert.deepEqual(await readFile(path), before);
}));
test("local seal is not a chain commitment", async () => fixture(async ({ env, rpc, id, state }) => {
  state.history = null;
  assert.equal((await readProof(env, rpc, id)).status, "not-committed");
}));
test("conflicting committed root fails loudly, not valid", async () => fixture(async ({ env, rpc, id, state }) => {
  const b = Buffer.from(state.history.data[0], "base64"); b[53] ^= 1; state.history = account(PROGRAM_ID, b);
  assert.equal((await readProof(env, rpc, id)).status, "invalid");
}));
test("RPC outage/wrong cluster/wrong config do not produce cryptographic verdicts", async () => fixture(async ({ env, rpc, id, state }) => {
  const badRpc = async () => { throw new Error("SECRET_RPC_URL"); };
  assert.equal((await readProof(env, badRpc, id)).status, "unavailable");
  state.genesis = "mainnet"; assert.equal((await readProof(env, rpc, id)).status, "unavailable");
  state.genesis = DEVNET_GENESIS; state.config[8] ^= 1;
  await assert.rejects(() => readCommitments(ns, rpc));
}));
test("corrupt private record cannot leak or yield a valid proof", async () => fixture(async ({ store, env, rpc, id }) => {
  const path = join(store.dir, "store.json");
  const { writeFile } = await import("node:fs/promises");
  const f = JSON.parse(await readFile(path, "utf8")); f.records[0].summary += "changed";
  await writeFile(path, JSON.stringify(f));
  assert.equal((await readProof(env, rpc, id)).status, "unavailable");
  const snapshot = await readLife(env, rpc); assert.equal(snapshot.memoriesUnavailable, true); assert.deepEqual(snapshot.memories, []);
}));
test("unknown memory and path traversal are refused without modifying storage", async () => fixture(async ({ env, rpc }) => {
  assert.equal((await readProof(env, rpc, "../../secret")).status, "not-found");
  assert.equal((await readProof(env, rpc, "00000000-0000-0000-0000-000000000000")).status, "not-found");
}));
test("Core codec checks identity, bounds, duplicates and public attribute allowlist", async () => {
  const i = await deriveIdentity(ns), data = core(i.config);
  assert.equal(coreAttributes(data, ns.ownerId, i.config).length, 4);
  for (const cut of [0, 1, 33, 67, 100, data.length - 12]) assert.throws(() => coreAttributes(data.subarray(0, cut), ns.ownerId, i.config));
  assert.throws(() => coreAttributes(data, asset, i.config));
  assert.throws(() => coreAttributes(core(i.config, [["mood", "a"], ["mood", "b"]]), ns.ownerId, i.config));
  assert.deepEqual(coreAttributes(core(i.config, [["private_summary", "DO_NOT_RENDER"]]), ns.ownerId, i.config), []);
});
test("birth transaction must bind the configured owner, config and asset", async () => fixture(async ({ env, rpc, state }) => {
  state.transaction.transaction.message.accountKeys[2] = ns.ownerId;
  const data = await readLife(env, rpc);
  assert.equal(data.chain.genesisVector, null); assert.equal(data.chain.attributes.length, 4);
}));
test("read service exposes GET only, no CORS, no secrets in unavailable data", async () => {
  const server = lifeServer({}); await new Promise(r => server.listen(0, "127.0.0.1", r));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    assert.equal((await fetch(base + "/life", { method: "POST" })).status, 405);
    const response = await fetch(base + "/life"), data = await response.json();
    assert.equal(response.headers.get("access-control-allow-origin"), null);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(data.chain, null); assert.deepEqual(data.memories, []);
    assert.equal((await fetch(base + "/proof?id=x&tampered=2")).status, 400);
    assert.equal((await fetch(base + "/unknown")).status, 404);
  } finally { await new Promise(r => server.close(r)); }
});
test("LIVE readback and proofs (opt-in, metadata-only output)", { skip: !process.argv.includes("--live") }, async () => {
  const env = process.env;
  const data = await readLife(env, rpcReader(env.MEMORY_COMMIT_RPC_URL ?? "https://api.devnet.solana.com", AbortSignal.timeout(4500)));
  assert.ok(data.chain, "live chain unavailable"); assert.ok(data.chain.attributes.length); assert.ok(data.chain.genesisVector);
  assert.ok(data.memories.length, "no real sealed memory source");
  const id = data.memories[0].id;
  for (const tampered of [false, true]) {
    const result = await readProof(env, rpcReader(env.MEMORY_COMMIT_RPC_URL ?? "https://api.devnet.solana.com", AbortSignal.timeout(1400)), id, tampered);
    assert.equal(result.status, tampered ? "invalid" : "valid");
    assert.ok(result.elapsedMs < 2000);
    console.log(JSON.stringify({ kind: "live-proof", status: result.status, elapsedMs: result.elapsedMs, slot: result.slot }));
  }
  console.log(JSON.stringify({ kind: "live-life", stage: data.chain.stage, attributeCount: data.chain.attributes.length,
    genesisMatched: data.chain.genesisVector === data.chain.attributes.find(a => a.key === "trait_vector")?.value, publicMemoryCount: data.memories.length }));
});
