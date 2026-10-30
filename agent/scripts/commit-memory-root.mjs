#!/usr/bin/env node
// Standalone operator tool. Never imported by the voice worker.
import { readFile, access } from "node:fs/promises";
import { join } from "node:path";
import { MemoryStore, namespaceDirName } from "../dist/memory/store.js";
import { PROGRAM_ID, DEVNET_GENESIS, prepareIntent, commitMemoryRoot } from "../dist/memory/committer.js";
import { SolanaChain } from "../dist/memory/committer-solana.js";

async function main() {
  const args = process.argv.slice(2);
  const allowed = new Set(["--epoch", "--dry-run", "--send", "--approval", "--seal", "--session-settled", "--help"]);
  const flags = new Map();
  for (let n = 0; n < args.length; n++) {
    const flag = args[n];
    if (!allowed.has(flag) || flags.has(flag)) throw new Error("unknown/duplicate CLI flag");
    if (["--epoch", "--approval"].includes(flag)) {
      if (!args[n + 1] || args[n + 1].startsWith("--")) throw new Error(`${flag} requires a value`);
      flags.set(flag, args[++n]);
    } else flags.set(flag, true);
  }
  if (flags.has("--help")) {
    console.log("commit-memory-root.mjs --epoch DECIMAL [--dry-run | --send --approval PRIVATE_JSON]\nSeal separately: --seal --session-settled (operator attests extraction queue drained; zero failed/dropped/pending).\nRequired settings: MEMORY_STORE_PATH, MEMORY_OWNER_ID (public key), MEMORY_CHARACTER_ID (decimal u64), MEMORY_COMMIT_RPC_URL, MEMORY_COMMIT_PROGRAM_ID, MEMORY_COMMIT_RUNTIME_PUBLIC_KEY, MEMORY_COMMIT_FEE_PAYER, MEMORY_COMMIT_JOURNAL. Send also requires existing key-file references. See docs/005-committer-runbook.md.");
    return;
  }
  const setting = (key) => { const value = process.env[key]; if (!value) throw new Error(`missing setting ${key}`); return value; };
  const ns = { ownerId: setting("MEMORY_OWNER_ID"), characterId: setting("MEMORY_CHARACTER_ID") };
  // Reject aliases even for sealing. Never rewrite existing sealed identities.
  const { deriveIdentity } = await import("../dist/memory/committer.js");
  await deriveIdentity(ns);
  if (flags.has("--send") && (flags.has("--dry-run") || flags.has("--seal"))) throw new Error("--send cannot combine with --dry-run/--seal");
  if (!flags.has("--seal") && !flags.has("--epoch")) throw new Error("--epoch required");
  const root = setting("MEMORY_STORE_PATH");
  await access(join(root, namespaceDirName(ns), "store.json")); // missing stores must not be silently created
  const store = await MemoryStore.open(root, ns);
  try {
    if (flags.has("--seal")) {
      if (!flags.has("--session-settled") || flags.has("--epoch") || flags.has("--dry-run")) throw new Error("seal separately with --seal --session-settled after checking queue counters");
      const manifest = await store.sealEpoch();
      if (!manifest) throw new Error("empty epoch: nothing to seal");
      console.log(JSON.stringify({ state: "sealed-offchain", epoch: manifest.epoch, root: manifest.root })); return;
    }
    if (setting("MEMORY_COMMIT_PROGRAM_ID") !== PROGRAM_ID) throw new Error("program ID must match preserved devnet program");
    const intent = await prepareIntent(store, flags.get("--epoch"), setting("MEMORY_COMMIT_RUNTIME_PUBLIC_KEY"), setting("MEMORY_COMMIT_FEE_PAYER"));
    console.log(JSON.stringify({ cluster: "devnet", genesis: DEVNET_GENESIS, program: PROGRAM_ID, ...intent }));
    const send = flags.has("--send");
    let approval;
    if (send) {
      if (!flags.has("--approval")) throw new Error("--send requires explicit human-approved private plan file (--approval)");
      approval = JSON.parse(await readFile(flags.get("--approval"), "utf8"));
      const expected = { ...intent, genesis: DEVNET_GENESIS, program: PROGRAM_ID };
      for (const [k, value] of Object.entries(expected)) if (approval[k] !== value) throw new Error(`approval mismatch: ${k}`);
      if (approval.approvedBy !== "Tolu" || !Number.isSafeInteger(approval.maximumLamports) || approval.maximumLamports < 1 ||
          !Number.isFinite(Date.parse(approval.expiresAt)) || Date.parse(approval.expiresAt) <= Date.now()) throw new Error("invalid/expired Tolu approval");
    }
    const chain = new SolanaChain(setting("MEMORY_COMMIT_RPC_URL"), process.env.MEMORY_COMMIT_RUNTIME_KEY_FILE, process.env.MEMORY_COMMIT_FEE_PAYER_KEY_FILE);
    if (send) {
      const sign = chain.sign.bind(chain);
      chain.sign = async (i) => {
        if (Date.parse(approval.expiresAt) <= Date.now()) throw new Error("Tolu approval expired before signing");
        return sign(i);
      };
      const simulate = chain.simulate.bind(chain);
      chain.simulate = async (i) => {
        const estimate = await simulate(i);
        const maximum = estimate.feeLamports + estimate.maximumHistoryRentLamports;
        if (maximum > approval.maximumLamports || maximum > estimate.balanceLamports) throw new Error("cost exceeds approval or fee-payer balance");
        return estimate;
      };
    }
    const result = await commitMemoryRoot(intent, chain, setting("MEMORY_COMMIT_JOURNAL"), send);
    console.log(JSON.stringify(result));
    if (result.state === "pending") process.exitCode = 2; // not confirmed, never success-by-timeout
  } finally { await store.close(); }
}
main().catch((error) => {
  // Do not dump stacks, key contents, RPC URLs or provider response bodies.
  const message = error instanceof SyntaxError ? "invalid JSON (private details suppressed)" : error?.code ? `local operation failed (${error.code})` : error.message;
  console.error(`[committer] ${message}`); process.exitCode = 1;
});
