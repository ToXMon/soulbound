# Ticket 005 — operator handoff (offline implementation; live gates open)

This is not independent acceptance or a completed ticket. No deploy, funding,
upgrade, key regeneration, signing or broadcast was performed. No fixture root
satisfies the real-session criterion. Conversational recall is not implemented.

## Prerequisite and boundary

Checkout after `git pull --ff-only`: `5845c1c`, containing 004 implementation
`2d3c982` and integrity fixes `0563e8c`. The 004 tests exercise corrupt manifest
membership/progression, malformed proof metadata and cross-process writer
exclusion/recovery. No 004 hashing/store code was modified. The historical
`docs/004-review-and-005-readiness.md` predates those fixes; it remains untouched.

The committer is a standalone CLI, not a worker scheduler. No chain imports,
RPC requests, retries or confirmations enter `agent/src/index.ts`, extraction,
speech or turn publication. The operator triggers each sealed namespace/epoch
sequentially. An RPC outage can fail this process, not stall the voice process.
Use Node >=20.18; Solana Kit is pinned to 8.6.0 (address/PDA/transaction/signature
primitives). Stdlib fetch implements bounded JSON-RPC transport; stdlib private
atomic files implement the journal. No legacy web3.js or Anchor JS dependency.

## On-chain contract

- Preserved program: `BdswGigVwzuRjcbj2XMsNHTGB37pCaPQquq8v1tAqJZd`.
- Config remains `[b"character", owner public key bytes, character_id u64 LE]`;
  existing `CharacterConfig` is unchanged. No genesis asset/receipt updates.
- History is `[b"memory_roots", config PDA bytes]`, canonical bump, same program.
- Only `config.runtime_signer` may sign a commit, including first creation.
  A separate signed system-wallet payer pays history rent; the transaction fee
  payer can be that wallet. CLI uses the configured payer for both.
- `init_if_needed` is intentional: first successful append atomically creates
  the history. Existing association/bump are validated, never reset. There is
  no close, edit, reset, migrate or delete handler for history.
- Layout: discriminator 8 + config 32 + bump 1 + vec length 4 + 128 ×
  (epoch 8 + root 32 + timestamp 8) = **6,189 bytes**. Fixed rent upfront;
  129th entry rejects, never reallocates/truncates. Rent observed both in
  LiteSVM and devnet RPC: **32,090,360 lamports**.
- Empty entries, not config epoch, is the initial sentinel. First epoch may be
  zero or greater; subsequent epochs must strictly increase. Epoch is assigned
  directly to config; `u64::MAX` never wraps. Zero root is rejected. Root bytes
  are exact hex-decoded 32 bytes, never a hash of the hex text.
- `MemoryRootCommitted` is a fixed-size Anchor event with config, epoch, root
  and chain Clock timestamp (Unix seconds). LiteSVM decodes actual `Program
  data:` bytes and compares every field. Persistent history is authoritative;
  logs alone are not an availability guarantee.
- Error codes: 6002 unauthorized runtime, 6003 zero root, 6004 duplicate/regressed
  epoch, 6005 full history, 6006 invalid association/bump; 6001 checked arithmetic.
  Anchor's typed seed/owner/signer/program constraints handle wrong accounts.

## Real-session setup — Tolu must do this first

1. Choose the intended live config, not an alias. The existing genesis identity:
   owner `CdvYdEJUk4gxXhz53v7SAKggzfyKx5ho85uRhhvnMKs1`, character `895354`,
   config `74dRYy2RARkhQs963QcGZdVXhfjABm2BGC7WFwSd7Ehc`.
   Its runtime is **`f97njkTdcbBrHL9vwFCLBHHURhB78YavqQRJGL2xktt`**.
   The original genesis script discarded that runtime private key. Follow the
   amended recovery procedure below: a NEW dedicated runtime key is created
   on the Mac, then installed only by an explicitly approved dual-signature
   rotation. Never regenerate/overwrite existing owner/program/deployer keys.
   After confirmed rotation, configure the committer with the NEW public key
   and its Mac-only key reference.
2. Configure private `agent/.env` using placeholders in `agent/.env.example`:
   `MEMORY_ENABLED=true`, private `MEMORY_STORE_PATH`, owner/character above,
   RPC URL, preserved program ID, runtime public key, fee payer public key,
   private journal filename and securely persisted Mac key-file references. Do not put raw
   keys in env or the browser. Key/journal files must be 0600; journal directory
   0700, outside the repository. Existing insecure permissions fail visibly,
   never silently chmod a shared directory. Dry-run does not open signing keys.
3. If existing live data uses `char-elder` or another alias, STOP and reconcile
   the intended identity with Tolu. Do not rewrite sealed records, copy them
   into another namespace or guess a mapping. Start a new real session with
   the correct identity after Tolu chooses it. Current VPS memory settings
   were unset; no live store/session was inspected or inferred from fixtures.
4. Run a real opt-in Meta memory session. Stop the worker, inspect the bounded
   shutdown drain report, and require zero pending/in-flight/failed/overflow
   jobs before calling this a complete session. Queue input is not crash-durable.
   Replay missing work explicitly; this CLI cannot detect lost unpersisted jobs.
5. With the worker stopped (004 single-writer lock must be available), seal:

   ```bash
   node --env-file=agent/.env agent/scripts/commit-memory-root.mjs --seal --session-settled
   ```

   `--session-settled` is the operator's explicit attestation of step 4, not a
   completeness proof. Empty epochs fail. Sealing is local only; do not combine
   it with `--send`, `--epoch` or `--dry-run`. Use the emitted actual epoch.

## Offline/read-only dry-run

```bash
node --env-file=agent/.env agent/scripts/commit-memory-root.mjs --epoch 0 --dry-run
# --dry-run is the default if neither --send nor --seal is supplied.
node agent/scripts/commit-memory-root.mjs --help
```

All flags are strict: unknown/duplicate flags and conflicting modes fail.
Missing settings/stores fail visibly. The CLI holds 004's namespace lock and
opens/revalidates all sealed manifests. Before preparing a transaction it
recomputes referenced record content hashes and verifies mapping/proofs through
004's authoritative API. It refuses aliases, unsealed/empty/corrupt batches.

It prints only public intent: devnet genesis, program, owner, character, config,
history, runtime, payer, epoch and root. RPC validates devnet genesis (not URL
spelling), executable program, config owner/discriminator/seeds/bump/layout,
identity, runtime, history association/bump/order and latest config epoch.
Unsigned simulation uses `sigVerify:false`; **no signing**. A successful
simulation includes CU, balance, fee and maximum history-rent estimates. The
currently deployed 002 program does not implement 005: simulation can fail until
an approved upgrade. A missing setting failure is not a successful live dry-run.

## Submission journal and restart

Private journal key is `devnet genesis : config PDA : epoch`; value contains
intended root, pending/confirmed/error state, known signature and last-valid
block height. No transcript, summaries or signing secrets. Writes use a 0600
exclusive temporary file, fsync, atomic rename and directory fsync. A separate
exclusive journal lock serializes invocations; concurrent writers fail closed.
A crashed process may leave that journal lock: inspect its pid, verify no
committer is alive, then have the operator remove ONLY that stale lock. Never
remove an active 004 writer lock or a live journal lock to bypass exclusion.

Before any sign/retry, read chain history and reconcile *all* journal roots for
that config, including earlier epochs after later commits. Same epoch/root is
success without another send; different root is a hard conflict. A previously
confirmed entry missing from chain fails visibly. A direct on-chain replay is
still rejected by the program.

Signature and intended root are durable **before** broadcast. Send is attempted
once with RPC `maxRetries:0`; send/confirmation ambiguity leaves `pending` unless
history actually contains the intended root. Signature confirmation without
history readback is not reported as success. Restart with the same namespace,
epoch and journal to reconcile. An existing viable/pending signature is never
re-signed. A replacement is possible only on a later explicit approved `--send`
after history is absent, signature is absent and finalized block height exceeds
its last-valid height. A known failed signature stops for operator review.
Read RPC retries are bounded (3 attempts, 5s each, 200/400ms backoff); broadcast
has one 5s attempt. No automatic confirmation loop or background resend daemon.
CLI exit codes: 0 dry-run/readback-confirmed, 1 error/blocker, 2 pending/unconfirmed.

## Approval gates — no action approved yet

Before **any** funding, extension, buffer creation/upload, upgrade/deploy or
`--send`, present Tolu the exact action/commands, program ID, upgrade authority,
runtime public key, fee payer, current balance and estimated SOL/rent/fees,
then **WAIT for explicit approval**. Available files/funds are not consent.
Never touch mainnet, key generation, Akash leases or voice/model configuration.

Read-only inputs are in `docs/devnet.md`. Candidate fee payer/upgrade authority
is the owner above, observed balance 4.072202160 SOL. New binary needs more
ProgramData space after the rotation amendment: added rent at least
0.239532160 SOL; temporary exact-sized buffer deposit 1.156761720 SOL.
These updated quotes supersede the pre-amendment binary estimates. Upload/extend/upgrade fees and exact command
sequence are **not yet approved or fully estimated**. Refresh all values and
prepare a separate exact upgrade plan before asking for approval. Preserve
program ID/config/assets, and independently verify executable status/config
bytes/assets/receipt after any approved upgrade.

After the upgrade and a real validated sealed epoch, dry-run again. First
history commit estimate at observed fees is 0.032100360 SOL (rent + 2-signature
fee); later commits need the fee only. CLI conservatively budgets full history
rent even when history exists. Refresh estimates before approval.

For the commit only, after Tolu approves the exact public intent, create a
private approval JSON OUTSIDE the repository. It must copy every public intent
field exactly (`owner`, `characterId`, `config`, `history`, `runtime`, `payer`,
`epoch`, `root`, `genesis`, `program`) and add `approvedBy: "Tolu"`, an ISO
`expiresAt`, and integer `maximumLamports` approved by Tolu. This is a local
operator interlock, not a cryptographic proof of human consent. No file has
been created or approval inferred in this implementation session.

```bash
# ONLY AFTER explicit approval and real-session validation; never offline:
node --env-file=agent/.env agent/scripts/commit-memory-root.mjs \
  --epoch ACTUAL_SEALED_EPOCH --send --approval /PRIVATE/APPROVED-PLAN.json
```

The CLI rejects mismatched/expired approvals, wrong key public identities,
insecure key files, insufficient fee-payer balance and costs over the approved
cap. It never reads signing files for a dry-run. Do not substitute the owner key
for the distinct runtime key. No automatic funding/upgrade command is embedded.

## Amended runtime-signer recovery — Mac only, not performed

Authority: ticket amendment and SOULBOUND decision entry at `964556a`.
`/tmp/mint/mint-genesis.mjs:21` used
`const runtimeSigner = Keypair.generate().publicKey;`; the 002 execution log
confirms that script minted character `895354`. Only the public address was
retained; this is not a key Tolu was expected to have saved or can reconstruct.

The new instruction requires `config.owner` AND the replacement signer to
sign. It deliberately does not require the lost runtime. Either signature
alone fails; unrelated owner fails (6007); no-op fails (6008). Config is still
154 bytes, with only bytes 48..80 changing. Seeds, owner, character ID, asset,
receipt mint, memory_epoch, bump, account metadata and committed history are
unchanged. `RuntimeSignerRotated` carries config, old signer, new signer and
chain Clock timestamp. LiteSVM snapshots actual assets/receipt/history bytes
and decodes the actual event. The stale runtime is rejected by REQ-11, and the
replacement can append subject to the same epoch rules. No automatic rotation
was added to the root committer or voice worker.

### Tolu's Mac: create the dedicated replacement key

Run locally on the Mac, NEVER in the VPS shell or a shared/recorded session.
The pinned CLI's `--silent` option suppresses the seed phrase. This creates a
NEW file and refuses to overwrite anything; do not add `--force`. Protect the
Mac with FileVault and retain a secure local backup. Do not paste a seed phrase,
JSON key bytes or private key into chat, evidence, Git or an environment value.
Only the public address is shared for the transaction plan.

```bash
# MAC ONLY. Local key creation; no transaction or funding.
(
  umask 077
  keydir="$HOME/.config/soulbound"
  keyfile="$keydir/runtime-005.json"
  mkdir -p "$keydir" || exit 1
  test ! -e "$keyfile" && test ! -L "$keyfile" || {
    printf '%s\n' 'Refusing to overwrite an existing key'; exit 1;
  }
  solana-keygen new --silent --outfile "$keyfile" || exit 1
  chmod 600 "$keyfile" || exit 1
  solana-keygen pubkey "$keyfile"
)
```

No persistent replacement key was generated on the VPS. Ephemeral LiteSVM test
keys are unrelated and must never become product/deployment keys. Memory stays
in the Mac-local private 004 store; neither free-tier Neon instance is used.

### Explicit rotation CLI and separate approval

After the approved program upgrade, configure private Mac env references:
`MEMORY_OWNER_ID`, decimal `MEMORY_CHARACTER_ID`, `MEMORY_COMMIT_RPC_URL`, pinned
`MEMORY_COMMIT_PROGRAM_ID`, `MEMORY_COMMIT_FEE_PAYER`,
`MEMORY_ROTATE_EXPECTED_RUNTIME_PUBLIC_KEY` (the old
`f97njkTdcbBrHL9vwFCLBHHURhB78YavqQRJGL2xktt` address),
`MEMORY_ROTATE_REPLACEMENT_PUBLIC_KEY` (the newly shared public address),
`MEMORY_ROTATE_JOURNAL` (a dedicated private file for this exact rotation),
`MEMORY_ROTATE_OWNER_KEY_FILE` and `MEMORY_ROTATE_REPLACEMENT_KEY_FILE`.
If payer differs from both signers, also configure its existing private
`MEMORY_COMMIT_FEE_PAYER_KEY_FILE`. The old runtime secret is never requested.
The owner key must already be in secure Mac storage after a separately approved
remediation; do not improvise moving keys or changing permissions to unblock it.

```bash
node --env-file=agent/.env agent/scripts/rotate-runtime-signer.mjs --dry-run
```

No memory session/store is needed for rotation. Dry-run builds and simulates
an unsigned instruction, verifies devnet/program/config/history/current signer,
and reports the fee/balance with **zero additional account rent**. It does not
open signing-key files. Before the upgraded instruction exists, simulation is
expected to reject; that is a blocker, not a successful dry-run.

Present Tolu with the exact public intent, upgrade authority, owner,
old/new runtime addresses, fee payer, balance and live fee estimate. WAIT for a
**separate approval for this first new-signer transaction**, independent of
upgrade/funding approvals. The rotation fee depends on distinct signers/payer;
no live fee quote exists yet because the replacement public address is pending.

The private rotation approval JSON must exactly include `action` equal to
`rotate_runtime_signer`, `program`, `genesis`, `owner`, `characterId`, `config`,
`history`, `expectedRuntime`, `replacement`, `payer`, `approvedBy: "Tolu"`,
future ISO `expiresAt` and approved integer `maximumLamports`. It is a local
operator interlock, not cryptographic proof of human approval. Root-commit
approval files are not interchangeable with rotation approvals.

```bash
# MAC ONLY, ONLY AFTER the separate exact-action approval:
node --env-file=agent/.env agent/scripts/rotate-runtime-signer.mjs \
  --send --approval /PRIVATE/APPROVED-ROTATION.json
```

Signing is explicitly refused on non-macOS hosts, preventing accidental use of
the replacement secret on the VPS. Both owner and replacement key identities
are checked; the transaction is journaled privately before the single broadcast.
Restart reconciles current config signer before any retry. Already-installed
replacement is readback success without another send; an unrelated current
signer is a hard conflict. A viable/confirmed signature without readback remains
pending, never success. A new attempt requires an absent signature, finalized
blockhash expiry, unchanged current signer and a fresh valid approval. Known
transaction errors stop for review. Journal locks are fail-closed after a crash;
verify the holder pid before any separately authorized stale-lock cleanup.

After confirmed rotation, set `MEMORY_COMMIT_RUNTIME_PUBLIC_KEY` and its Mac
key-file reference to the replacement. Then run the real memory session, seal,
dry-run, and request the **separate root-commit approval**. Rotation does not
satisfy the real-memory-root criterion.

### Deployer-key remediation proposal — separate approval, NOT performed

The exposed copy is the already-documented `/tmp/mint/deployer.json`; it was
observed as root-owned mode 0644. The original `~/.config/solana/id.json` remains
root-owned mode 0600. No permission change, key transfer, deletion, funding or
upgrade-authority rotation was performed. Moving/restricting a copy cannot
prove it was never read while accessible.

Propose to Tolu a separately approved remediation plan: owner-controlled secure
recovery to Mac-local storage followed by removal of the exposed VPS duplicate
only after verifying the recovered **public** identity and backup. No secret
should be displayed in terminal logs/chat/evidence or handled by this agent.
If reliable protection/recovery is not possible (or exposure is treated as
compromise), propose a **separate program-upgrade-authority rotation** to a
secure Mac-controlled authority. This does not change character ownership or
repair the lost runtime; those are distinct roles/actions.

The pinned Solana 4.3.2 CLI supports the following command template. Do NOT run
it until the NEW authority public key, secure local key references, payer,
balance and current fee estimate are filled in and Tolu approves that exact
transaction. New upgrade-authority key creation, any funding and asset/wallet
migration are not implied by the runtime-key amendment. Do not use `--final`
or skip the new-authority signature check.

```bash
# PROPOSAL TEMPLATE ONLY — separate future approval required, on the Mac.
solana program set-upgrade-authority \
  BdswGigVwzuRjcbj2XMsNHTGB37pCaPQquq8v1tAqJZd \
  --url devnet \
  --keypair "${CURRENT_AUTHORITY_KEY:?secure local fee-payer/current-authority file required}" \
  --upgrade-authority "${CURRENT_AUTHORITY_KEY:?}" \
  --new-upgrade-authority "${NEW_UPGRADE_AUTHORITY_KEY:?separately approved secure local authority required}"
```

This uses the current authority as fee payer and requires the new authority's
signature. Supply a read-only fresh plan/fee quote and obtain approval first;
then independently verify the authority and unchanged program/config identity.
This proposal neither rotates the character owner wallet nor claims removal of
any exposure that may already have occurred.

## Observed offline verification after the amendment

- Pinned image: `anchor build` and
  `cargo test -p tests -- --nocapture --test-threads=1`: 9 tests succeeded,
  including 2 rotation cases and all existing genesis cases. The no-history
  case also proves the unfunded replacement can commit epoch zero when a
  separate payer covers rent/fees.
- `env -u NODE_ENV pnpm build`: app and agent builds succeeded, with app dev
  stopped (nothing listening on port 3000 before the build).
- Ticket's combined Node command (committer, memory, TTS core/provider/pipeline,
  live-latency report): 61 tests succeeded, zero failures. Rotation tests use
  mock transactions only; no signing or broadcasting during offline checks.
- Generated IDL and checked-in snapshot compare identically. Binary and IDL
  hashes are recorded in `docs/devnet.md`. `git diff --check` was clean.
- Existing memory tests still emit FileHandle garbage-collection warnings;
  the pre-existing SBF dual-crate-type/LTO warning remains. No stack-offset
  warning was observed. No 004 tests were weakened or its protocol altered.
- Configured live dry-runs still require Mac settings, the new PUBLIC runtime
  address and approved upgraded program. Missing-setting errors are blockers,
  not simulated/live acceptance evidence.
- No independent judge/consult tool is available in this harness. These are
  doer self-checks, not independent verification. All ticket implementation
  changes remain uncommitted while required live gates are open.

## Readback and independent evidence still required

After an approved send, rerun the same epoch dry-run to reconcile without
rebroadcasting. Require chain readback of exact root and epoch, not just a
signature. Independently recompute every content hash and Merkle root from the
private records and validate inclusion/tamper rejection with 004's proof API.
Keep raw memory private. Give AdaL the actual signature/explorer link, public
runtime, root/epoch/config, source revision and SHA-256 of binary/IDL. Tolu
supplies redacted session evidence; the doer does not edit `audit/`.

Local deterministic fixtures and self-tests are not live Meta evidence or an
independent audit. Required real extraction, approved upgrade, approved real
root transaction and independent proof/readback evidence remain open. No commit
is marked complete while these gates are open.
