#!/usr/bin/env node
// Explicit Mac operator command. No automatic recovery, key creation or funding.
import { readFile } from "node:fs/promises";
import { PROGRAM_ID, DEVNET_GENESIS, deriveIdentity } from "../dist/memory/committer.js";
import { SolanaChain } from "../dist/memory/committer-solana.js";
import { rotateRuntimeSigner } from "../dist/memory/runtime-rotation.js";

async function main() {
  const args = process.argv.slice(2), flags = new Map();
  for (let n = 0; n < args.length; n++) {
    const flag = args[n];
    if (!["--dry-run", "--send", "--approval", "--help"].includes(flag) || flags.has(flag)) throw new Error("unknown/duplicate rotation flag");
    if (flag === "--approval") {
      if (!args[n + 1] || args[n + 1].startsWith("--")) throw new Error("--approval requires a private plan filename");
      flags.set(flag, args[++n]);
    } else flags.set(flag, true);
  }
  if (flags.has("--help")) {
    console.log("rotate-runtime-signer.mjs [--dry-run | --send --approval PRIVATE_JSON]\nExplicit dual-signature owner + replacement recovery; never reads a memory store or creates a key. Signing is Mac-only. Required: MEMORY_OWNER_ID, MEMORY_CHARACTER_ID, MEMORY_COMMIT_RPC_URL, MEMORY_COMMIT_PROGRAM_ID, MEMORY_COMMIT_FEE_PAYER, MEMORY_ROTATE_EXPECTED_RUNTIME_PUBLIC_KEY, MEMORY_ROTATE_REPLACEMENT_PUBLIC_KEY, MEMORY_ROTATE_JOURNAL. Send also needs private OWNER_KEY_FILE/REPLACEMENT_KEY_FILE settings. See docs/005-committer-runbook.md.");
    return;
  }
  const send = flags.has("--send");
  if (send && flags.has("--dry-run")) throw new Error("--send and --dry-run are exclusive");
  if (!send && flags.has("--approval")) throw new Error("--approval is only valid with --send");
  if (send && process.platform !== "darwin") throw new Error("rotation signing is Mac-only; never copy the replacement secret to this VPS");
  const setting = (key) => { const value = process.env[key]; if (!value) throw new Error(`missing setting ${key}`); return value; };
  if (setting("MEMORY_COMMIT_PROGRAM_ID") !== PROGRAM_ID) throw new Error("preserved devnet program ID required");
  const ns = { ownerId: setting("MEMORY_OWNER_ID"), characterId: setting("MEMORY_CHARACTER_ID") };
  const identity = await deriveIdentity(ns);
  const intent = { owner: ns.ownerId, characterId: ns.characterId, config: identity.config, history: identity.history,
    expectedRuntime: setting("MEMORY_ROTATE_EXPECTED_RUNTIME_PUBLIC_KEY"), replacement: setting("MEMORY_ROTATE_REPLACEMENT_PUBLIC_KEY"), payer: setting("MEMORY_COMMIT_FEE_PAYER") };
  console.log(JSON.stringify({ action: "rotate_runtime_signer", program: PROGRAM_ID, genesis: DEVNET_GENESIS, ...intent }));
  let approval;
  if (send) {
    if (!flags.has("--approval")) throw new Error("--send requires separate explicit Tolu approval (--approval)");
    approval = JSON.parse(await readFile(flags.get("--approval"), "utf8"));
  }
  const chain = new SolanaChain(setting("MEMORY_COMMIT_RPC_URL"), undefined, process.env.MEMORY_COMMIT_FEE_PAYER_KEY_FILE);
  const operator = {
    inspect: (i) => chain.inspect(i), simulateRotation: (i) => chain.simulateRotation(i),
    signRotation: (i) => chain.signRotation(i, process.env.MEMORY_ROTATE_OWNER_KEY_FILE, process.env.MEMORY_ROTATE_REPLACEMENT_KEY_FILE),
    broadcast: (s) => chain.broadcast(s), status: (s) => chain.status(s), finalizedHeight: () => chain.finalizedHeight(),
  };
  const result = await rotateRuntimeSigner(intent, operator, setting("MEMORY_ROTATE_JOURNAL"), send, approval);
  console.log(JSON.stringify(result));
  if (result.state === "pending") process.exitCode = 2;
}
main().catch((error) => {
  const message = error instanceof SyntaxError ? "invalid JSON (private details suppressed)" : error?.code ? `local operation failed (${error.code})` : error.message;
  console.error(`[rotation] ${message}`); process.exitCode = 1;
});
