import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { MemoryStore } from "../dist/memory/store.js";
import { PROGRAM_ID, DEVNET_GENESIS, HISTORY_SIZE, decimalU64, rootBytes, deriveIdentity, prepareIntent, commitMemoryRoot, discriminator } from "../dist/memory/committer.js";
import { rotateRuntimeSigner, validateRotationApproval } from "../dist/memory/runtime-rotation.js";
import { SolanaChain, commitInstruction, rotationInstruction } from "../dist/memory/committer-solana.js";
import { getAddressEncoder } from "@solana/kit";
const OWNER = "CdvYdEJUk4gxXhz53v7SAKggzfyKx5ho85uRhhvnMKs1";
const ns = { ownerId: OWNER, characterId: "895354" };
const SIG = "2".repeat(88);
const OLD_RUNTIME = "f97njkTdcbBrHL9vwFCLBHHURhB78YavqQRJGL2xktt";
async function rotationFixture(t) {
  const dir = await mkdtemp(join(tmpdir(), "sb-005-rotation-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const identity = await deriveIdentity(ns);
  const intent = { owner: OWNER, characterId: ns.characterId, config: identity.config, history: identity.history, expectedRuntime: OLD_RUNTIME, replacement: PROGRAM_ID, payer: OWNER };
  const state = { genesis: DEVNET_GENESIS, program: PROGRAM_ID, executable: true, owner: OWNER, characterId: ns.characterId, runtime: OLD_RUNTIME, entries: [] };
  const calls = { sign: 0, broadcast: 0, simulate: 0 };
  const chain = {
    async inspect() { return structuredClone(state); },
    async simulateRotation() { calls.simulate++; return { units: 10000, feeLamports: 10000, balanceLamports: 100000, maximumHistoryRentLamports: 0 }; },
    async signRotation() { calls.sign++; return { signature: SIG, lastValidBlockHeight: 100, wire: "offline-fixture-not-a-transaction" }; },
    async broadcast() { calls.broadcast++; state.runtime = intent.replacement; },
    async status() { return "absent"; }, async finalizedHeight() { return 99; },
  };
  const approval = { ...intent, action: "rotate_runtime_signer", program: PROGRAM_ID, genesis: DEVNET_GENESIS, approvedBy: "Tolu", expiresAt: new Date(Date.now() + 60000).toISOString(), maximumLamports: 10000 };
  return { intent, state, calls, chain, approval, journal: join(dir, "private", "rotation.json") };
}
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), "sb-005-"));
  const store = await MemoryStore.open(join(dir, "store"), ns);
  t.after(async () => { await store.close(); await rm(dir, { recursive: true, force: true }); });
  await store.appendExtracted("fixture:1", [{ type: "fact", summary: "Offline fixture only.", confidence: 0.8, source_turn_ids: ["fixture:1"] }]);
  await store.sealEpoch();
  return { store, intent: await prepareIntent(store, "0", OWNER, OWNER), journal: join(dir, "journal", "submissions.json") };
}
function mock(intent, overrides = {}) {
  const state = { genesis: DEVNET_GENESIS, program: PROGRAM_ID, executable: true, owner: OWNER, characterId: ns.characterId, runtime: OWNER, entries: [] };
  const calls = { inspect: 0, sign: 0, broadcast: 0, simulate: 0, status: 0 };
  const chain = {
    async inspect() { calls.inspect++; return structuredClone(state); },
    async simulate() { calls.simulate++; return { units: 13000 }; },
    async sign() { calls.sign++; return { signature: SIG, lastValidBlockHeight: 100, wire: "not-a-real-transaction" }; },
    async broadcast() { calls.broadcast++; state.entries.push({ epoch: intent.epoch, root: intent.root }); },
    async status() { calls.status++; return "absent"; },
    async finalizedHeight() { return 99; }, ...overrides,
  };
  return { chain, state, calls };
}
test("canonical u64, exact hex decode, preserved config/history derivation and actual IDL instruction", async () => {
  for (const id of ["char-elder", "01", "-1", "18446744073709551616", "1.0"]) assert.throws(() => decimalU64(id));
  assert.equal(decimalU64("18446744073709551615"), 18446744073709551615n);
  for (const root of ["0".repeat(64), "a".repeat(63), "g".repeat(64), "ab".repeat(33)]) assert.throws(() => rootBytes(root));
  assert.deepEqual(rootBytes("ab".repeat(32)), Buffer.alloc(32, 0xab));
  const identity = await deriveIdentity(ns);
  assert.equal(identity.config, "74dRYy2RARkhQs963QcGZdVXhfjABm2BGC7WFwSd7Ehc");
  const idl = JSON.parse(await readFile(new URL("../../programs/soulbound/idl/soulbound.json", import.meta.url), "utf8"));
  const ix = commitInstruction({ ...identity, owner: OWNER, characterId: "895354", runtime: OWNER, payer: OWNER, epoch: "0", root: "ab".repeat(32) });
  assert.deepEqual([...ix.data.subarray(0, 8)], idl.instructions.find((i) => i.name === "commit_memory_root").discriminator);
  assert.deepEqual(ix.data.subarray(16), Buffer.alloc(32, 0xab));
  assert.equal(ix.accounts[3].address, identity.history);
  assert.equal(identity.history, "BVF8KRRGK6CV55GaQd4KdJFhYtrKX1GekFdoVpn1AY6p");
  assert.deepEqual([...discriminator("account", "MemoryRootHistory")], idl.accounts.find((a) => a.name === "MemoryRootHistory").discriminator);
});
test("validated sealed manifest consumed; empty/unsealed and changed record bytes refused", async (t) => {
  const { store } = await fixture(t);
  await assert.rejects(() => prepareIntent(store, "1", OWNER, OWNER), /unsealed/);
  const r = store.records[0]; const saved = r.summary; r.summary = "tamper";
  await assert.rejects(() => prepareIntent(store, "0", OWNER, OWNER), /validation/);
  r.summary = saved;
  const manifest = store.manifests[0]; const id = manifest.record_ids[0]; manifest.record_ids[0] = "foreign";
  await assert.rejects(() => prepareIntent(store, "0", OWNER, OWNER), /manifest/); manifest.record_ids[0] = id;
});
test("dry-run default simulates, never signs/sends; private journal permissions", async (t) => {
  const f = await fixture(t), m = mock(f.intent);
  assert.equal((await commitMemoryRoot(f.intent, m.chain, f.journal)).state, "dry-run");
  assert.equal(m.calls.simulate, 1); assert.equal(m.calls.sign, 0); assert.equal(m.calls.broadcast, 0);
  assert.equal((await stat(f.journal)).mode & 0o777, 0o600);
  assert.equal((await stat(join(f.journal, ".."))).mode & 0o777, 0o700);
  assert.doesNotMatch(await readFile(f.journal, "utf8"), /Offline fixture/);
});
test("wrong cluster, identity, signer, program and PDA refused before signing", async (t) => {
  const f = await fixture(t);
  for (const fields of [{ genesis: "mainnet" }, { owner: PROGRAM_ID }, { characterId: "7" }, { runtime: PROGRAM_ID }, { executable: false }, { program: OWNER }]) {
    const m = mock(f.intent); Object.assign(m.state, fields);
    await assert.rejects(() => commitMemoryRoot(f.intent, m.chain, f.journal)); assert.equal(m.calls.sign, 0);
  }
  await assert.rejects(() => commitMemoryRoot({ ...f.intent, config: OWNER }, mock(f.intent).chain, f.journal), /PDA/);
});
test("signature persisted BEFORE send; restart reconciles same root without resend", async (t) => {
  const f = await fixture(t), m = mock(f.intent);
  const broadcast = m.chain.broadcast;
  m.chain.broadcast = async (s) => {
    const disk = JSON.parse(await readFile(f.journal, "utf8"));
    assert.equal(Object.values(disk.entries)[0].signature, SIG);
    assert.equal(Object.values(disk.entries)[0].state, "pending");
    await broadcast(s);
  };
  assert.equal((await commitMemoryRoot(f.intent, m.chain, f.journal, true)).state, "confirmed");
  m.state.entries.push({ epoch: "10", root: "bb".repeat(32) });
  const result = await commitMemoryRoot(f.intent, m.chain, f.journal, true);
  assert.equal(result.reconciled, true); assert.equal(m.calls.broadcast, 1);
  const altered = { ...f.intent, root: "cc".repeat(32) };
  await assert.rejects(() => commitMemoryRoot(altered, m.chain, f.journal, true), /conflict/);
});
test("same epoch different root conflicts, including earlier journals when chain advances", async (t) => {
  const f = await fixture(t), m = mock(f.intent);
  await commitMemoryRoot(f.intent, m.chain, f.journal, true);
  m.state.entries[0].root = "dd".repeat(32);
  m.state.entries.push({ epoch: "10", root: "ee".repeat(32) });
  await assert.rejects(() => commitMemoryRoot({ ...f.intent, epoch: "11" }, m.chain, f.journal, true), /conflict/);
  assert.equal(m.calls.broadcast, 1);
});
test("ambiguous send accepted on chain reconciles; timeout with no readback stays pending", async (t) => {
  const f = await fixture(t), m = mock(f.intent);
  m.chain.broadcast = async () => { m.calls.broadcast++; m.state.entries.push({ epoch: "0", root: f.intent.root }); throw new Error("timeout"); };
  assert.equal((await commitMemoryRoot(f.intent, m.chain, f.journal, true)).state, "confirmed");
  const g = await fixture(t), n = mock(g.intent);
  n.chain.broadcast = async () => { n.calls.broadcast++; throw new Error("timeout"); };
  assert.equal((await commitMemoryRoot(g.intent, n.chain, g.journal, true)).state, "pending");
  assert.equal((await commitMemoryRoot(g.intent, n.chain, g.journal, true)).state, "pending");
  assert.equal(n.calls.sign, 1); assert.equal(n.calls.broadcast, 1);
  n.chain.status = async () => "confirmed";
  assert.equal((await commitMemoryRoot(g.intent, n.chain, g.journal, true)).state, "pending");
  assert.equal(n.calls.sign, 1); // signature confirmation is NOT root readback
  n.chain.finalizedHeight = async () => 101;
  n.chain.status = async () => "pending";
  assert.equal((await commitMemoryRoot(g.intent, n.chain, g.journal, true)).state, "pending"); assert.equal(n.calls.sign, 1);
  n.chain.status = async () => "absent";
  assert.equal((await commitMemoryRoot(g.intent, n.chain, g.journal)).state, "dry-run"); assert.equal(n.calls.sign, 1);
  await commitMemoryRoot(g.intent, n.chain, g.journal, true); assert.equal(n.calls.sign, 2);
});
test("failed signature never becomes success; RPC ambiguity preserves pending journal", async (t) => {
  const f = await fixture(t), m = mock(f.intent);
  m.chain.broadcast = async () => { m.calls.broadcast++; };
  m.chain.status = async () => "error";
  await assert.rejects(() => commitMemoryRoot(f.intent, m.chain, f.journal, true), /failed/);
  assert.equal(Object.values(JSON.parse(await readFile(f.journal, "utf8")).entries)[0].state, "error");
  await assert.rejects(() => commitMemoryRoot(f.intent, m.chain, f.journal, true), /failed/);
  assert.equal(m.calls.sign, 1);
  m.chain.status = async () => "absent"; m.chain.finalizedHeight = async () => 101;
  await assert.rejects(() => commitMemoryRoot(f.intent, m.chain, f.journal, true), /failed/);
  assert.equal(m.calls.sign, 1); // purged RPC status does not clear a known failed journal
  const g = await fixture(t), n = mock(g.intent);
  n.chain.broadcast = async () => { throw new Error("timeout"); };
  const inspect = n.chain.inspect;
  n.chain.inspect = async () => { if (n.calls.inspect) throw new Error("RPC outage"); return inspect(); };
  await assert.rejects(() => commitMemoryRoot(g.intent, n.chain, g.journal, true), /outage/);
  assert.equal(Object.values(JSON.parse(await readFile(g.journal, "utf8")).entries)[0].state, "pending");
  n.chain.inspect = inspect;
  assert.equal((await commitMemoryRoot(g.intent, n.chain, g.journal, true)).state, "pending");
  assert.equal(n.calls.sign, 1);
});
test("journal lock serializes concurrent invocations; corruption fails closed", async (t) => {
  const f = await fixture(t), m = mock(f.intent);
  let release, entered;
  const waiting = new Promise((r) => { entered = r; });
  m.chain.simulate = async () => { entered(); await new Promise((r) => { release = r; }); };
  const first = commitMemoryRoot(f.intent, m.chain, f.journal);
  await waiting;
  await assert.rejects(() => commitMemoryRoot(f.intent, m.chain, f.journal), { code: "EEXIST" });
  release(); await first;
  await writeFile(f.journal, "{corrupt");
  await assert.rejects(() => commitMemoryRoot(f.intent, m.chain, f.journal)); assert.equal(m.calls.sign, 0);
});
test("actual adapter decodes config/history and refuses corrupt association", async (t) => {
  const f = await fixture(t), identity = await deriveIdentity(ns);
  const encode = (s) => Buffer.from(getAddressEncoder().encode(s));
  const data = Buffer.alloc(154); discriminator("account", "CharacterConfig").copy(data);
  encode(OWNER).copy(data, 8); data.writeBigUInt64LE(895354n, 40); encode(OWNER).copy(data, 48); data[153] = identity.configBump;
  const history = Buffer.alloc(HISTORY_SIZE); discriminator("account", "MemoryRootHistory").copy(history);
  encode(identity.config).copy(history, 8); history[40] = identity.historyBump; history.writeUInt32LE(1, 41); rootBytes(f.intent.root).copy(history, 53);
  const account = (bytes) => ({ owner: PROGRAM_ID, executable: false, data: [bytes.toString("base64"), "base64"] });
  const chain = new SolanaChain("https://api.devnet.solana.com");
  chain.rpc = async (method) => method === "getGenesisHash" ? DEVNET_GENESIS : { value: [{ executable: true }, account(data), account(history), { owner: "11111111111111111111111111111111", executable: false, data: ["", "base64"] }] };
  assert.deepEqual((await chain.inspect(f.intent)).entries, [{ epoch: "0", root: f.intent.root }]);
  history[8] ^= 1;
  await assert.rejects(() => chain.inspect(f.intent), /binding/);
});
test("RPC transport retries reads only, sanitizes failures and bounds attempts", async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error("secret-provider-url"); };
  const chain = new SolanaChain("https://api.devnet.solana.com");
  await assert.rejects(() => chain.rpc("getGenesisHash"), /bounded attempts/);
  assert.equal(calls, 3);
  await assert.rejects(() => chain.broadcast({ signature: SIG, wire: "fixture", lastValidBlockHeight: 100 }), /sendTransaction failed/);
  assert.equal(calls, 4); // never retry send
});
test("RPC outage has no voice integration; CLI missing settings fails visibly and help documents flags", async () => {
  const source = await readFile(new URL("../src/index.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /committer|commit-memory-root/);
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("MEMORY_")));
  const cli = new URL("./commit-memory-root.mjs", import.meta.url).pathname;
  const result = spawnSync(process.execPath, [cli, "--epoch", "0", "--dry-run"], { env, encoding: "utf8" });
  assert.equal(result.status, 1); assert.match(result.stderr, /missing setting MEMORY_OWNER_ID/);
  const help = spawnSync(process.execPath, [cli, "--help"], { env, encoding: "utf8" });
  assert.equal(help.status, 0); assert.match(help.stdout, /--send --approval/);
});

test("rotation: IDL-compatible dual-signature instruction, no writable asset/history accounts", async (t) => {
  const f = await rotationFixture(t);
  const instruction = rotationInstruction(f.intent);
  const idl = JSON.parse(await readFile(new URL("../../programs/soulbound/idl/soulbound.json", import.meta.url), "utf8"));
  assert.deepEqual([...instruction.data], idl.instructions.find((i) => i.name === "rotate_runtime_signer").discriminator);
  assert.equal(instruction.accounts.length, 3);
  assert.deepEqual(instruction.accounts.map((a) => a.role), [1, 2, 2]); // writable, readonly signer, readonly signer
  assert.equal(instruction.accounts[1].address, OWNER);
  assert.equal(instruction.accounts[2].address, f.intent.replacement);
  assert.deepEqual([...discriminator("event", "RuntimeSignerRotated")], idl.events.find((e) => e.name === "RuntimeSignerRotated").discriminator);
});
test("rotation: dry-run never signs or broadcasts; no-op, wrong identity/cluster/runtime refused", async (t) => {
  const f = await rotationFixture(t);
  assert.equal((await rotateRuntimeSigner(f.intent, f.chain, f.journal)).state, "dry-run");
  assert.deepEqual(f.calls, { sign: 0, broadcast: 0, simulate: 1 });
  await assert.rejects(() => rotateRuntimeSigner({ ...f.intent, replacement: OLD_RUNTIME }, f.chain, f.journal), /no-op/);
  await assert.rejects(() => rotateRuntimeSigner({ ...f.intent, config: OWNER }, f.chain, f.journal), /PDA/);
  const initial = structuredClone(f.state);
  for (const fields of [{ genesis: "mainnet" }, { owner: PROGRAM_ID }, { characterId: "7" }, { executable: false }, { program: OWNER }, { runtime: OWNER }]) {
    Object.assign(f.state, initial, fields);
    await assert.rejects(() => rotateRuntimeSigner(f.intent, f.chain, f.journal));
  }
  assert.equal(f.calls.sign, 0);
});
test("rotation: approval is action/identity/cost/expiry bound, never implicit", async (t) => {
  const f = await rotationFixture(t);
  assert.throws(() => validateRotationApproval(f.intent), /approval/);
  for (const changes of [{ action: "commit_memory_root" }, { replacement: OWNER }, { expectedRuntime: OWNER }, { maximumLamports: 0 }, { expiresAt: "2000-01-01" }, { genesis: "mainnet" }]) {
    assert.throws(() => validateRotationApproval(f.intent, { ...f.approval, ...changes }));
  }
  assert.throws(() => validateRotationApproval(f.intent, f.approval, 10001), /cap/);
  await assert.rejects(() => rotateRuntimeSigner(f.intent, f.chain, f.journal, true), /approval/);
  await assert.rejects(() => rotateRuntimeSigner(f.intent, f.chain, f.journal, true, { ...f.approval, maximumLamports: 9999 }), /cap/);
  assert.equal(f.calls.sign, 0);
});
test("rotation: signature durable before send, restart reconciles current signer without resend", async (t) => {
  const f = await rotationFixture(t), broadcast = f.chain.broadcast;
  f.chain.broadcast = async (submission) => {
    const journal = JSON.parse(await readFile(f.journal, "utf8"));
    assert.equal(journal.signature, SIG); assert.equal(journal.state, "pending");
    assert.equal((await stat(f.journal)).mode & 0o777, 0o600);
    assert.equal((await stat(join(f.journal, ".."))).mode & 0o777, 0o700);
    await broadcast(submission);
  };
  assert.equal((await rotateRuntimeSigner(f.intent, f.chain, f.journal, true, f.approval)).state, "confirmed");
  assert.equal((await rotateRuntimeSigner(f.intent, { ...f.chain }, f.journal)).reconciled, true);
  assert.deepEqual(f.calls, { sign: 1, broadcast: 1, simulate: 1 });
  await assert.rejects(() => rotateRuntimeSigner({ ...f.intent, expectedRuntime: OWNER }, f.chain, f.journal), /conflict/);
});
test("rotation: ambiguous send stays pending, confirmation alone never proves readback, expiry checked before retry", async (t) => {
  const f = await rotationFixture(t);
  f.chain.broadcast = async () => { f.calls.broadcast++; throw new Error("timeout"); };
  assert.equal((await rotateRuntimeSigner(f.intent, f.chain, f.journal, true, f.approval)).state, "pending");
  f.chain.status = async () => "confirmed";
  f.chain.finalizedHeight = async () => 101;
  assert.equal((await rotateRuntimeSigner(f.intent, f.chain, f.journal, true, f.approval)).state, "pending");
  assert.equal(f.calls.sign, 1);
  f.chain.status = async () => "absent";
  assert.equal((await rotateRuntimeSigner(f.intent, f.chain, f.journal)).state, "dry-run");
  assert.equal(f.calls.sign, 1);
  f.chain.broadcast = async () => { f.calls.broadcast++; f.state.runtime = f.intent.replacement; throw new Error("timeout after accepted"); };
  assert.equal((await rotateRuntimeSigner(f.intent, f.chain, f.journal, true, f.approval)).state, "confirmed");
  assert.equal(f.calls.sign, 2);
});
test("rotation: failed send and corrupt journal stop without signing again", async (t) => {
  const f = await rotationFixture(t);
  f.chain.broadcast = async () => { f.calls.broadcast++; };
  f.chain.status = async () => "error";
  await assert.rejects(() => rotateRuntimeSigner(f.intent, f.chain, f.journal, true, f.approval), /failed/);
  await assert.rejects(() => rotateRuntimeSigner(f.intent, f.chain, f.journal, true, f.approval), /failed/);
  assert.equal(f.calls.sign, 1);
  f.chain.status = async () => "absent"; f.chain.finalizedHeight = async () => 101;
  await assert.rejects(() => rotateRuntimeSigner(f.intent, f.chain, f.journal, true, f.approval), /failed/);
  assert.equal(f.calls.sign, 1);
  await writeFile(f.journal, "{corrupt");
  await assert.rejects(() => rotateRuntimeSigner(f.intent, f.chain, f.journal));
  assert.equal(f.calls.sign, 1);
});
test("rotation adapter: unsigned simulation estimates fee with zero allocation rent, without opening keys", async (t) => {
  const f = await rotationFixture(t);
  const chain = new SolanaChain("https://api.devnet.solana.com", "/missing-runtime-key", "/missing-payer-key");
  const methods = [];
  chain.rpc = async (method, params) => {
    methods.push(method);
    if (method === "getLatestBlockhash") return { value: { blockhash: "11111111111111111111111111111111", lastValidBlockHeight: 100 } };
    if (method === "simulateTransaction") {
      assert.equal(params[1].sigVerify, false); assert.equal(params[1].replaceRecentBlockhash, true);
      assert.equal(typeof params[0], "string"); return { value: { err: null, unitsConsumed: 10000 } };
    }
    if (method === "getBalance") return { value: 100000 };
    if (method === "getFeeForMessage") return { value: 10000 };
    throw new Error(`unexpected RPC ${method}`);
  };
  const estimate = await chain.simulateRotation(f.intent);
  assert.equal(estimate.maximumHistoryRentLamports, 0); assert.equal(estimate.feeLamports, 10000);
  assert.deepEqual(methods, ["getLatestBlockhash", "simulateTransaction", "getBalance", "getFeeForMessage"]);
});
test("rotation CLI: explicit command, documented Mac-only signing, no settings or keys created by help/dry-run", () => {
  const cli = new URL("./rotate-runtime-signer.mjs", import.meta.url).pathname;
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("MEMORY_")));
  const help = spawnSync(process.execPath, [cli, "--help"], { env, encoding: "utf8" });
  assert.equal(help.status, 0); assert.match(help.stdout, /Mac-only/); assert.match(help.stdout, /dual-signature/);
  const missing = spawnSync(process.execPath, [cli, "--dry-run"], { env, encoding: "utf8" });
  assert.equal(missing.status, 1); assert.match(missing.stderr, /missing setting/);
});
