#!/usr/bin/env node
// Ticket 006 operational executor: fixed approved seeded-buffer schedule ONLY.
// No key generation; no authority rotation; no funding another wallet; no trait send.
import { readFile, open, rename, lstat, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
import assert from "node:assert/strict";
import { address, AccountRole as R, getAddressEncoder, createAddressWithSeed,
  createTransactionMessage, setTransactionMessageFeePayer, setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstructions, compileTransaction, getBase64EncodedWireTransaction,
  createKeyPairSignerFromBytes, signTransaction, getSignatureFromTransaction, blockhash } from "@solana/kit";
import { DreamChain, PROGRAM_ID, DEVNET_GENESIS, SYSTEM_ID, sha256, u32, u64 } from "./chain.ts";
import { privateDirectory } from "./journal.ts";
const LOADER = "BPFLoaderUpgradeab1e11111111111111111111111";
const OWNER = "CdvYdEJUk4gxXhz53v7SAKggzfyKx5ho85uRhhvnMKs1";
const DATA = "6YtN1z61nFydyyyqYTnP85VVFtkDhkM9baHe8HiN6TbD";
const HASH = "51997587fb67648b65ce0610b757d7988f30dcabd85c3c3332c82b1d9ddf8153";
const OLD_HASH = "15eef67ee87b8d87ffe669d3178c1d0319d458eea2ead3c59b3b04cc95b43d77";
const BUFFER = "FVTTXr9ffd9LBUaQDP8srecaeUZqppjfQQfCcqhAFLDf";
const SEED = "sb006-51997587fb67648b65ce0610b7";
const RENT = 1479809080, EXTEND_RENT = 323047360, FEES = 1635000, PEAK = 1804491440;
const addr = (v: string) => Buffer.from(getAddressEncoder().encode(address(v)));
const meta = (key: string, role: R) => ({ address: address(key), role });
const instruction = (data: Uint8Array, accounts: ReturnType<typeof meta>[], program = LOADER) => ({ programAddress: address(program), accounts, data });
export function upgradeInstructions(binary: Buffer) {
  assert.equal(binary.length, 291136); assert.equal(sha256(binary), HASH);
  const seed = Buffer.from(SEED);
  // System CreateAccountWithSeed: bincode enum u32, base, string(u64 len), lamports, space, owner.
  const create = instruction(Buffer.concat([u32(3), addr(OWNER), u64(String(seed.length)), seed,
    u64(String(RENT)), u64(String(binary.length + 37)), addr(LOADER)]),
    [meta(OWNER, R.WRITABLE_SIGNER), meta(BUFFER, R.WRITABLE), meta(OWNER, R.READONLY_SIGNER)], SYSTEM_ID);
  const initialize = instruction(u32(0), [meta(BUFFER, R.WRITABLE), meta(OWNER, R.READONLY)]);
  const writes = Array.from({ length: Math.ceil(binary.length / 900) }, (_, n) => {
    const offset = n * 900, chunk = binary.subarray(offset, offset + 900);
    return { name: `write-${offset}`, instructions: [instruction(Buffer.concat([u32(1), u32(offset), u64(String(chunk.length)), chunk]),
      [meta(BUFFER, R.WRITABLE), meta(OWNER, R.READONLY_SIGNER)])] };
  });
  // Devnet rejected ExtendProgramChecked (9) in unsigned simulation; use supported ExtendProgram (6).
  // Recheck the authority immediately before this step; upgrade itself requires its signature.
  const extend = instruction(Buffer.concat([u32(6), u32(63592)]), [meta(DATA, R.WRITABLE), meta(PROGRAM_ID, R.WRITABLE),
    meta(SYSTEM_ID, R.READONLY), meta(OWNER, R.WRITABLE_SIGNER)]);
  const upgrade = instruction(u32(3), [meta(DATA, R.WRITABLE), meta(PROGRAM_ID, R.WRITABLE), meta(BUFFER, R.WRITABLE),
    meta(OWNER, R.WRITABLE), meta("SysvarRent111111111111111111111111111111111", R.READONLY),
    meta("SysvarC1ock11111111111111111111111111111111", R.READONLY), meta(OWNER, R.READONLY_SIGNER)]);
  return [{ name: "create-initialize", instructions: [create, initialize] }, ...writes,
    { name: "extend", instructions: [extend] }, { name: "upgrade", instructions: [upgrade] }];
}
const pause = (ms: number) => new Promise(r => setTimeout(r, ms));
async function save(path: string, data: unknown) {
  const temp = `${path}.${randomUUID()}.tmp`, file = await open(temp, "wx", 0o600);
  try { await file.writeFile(JSON.stringify(data)); await file.sync(); } finally { await file.close(); }
  await rename(temp, path); const dir = await open(dirname(path), "r"); try { await dir.sync(); } finally { await dir.close(); }
}
export async function main() {
  const { values: v } = parseArgs({ options: { send: { type: "boolean" }, ledger: { type: "string" }, selfcheck: { type: "boolean" } }, strict: true });
  const binary = await readFile(new URL("../../programs/soulbound/target/deploy/soulbound.so", import.meta.url));
  const steps = upgradeInstructions(binary);
  assert.equal(await createAddressWithSeed({ baseAddress: address(OWNER), programAddress: address(LOADER), seed: SEED }), BUFFER);
  assert.equal(steps.length, 327); assert.equal(steps[1].instructions[0].data.length, 916);
  assert.equal(steps[324].instructions[0].data.length, 452); // final 436-byte chunk
  const chain = new DreamChain(process.env.MEMORY_COMMIT_RPC_URL ?? "https://api.devnet.solana.com");
  const publicChain = new DreamChain("https://api.devnet.solana.com");
  const rpc = chain.base.rpc.bind(chain.base);
  const transaction = async (instructions: typeof steps[number]["instructions"]) => {
    const latest = await rpc("getLatestBlockhash", [{ commitment: "confirmed" }]) as any;
    const message = appendTransactionMessageInstructions(instructions,
      setTransactionMessageLifetimeUsingBlockhash({ blockhash: blockhash(latest.value.blockhash), lastValidBlockHeight: BigInt(latest.value.lastValidBlockHeight) },
        setTransactionMessageFeePayer(address(OWNER), createTransactionMessage({ version: 0 }))));
    const tx = compileTransaction(message), wire = getBase64EncodedWireTransaction(tx);
    assert.ok(Buffer.from(wire, "base64").length <= 1232); assert.equal(Object.keys(tx.signatures).length, 1);
    return { tx, wire, lastValidBlockHeight: latest.value.lastValidBlockHeight };
  };
  if (v.selfcheck) {
    // Actual binary, exact deterministic address, packet/signature checks, no key file reads or sends.
    for (const step of [steps[0], steps[1], steps[324], steps[325], steps[326]]) await transaction(step.instructions);
    const extend = await transaction(steps[325].instructions);
    const simulation = await rpc("simulateTransaction", [extend.wire, { encoding: "base64", sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed" }]) as any;
    assert.equal(simulation.value.err, null);
    console.log(JSON.stringify({ state: "upgrade-encoding-selfcheck-passed", steps: steps.length, binarySHA256: HASH, extensionSimulationUnits: simulation.value.unitsConsumed })); return;
  }
  if (!v.ledger) throw new Error("private ledger required");
  await privateDirectory(dirname(v.ledger));
  const lock = await open(`${v.ledger}.lock`, "wx", 0o600);
  let phase = "preflight";
  try {
    await lock.writeFile(JSON.stringify({ pid: process.pid })); await lock.sync();
    let journal: any;
    try {
      const info = await lstat(v.ledger); assert.ok(info.isFile() && !(info.mode & 0o077));
      journal = JSON.parse(await readFile(v.ledger, "utf8"));
      assert.equal(journal.schema, 1); assert.equal(journal.binarySHA256, HASH); assert.equal(journal.program, PROGRAM_ID);
    } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
    const account = async (key: string) => {
      const a = await publicChain.account(key); if (!a) return null;
      return { ...a, bytes: Buffer.from(a.data[0], "base64") };
    };
    const programState = async () => {
      const p = await account(PROGRAM_ID), d = await account(DATA);
      assert.ok(p?.executable && p.owner === LOADER && p.bytes.equals(Buffer.concat([u32(2), addr(DATA)])));
      assert.ok(d && !d.executable && d.owner === LOADER && d.bytes.readUInt32LE() === 3 && d.bytes[12] === 1 && d.bytes.subarray(13, 45).equals(addr(OWNER)));
      return d!;
    };
    const snapshotKeys = [PROGRAM_ID, "74dRYy2RARkhQs963QcGZdVXhfjABm2BGC7WFwSd7Ehc", "BVF8KRRGK6CV55GaQd4KdJFhYtrKX1GekFdoVpn1AY6p",
      "8ra3ckcmgWRhFyWBiCz6KPLM76hugAYhjeEzZCxc8fHU", "KTDQzSUUiT62zdRPceSgzteo5VcfkCfya2otLGCS6YZ", "45GjZKzknQuHoNNRA8XpamEdPn9ZcjnYqwcbnMA7X5W9"];
    const snapshot = async () => {
      const values: any = {};
      for (const key of snapshotKeys) {
        const a = await account(key); assert.ok(a);
        values[key] = { owner: a!.owner, lamports: a!.lamports, executable: a!.executable, dataHash: sha256(a!.bytes) };
      }
      return values;
    };
    assert.equal(await rpc("getGenesisHash"), DEVNET_GENESIS);
    assert.equal(await publicChain.base.rpc("getGenesisHash"), DEVNET_GENESIS);
    const before = await programState();
    if (before.bytes.length === 291181 && sha256(before.bytes.subarray(45)) === HASH) {
      assert.ok(journal); assert.deepEqual(await snapshot(), journal.before);
      assert.equal(await account(BUFFER), null);
      console.log(JSON.stringify({ state: "upgrade-readback-confirmed", signature: journal.steps.upgrade?.signature, binarySHA256: HASH, assetsUnchanged: true })); return;
    }
    assert.ok([227589, 291181].includes(before.bytes.length));
    assert.equal(sha256(before.bytes.subarray(45, 227589)), OLD_HASH);
    if (before.bytes.length > 227589) assert.ok(before.bytes.subarray(227589).every(b => b === 0));
    const buffer = await account(BUFFER);
    if (!journal) {
      assert.equal(buffer, null); assert.equal(before.bytes.length, 227589);
      assert.equal(await rpc("getMinimumBalanceForRentExemption", [291173]), RENT);
      assert.equal((await rpc("getMinimumBalanceForRentExemption", [291181]) as number) - before.lamports, EXTEND_RENT);
      const balance = (await rpc("getBalance", [OWNER, { commitment: "confirmed" }]) as any).value;
      assert.ok(balance >= PEAK);
      journal = { schema: 1, program: PROGRAM_ID, binarySHA256: HASH, authority: OWNER, buffer: BUFFER,
        approvedBy: "Tolu", approvalSource: "Chat: approve plans proceed", approvalScope: "Exact fixed seeded-buffer upgrade only; no trait send/funding/authority change",
        approvedPeakLamports: PEAK, approvedFeeLamports: FEES, beforeBalanceLamports: balance, before: await snapshot(), steps: {} };
      if (v.send) await save(v.ledger, journal);
    } else if (buffer) {
      assert.equal(buffer.owner, LOADER); assert.equal(buffer.bytes.length, 291173);
      assert.ok(buffer.bytes.subarray(0, 37).equals(Buffer.concat([u32(1), Buffer.from([1]), addr(OWNER)])));
    }
    const simulate = async (tx: Awaited<ReturnType<typeof transaction>>) => {
      const r = await rpc("simulateTransaction", [tx.wire, { encoding: "base64", sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed" }]) as any;
      if (r.value.err) throw new Error(`simulation failed ${JSON.stringify(r.value.err)}`);
      const fee = (await rpc("getFeeForMessage", [Buffer.from(tx.tx.messageBytes).toString("base64"), { commitment: "confirmed" }]) as any).value;
      assert.equal(fee, 5000); return { units: r.value.unitsConsumed, fee };
    };
    if (!v.send) {
      assert.equal(buffer, null);
      const create = await simulate(await transaction(steps[0].instructions));
      const extend = await simulate(await transaction(steps[325].instructions));
      console.log(JSON.stringify({ state: "upgrade-dry-run", create, extend, steps: steps.length, approvedPeakLamports: PEAK, binarySHA256: HASH })); return;
    }
    const keyFile = process.env.MEMORY_COMMIT_FEE_PAYER_KEY_FILE;
    assert.ok(keyFile); const info = await lstat(keyFile); assert.ok(info.isFile() && !(info.mode & 0o077));
    const secret = JSON.parse(await readFile(keyFile, "utf8"));
    assert.ok(Array.isArray(secret) && secret.length === 64 && secret.every(n => Number.isInteger(n) && n >= 0 && n <= 255));
    const signer = await createKeyPairSignerFromBytes(Uint8Array.from(secret)); assert.equal(signer.address, OWNER);
    const confirm = async (signature: string) => {
      for (let n = 0; n < 60; n++) {
        let status: string;
        try { status = await chain.status(signature); }
        catch { status = await publicChain.status(signature); } // independent read fallback, never retry a send
        if (status === "confirmed") return;
        if (status === "error") throw new Error("transaction failed; operator review required");
        await pause(500);
      }
      throw new Error("pending or absent; reconcile ledger, never automatically re-sign");
    };
    for (const [index, step] of steps.entries()) {
      phase = step.name;
      if (step.name === "extend" || step.name === "upgrade") {
        const current = await programState();
        assert.equal(sha256(current.bytes.subarray(45, 227589)), OLD_HASH);
      }
      if (step.name === "upgrade") {
        const b = await account(BUFFER); assert.ok(b && sha256(b.bytes.subarray(37)) === HASH);
        assert.deepEqual(await snapshot(), journal.before);
      }
      const old = journal.steps[step.name];
      if (old) {
        assert.ok(typeof old.signature === "string" && /^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(old.signature));
        await confirm(old.signature); // Never sign/resend a ledgered attempt, even if expired.
      } else {
        assert.ok(Object.keys(journal.steps).length < 327);
        const tx = await transaction(step.instructions); const estimate = await simulate(tx);
        const signed = await signTransaction([signer.keyPair], tx.tx);
        const submission = { signature: getSignatureFromTransaction(signed), wire: getBase64EncodedWireTransaction(signed), lastValidBlockHeight: tx.lastValidBlockHeight };
        journal.steps[step.name] = { ...submission, state: "pending", feeLamports: estimate.fee };
        await save(v.ledger, journal); // signed signature/wire durable BEFORE single network send
        try { await chain.broadcast(submission); } catch { /* ambiguous: confirmation only, never a blind retry */ }
        await confirm(submission.signature);
      }
      journal.steps[step.name].state = "confirmed"; await save(v.ledger, journal);
      if (step.name.startsWith("write-")) {
        const offset = Number(step.name.slice(6)), length = Math.min(900, binary.length - offset);
        // Read back each uploaded slice without dumping the binary or private RPC URL.
        let matches = false;
        for (let attempt = 0; attempt < 10; attempt++) {
          const response = await publicChain.base.rpc("getAccountInfo", [BUFFER, { encoding: "base64", commitment: "confirmed", dataSlice: { offset: 37 + offset, length } }]) as any;
          matches = !!response.value && Buffer.from(response.value.data[0], "base64").equals(binary.subarray(offset, offset + length));
          if (matches) break;
          await pause(500); // read-only cross-provider lag tolerance, never resubmit a transaction
        }
        assert.ok(matches, "uploaded slice did not read back");
      }
      console.log(JSON.stringify({ state: "upgrade-step-confirmed", index: index + 1, total: steps.length, action: step.name, signature: journal.steps[step.name].signature }));
      await pause(250); // bound operator RPC pressure; fees and approved transaction schedule unchanged
    }
    const after = await programState(); assert.equal(after.bytes.length, 291181); assert.equal(sha256(after.bytes.subarray(45)), HASH);
    assert.deepEqual(await snapshot(), journal.before); assert.equal(await account(BUFFER), null);
    journal.afterBalanceLamports = (await rpc("getBalance", [OWNER, { commitment: "confirmed" }]) as any).value;
    assert.equal(journal.beforeBalanceLamports - journal.afterBalanceLamports, EXTEND_RENT + FEES);
    journal.state = "confirmed"; await save(v.ledger, journal);
    console.log(JSON.stringify({ state: "upgrade-confirmed", signature: journal.steps.upgrade.signature, binarySHA256: HASH,
      assetsUnchanged: true, permanentCostLamports: EXTEND_RENT + FEES, bufferClosed: true }));
  } catch (e) {
    const reason = e instanceof Error && (e.message.startsWith("simulation failed") || e.message.startsWith("pending or absent") || e.message.startsWith("transaction failed") || /^RPC [A-Za-z]+ failed/.test(e.message)) ? e.message : "precondition/key/transport mismatch; private details suppressed";
    throw new Error(`upgrade stopped at ${phase}: ${reason}`);
  } finally { await lock.close(); await rm(`${v.ledger}.lock`, { force: true }); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(e => { console.error(e.message); process.exitCode = 1; });
