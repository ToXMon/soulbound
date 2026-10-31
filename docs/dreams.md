# Dream cycle — ticket 006

## Closeout — Tolu sign-off, 2026-10-31

Tolu requested: “i trust the system works lets actully push and close out the
 ticket. when it come to production we will use a server”. This is **closeout
with explicitly deferred live acceptance evidence**, not a claim that every
original checkbox passed. Canonical ticket/checklist and independent review
remain thinker-owned; the doer has not edited them.

- Delivered: deterministic cron example, private journals, direct Meta Spark 1.3
  consolidation + Wonder review, runtime-gated full Attributes replacement and
  journal-hash provenance. The approved devnet program upgrade finalized.
- Observed: actual Meta structured inference and a real private journal with two
  memory references; Wonder proposed zero changes, so no trait transaction was
  signed or broadcast. Unsigned owner-rejection probes and prior real-Core
  LiteSVM coverage are recorded below.
- Deferred to server deployment: scheduler installation and an actual scheduled
  fire. **No local crontab is installed.** Rex administration/Full Disk Access
  were not required or granted by the agent; do not enable them for this ticket.
- Still unverified: a nonempty live proposal → approved devnet trait transaction
  → changed Attributes + DreamState hash + before/after explorer evidence. Do not
  manufacture a change or treat the successful program upgrade as this proof.
- Final local checks: agent build, **28 Node checks** (8 dream + 20 committer),
  strict dream typecheck and diff checks passed. Prior pinned SBF build and
  **10 LiteSVM tests** are historical evidence; Rust was not rerun at closeout
  because the pinned Docker image is unavailable. The Solana source tree is
  unchanged from the approved implementation.
- Automated `no-mistakes` gate is not initialized in this repository; it was not
  configured outside ticket scope or represented as passed. Independent thinker
  acceptance and CI are not claimed.

The pre-finalization local commit `23add43` in upgrade receipts is historical;
finalization amends that unpublished commit to retain one ticket/one commit.
Its unchanged `programs/soulbound` Git tree is
`7ef2afcce5da676d544eb4b7d41a0d1948b7a1bb`. The approved deployed binary hash remains
`51997587fb67648b65ce0610b757d7988f30dcabd85c3c3332c82b1d9ddf8153`.

## Authority and migration

Tolu-approved thinker resolution (2026-10-30): **do not attach an mpl-core
Oracle adapter**. `UpdatePluginV1` uses plugin authority, not Oracle lifecycle
validation. The genesis asset already has config-PDA update authority. The only
new signing path is `evolve_traits`: canonical config + configured runtime
signature → PDA-signed CPI to the pinned Core program. A direct owner or
third-party Core call cannot sign as the config PDA. No genesis changes.

The deployed `CharacterConfig` stays **154 bytes**, preserving 005's strict
reader, rotation and memory-root tooling. Journal provenance lives in a separate
**89-byte `DreamState` PDA**, seeds `["dream", config]`, with fields:
`config, bump, journal_hash[32], revision(u64), timestamp(i64)`. The first authorized
evolution allocates it atomically. Latest hash is stored; `TraitsEvolved` events
carry historical hashes and revisions. No reset/close/reallocation instruction.

`evolve_traits(expected_revision, journal_hash, new_attributes)` rejects:
- non-runtime signer, unsigned runtime, wrong config/asset/Core program;
- stale revision, zero/repeated journal hash, invalid provenance binding;
- duplicate/empty keys or values, >16 attributes, >32-byte keys or >128-byte values;
- missing existing keys or required `mood`/`trait_vector`;
- `life_stage` or `memory_epoch` inconsistent with config.

Fetch-modify-write is **the complete ordered Attributes list**, not a plugin
patch. Unknown existing keys are retained. Only Wonder-proposed `mood` and
`trait_vector` values are applied by the client; lifecycle/epoch come from config.
Failures roll back both Core changes and provenance creation/update. Runtime
rotation takes effect immediately because the instruction reads the current
config every time. Trust boundary: owner-authorized rotation and program upgrades
remain existing administrative powers; this is not protection against a malicious
upgrade authority or an owner deliberately installing a new runtime.

## Offline reproduction (no keys, model calls, or broadcast)

Use Node 24+ (native TypeScript stripping) and the already-installed agent deps.
The `../dist/memory/` imports reuse 004/005; build the agent first if absent:

```sh
pnpm --filter agent build
node --test agent/dream/dream.test.ts
node agent/dream/run-once.ts --character genesis --out /tmp/dream-fixture.json
```

Default mode replays `agent/dream/fixtures/recorded.json`: **synthetic recorded
responses, not live inference or real memories**. Both journal and stdout say
`fixture`. `--fixture FILE` selects another explicitly labeled fixture. Fixture
journals are rejected by the chain path even with `--send`. Existing output is
never overwritten. Use a fresh output filename for another run.

Program build/test stays inside `sb-anchor:1.2.1`. The existing Mac-local program
keypair was found to have public identity `7VRcVdvsaAZdNAn4wcSwNPVrJGc8LbSLzg4qL8oXrCuv`,
not the pinned program ID. It was **not** regenerated, synchronized, or used to
sign. `--ignore-keys` skips that local build-only comparison, preserving
`declare_id!` and `Anchor.toml`. Never use that keypair to identify a deployment.

```sh
docker run --rm --platform linux/amd64 \
  -v sbcargo:/usr/local/cargo/registry -v sb006-platform:/root/.cache \
  -v "$PWD/programs/soulbound:/w" -w /w sb-anchor:1.2.1 sh -c \
  'unset RUSTUP_TOOLCHAIN; anchor build --ignore-keys && cargo test -p tests -- --nocapture --test-threads=1'
cmp programs/soulbound/target/idl/soulbound.json programs/soulbound/idl/soulbound.json
```

Keep `RUSTUP_TOOLCHAIN` unset: pinned `anchor-lang-idl` 0.1.4 incorrectly passes
literal `+{toolchain}` to Cargo when it is set. The repository's `rust-toolchain.toml`
still pins 1.99.1. The first run needs network access for rustup's pin check and
the image's pinned SBF platform-tools (v1.57); subsequent runs reuse the named cache. No wallet directory
is mounted. Do not run keygen, keys sync, or `anchor test --skip-local-validator`.
The last command deploys; it is not the LiteSVM runner. Tests use the existing real
`mpl_core.so`, not a mock. Agent checks are doer self-checks, not independent review.

Standalone strict dream typecheck (does not change 021's tsconfig):

```sh
cd agent
./node_modules/.bin/tsc --noEmit --strict --target ES2022 --module NodeNext \
  --moduleResolution NodeNext --allowImportingTsExtensions --allowJs \
  --skipLibCheck dream/*.ts
```

## Live inference, off-chain only

Private configuration stays outside the repo; never print it or source it with
shell tracing enabled. The ticket's file scope excludes `.env.example`, so these
settings are documented here instead:

| Variable | Purpose |
| --- | --- |
| `MODEL_API_KEY` | Meta Model API credential for non-contributor Spark 1.3 + Wonder |
| `META_API_KEY` | existing Meta credential fallback when `MODEL_API_KEY` is unset |
| `MEMORY_OWNER_ID` | explicit owner public key |
| `MEMORY_CHARACTER_ID` | canonical decimal character ID (`895354` for genesis) |
| `MEMORY_STORE_PATH` | existing private 004 store root |
| `MEMORY_COMMIT_RPC_URL` | HTTPS devnet RPC; never logged |
| `MEMORY_COMMIT_RUNTIME_PUBLIC_KEY` | expected current runtime public key |
| `MEMORY_COMMIT_FEE_PAYER` | funded system-wallet public key |
| `MEMORY_COMMIT_RUNTIME_KEY_FILE` | existing Mac-local private key reference; send only |
| `MEMORY_COMMIT_FEE_PAYER_KEY_FILE` | existing payer key reference; send only |

```sh
node agent/dream/run-once.ts --character genesis --live-models \
  --out /ABSOLUTE/PRIVATE/PATH/dreams/2026-10-31.json
```

Real journal parents must be 0700; journals and key files must be regular 0600
files. Permissions are checked, not silently relaxed. 004 persists by atomic
rename, so dream takes a coherent **read-only** `store.json` snapshot, validates
records/content hashes/manifests with 004's own validators, and never acquires its
lifetime writer lock. The voice worker can remain running. Memories persisted
after this read belong to the next snapshot. Dream never creates, writes,
consolidates or deletes the source store. Consolidation is a derived view in the
journal. Full history (including supersession references) is supplied up to 200
memories/150KB, with a 2MB source-file bound; larger/empty graphs fail explicitly,
not truncate.

Tolu-approved substitution (2026-10-31): both calls use Meta
`https://api.meta.ai/v1`: **`muse-spark-1.3`** consolidates and **`muse-wonder-1.0`**
reviews. Baseten and its credential are no longer required. The existing Meta
credential may be reused through `META_API_KEY`; an explicit `MODEL_API_KEY`
takes precedence. Spark 1.3's voice path is untouched. The live account catalog
omitted Spark Open and its direct probe returned 404 `model_not_found`; evidence:
`audit/006-dream-cycle/pi-spark-open-meta-access-probe.json`. Structured JSON v1 is locally validated, with cited IDs checked
against the supplied graph. SDK automatic retries are off; transient server/rate
failures have three bounded attempts with exponential jitter, no client-error
retry. Provider bodies/keys are never logged. Direct Meta structured calls were verified
with explicitly synthetic input, then with a real private journal after Tolu's
approval. Fixture replay alone is still not evidence of provider availability.

## Journal format and hash

UTF-8 JSON, two-space indentation and final newline. Schema v1 contains:
- `fixture`, `created_at` (UTC ISO timestamp), pinned `program` and `genesis`;
- `snapshot`: exact owner/character/config/asset/runtime/payer, prior revision and
  journal hash, full fetched attributes, config lifecycle/epoch;
- `memories`: record IDs, committed content hashes, timestamps, summaries and
  optional supersession references from the validated 004 graph;
- fixed model IDs, structured `consolidation` themes with memory IDs;
- Wonder `review`: journal prose, memory IDs, cited bounded changes;
- `new_attributes`: full fetch-modify-write list, mechanically checked against review.

**SHA-256 of the exact file bytes** is the 32-byte on-chain `journal_hash`.
This is not 004's Keccak Merkle algorithm. The document does not contain its own
hash. `readJournal` recomputes it; editing whitespace changes the approval and
on-chain commitment. Preserve original private bytes for provenance; do not put
personal memories or journal prose in public audit evidence. Export only hashes,
counts, model IDs and public transaction/account data.

## Deterministic scheduler

`agent/dream/dream.cron` is an **uninstalled example**, not a claim that cron ran.
Install through the operator's crontab after replacing its wrapper path. Example
private wrapper (0700), with absolute Node/repo/config paths:

```sh
#!/bin/sh
set -eu
umask 077
. /ABSOLUTE/PRIVATE/PATH/dream.env
cd /ABSOLUTE/PATH/soulbound
exec /ABSOLUTE/PATH/node agent/dream/run-once.ts --character genesis --live-models \
  --out "/ABSOLUTE/PRIVATE/PATH/dreams/$(date -u +%F).json"
```

`dream.env` must export settings, be 0600, and never be committed. Create the
private output directory first. Cron invokes once daily at 03:00 host time; date
names are UTC. Same-day duplicate invocation refuses existing output. Inference
and journaling alone are scheduled, **not chain submission**. An O_EXCL output
lock serializes the whole invocation. After a crash, verify holder PID and journal
integrity before manually removing a stale lock. Never auto-remove submission
locks. To demonstrate the criterion, record the actual cron fire and resulting
UTC journal timestamp/count/hash; a manual fixture run is not that evidence.

## Trait committer: simulate → exact approval → send → reconcile

No generation step broadcasts. Submitting an existing real journal is a separate
operation. Default submission mode simulates unsigned, without opening key files:

```sh
node agent/dream/run-once.ts --journal /PRIVATE/dreams/DATE.json \
  --ledger /PRIVATE/submissions/DATE.json
```

The chain must be upgraded first; a pre-upgrade simulation of the new instruction
is expected to fail. Before submission, the current devnet genesis, executable
program, canonical config/history, runtime, asset authority and full attributes
are checked. `expected_revision` prevents stale overwrites/replay. A proposal with
no changed attributes returns `no-trait-change` without signing.

A dry run prints the full public intent, its `intentHash`, and current simulated
CU/fee/balance plus **conservative maximum** rent (first DreamState and asset growth).
No journals/prose are printed. Tolu separately approves that exact intent by a
private JSON file containing:

```json
{
  "action": "evolve_traits",
  "approvedBy": "Tolu",
  "intentHash": "COPY_THE_EXACT_DRY_RUN_HASH",
  "program": "BdswGigVwzuRjcbj2XMsNHTGB37pCaPQquq8v1tAqJZd",
  "genesis": "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
  "expiresAt": "REPLACE_WITH_APPROVED_FUTURE_UTC_TIME",
  "maximumLamports": 1
}
```

The example is deliberately unusable: replace the cap with the separately
approved fee-plus-rent amount. Then and only then:

```sh
node agent/dream/run-once.ts --journal /PRIVATE/dreams/DATE.json \
  --ledger /PRIVATE/submissions/DATE.json --send --approval /PRIVATE/approval.json
```

State and approval are rechecked after simulation and before signing. Existing
key references must match approved public identities. Full-list transactions
larger than Solana's 1232-byte packet are rejected, never truncated. The signed
signature/expiry is fsynced to a dedicated private submission ledger **before**
the one broadcast; ambiguous transport does not resend. Restart the default
read-only command to reconcile revision + hash + full attributes. Pending exits 2.
Confirmed status alone is not trait readback. Expired/absent submissions return
`expired-review-required`; even explicit `--send` never re-signs that ledger.
Resolve via operator review and a newly approved attempt, not deleting history
or blindly resetting the ledger. Keep journals/ledgers and their original bytes.

## Upgrade approval boundary and live evidence

Read-only current cost inputs (no key loading or send path):

```sh
node agent/dream/plan-upgrade.ts
```

This reports binary hash/size, actual upgrade authority/payer, program capacity,
required extension, current rent and signature-fee quotes. The proposed buffer is
an absent deterministic System `CreateAccountWithSeed` address (base = existing
payer, seed = `sb006-` plus 26 hex characters of the binary hash, owner = loader).
It needs **no new keypair**. Proposed schedule: atomic create+initialize (one
transaction), fixed 900-byte ordered loader writes, extension if needed, then
upgrade with buffer spill/refund to payer. The output includes public buffer
address/seed, counts, rent and peak/permanent cost estimates. No buffer is created.

Fees are **estimates**, not simulations of upload transactions; no priority fee is
assumed. Re-read current inputs and obtain Tolu's exact schedule/binary/cap approval
before any buffer creation, extension, upload, upgrade or funding. A different CLI
buffer/chunking procedure requires a new plan and approval. Never use the
mismatched program keypair; upgrade targets the preserved **public program ID**
and existing authority.

After the separately approved upgrade: confirm deployed bytes match the approved
binary hash, preserve config/receipt/asset snapshots, generate a real dream and
simulate its exact trait transaction. Ask Tolu for **another** approval before its
first send. Funding, if needed, also requires a separate exact-action approval.

## Offline handoff (2026-10-31 UTC)

Prerequisite source: `cdc2934`. Read-only genesis snapshot confirmed current runtime
`2CU934FR5LwgnngkBYTH2yzYvJ7UeXvSNYUnaoZBd6HM`, no DreamState, unchanged curious
traits. No runtime/payer key files were opened, and no keys were created or moved.
Anchor's initial local program-key identity check reported the mismatch; no signing
occurred. That file's permissions were tightened to 0600, then its build comparison
was skipped.

Doer checks (not independent acceptance):
- Pinned Docker SBF build + generated IDL succeeded; no stack-offset warning.
- All **10 LiteSVM tests passed**, including the original 9; final extended test
  run additionally covers revision overflow and attribute bounds. New evolution:
  46,296 CU in the fixture; first provenance rent 1,102,360 lamports.
- **7 dream client checks passed**; standalone strict typecheck passed.
- **20 existing 005 client regression checks passed**; generated IDL matches snapshot.
- Fixture CLI wrote an immutable timestamped journal with memory references/hash;
  **no actual cron fire or live model inference was verified**.

Command outputs and redacted execution transcript are under
`audit/006-dream-cycle/pi-*`. `pi-build-test-final.log` is the successful combined
build/IDL/test output; `pi-litesvm-final.log` is the later passing extended suite. The
`pi-build-test-confirmed.log` capture timed out before completion and is not a
success receipt; the subsequent complete LiteSVM run is the authoritative result.
`pi-upgrade-plan-seeded.json` is the read-only proposed upgrade schedule/cost input,
not permission to execute it. Earlier local logs/estimates, if retained, are
historical and superseded. `pi-devnet-before.json` is the public before snapshot;
`pi-fixture-journal.json` is explicitly synthetic. No personal memories were exported.

Live acceptance remains pending until the actual cron invocation and approved
transaction: capture the before/after complete Attributes, real signature,
`TraitsEvolved` hash/revision/time, and independent journal-file hash readback.
An address explorer link alone is not a historical before snapshot. Use real
transaction links plus saved public before/after state; never invent an explorer
signature or imply a fixture changed devnet. No live trait-evolution PASS is claimed.

## Approved upgrade receipt — finalized 2026-10-31

Tolu approved the presented plan in chat (`approve plans proceed`). This approval
was applied to the exact upgrade schedule only, not an unspecified first trait
transaction, wallet funding or authority rotation. Program source basis: `23add43`.
The Mac-only operational executor is `agent/dream/upgrade-program.ts`: fixed binary,
public identities, seeded buffer, 900-byte writes, fee/rent caps, durable signatures
before sends, and ledger reconciliation without blind re-signing. No keygen or
program-keypair use. Only the existing owner/payer key was used on the Mac.

- Upgrade: `52hNDwy9FjZt8Nbk9JrS5EmTjJjD4HrBfmzFjW6Th94vQ4QH7VPv111cG3K8jvXWTBYCBbQ6xrcA4KRQMefAiyPx`.
- [Actual upgrade transaction](https://explorer.solana.com/tx/52hNDwy9FjZt8Nbk9JrS5EmTjJjD4HrBfmzFjW6Th94vQ4QH7VPv111cG3K8jvXWTBYCBbQ6xrcA4KRQMefAiyPx?cluster=devnet).
- Executable bytes: **291,136**; SHA-256
  `51997587fb67648b65ce0610b757d7988f30dcabd85c3c3332c82b1d9ddf8153`.
- Same program ID, ProgramData address and upgrade authority. Config, Core asset,
  receipt mint/ATA and memory history match their before-upgrade hashes/metadata.
- **327 successful transactions**: create+initialize, 324 writes, extension, upgrade.
  The finalized buffer-address history has exactly the expected 326 signatures
  (extension touches ProgramData, not the buffer), with no errors or duplicate sends.
- Buffer deposit **1.479809080 SOL** refunded; buffer is closed. Additional program
  rent **0.323047360 SOL**; fees **0.001635000 SOL**; permanent payer decrease
  **0.324682360 SOL**. Final payer balance **3.474732280 SOL**. Aggregate fees
  reconcile signed-message quotes with the finalized payer/rent delta; actual
  create/extend/upgrade metadata fees were separately checked at 5,000 lamports each.
- The first run paused during confirmation of write offset 1800. Public readback
  proved its journaled signature confirmed; the resumed run reused the ledger,
  did not re-sign those transactions, and completed the same approved 327 steps.
  A second existing private RPC configuration plus bounded read fallback was used.
- Unsigned probe of `ExtendProgramChecked` (variant 9) returned
  `InvalidInstructionData`; supported variant 6 simulated successfully and was
  used. This probe broadcast nothing and charged no fee.

Proof: `audit/006-dream-cycle/pi-approved-upgrade-finalized-readback.json`, execution
logs and `pi-live-authorization-simulations.json`. These are doer observations,
not an independent acceptance review. Against the upgraded program, **unsigned
negative simulations only** reject owner `evolve_traits` with 6009 and direct Core
owner mutation with 26; the snapshot remains unchanged. The dummy journal hash in
those rejection probes is not a real dream or submitted transaction.

Historical pre-substitution blocker: existing private operator configuration had neither
`MODEL_API_KEY` nor `BASETEN_API_KEY` set. A read-only input check found **2 validated
real memory references**; their content was not exported or sent to any model.
At that checkpoint, no live model call, installed cron, real dream journal or
trait transaction was claimed. Tolu subsequently approved using direct Meta Spark
1.3 + Wonder with the existing Meta credential, removing the Baseten prerequisite.
Generate the real Meta journal, capture an actual scheduled fire, simulate its
exact trait intent and obtain separate approval before the first trait send.

## Approved direct-Meta run — 2026-10-31

Tolu approved Spark 1.3 consolidation + Wonder review after the live account's
Spark Open probe returned 404. `MODEL_API_KEY` takes precedence; existing
`META_API_KEY` is an explicit fallback. No Baseten client, key or endpoint remains
in the dream product path. Product models stay non-contributor Meta variants;
no live voice code changed and no further program upgrade was needed.

- Native dream checks: **8 passed**; standalone strict typecheck passed.
- Both actual Meta models returned locally validated structured JSON for a
  labeled synthetic input (`pi-direct-meta-live-fixture-check-retry.json`).
- A real private journal was then written using **2 validated memory references**.
  SHA-256: `c463c8aa801067eec2548c4d41601871fa0427fb73360d3dc95f6975a109af59`.
  Source memories and journal prose remain private; only aggregate metadata/hash
  were exported in `pi-first-direct-meta-dream.log`.
- **Wonder proposed zero changes.** The submission dry-run returned
  `no-trait-change`, with no signing, simulation, fee quote or broadcast. This is
  a valid model verdict, not a live trait-evolution PASS. The original journal is
  immutable; do not edit/retry it to manufacture a visible personality change.

Actual scheduled cron firing and a genuine nonempty proposal followed by a
separately approved trait transaction remain pending. A later dream with new
meaningful interaction history may motivate a change; no fixture or doer-authored
trait value substitutes for that evidence.

## Local scheduler activation — 2026-10-31

Tolu chose local cron. A private 0700 wrapper was prepared at
`~/.config/soulbound/ticket-006/cron/dream-nightly.sh`; it references existing env
files without copying credentials, uses absolute Node/repo paths, and generates
private journals only. A per-slot directory claim prevents repeated inference
charges after a failed attempt; inspect any failure before manually permitting a
retry. Proposed daily schedule: **03:00 America/New_York** (host timezone; DST
applies). A temporary once-per-minute probe would prove an actual cron fire, then
be removed; its fixed one-attempt slot prevents repeated model calls.

**Installation is blocked, not complete.** Native `crontab -` returned
`crontab: tmp/tmp.78346: Operation not permitted`; readback confirms no ticket-006
job installed. No cron fire is claimed. Resolve macOS permissions in the hosting
terminal/app before retrying. Because this repo is on Desktop, the cron daemon
also needs permission to read that protected location. Do not bypass privacy
controls, relocate secret files or claim that a manual wrapper run proves cron.

The existing browser dev server was restarted without app-source changes: `/` and
`/api/token` both returned HTTP 200. LiveKit and the agent were not restarted.
A private environment check confirms the running worker has memory enabled for
character 895354 and uses the same owner/store as dream. Actual new conversational
memory persistence still requires a real user conversation and a read-only check
of the resulting store; configuration alone is not that proof.
