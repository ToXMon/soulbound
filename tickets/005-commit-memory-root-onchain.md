# Ticket 005: commit-memory-root-onchain

Date: 2026-10-29
Owner: Tolu Shekoni
Verifier: AdaL
TL;DR: Anchor validated sealed memory roots on Solana devnet, asynchronously and with runtime-signer authorization. Fix 004 integrity blockers first; no deployment or signing until approval.

## Intent and requirements

Implement REQ-10 (append epoch/root/timestamp), REQ-11 (runtime signer only), REQ-12 (reject duplicate/regressed epochs), REQ-13 (root event). Bridge validated Ticket 004 manifests to the character's root history without placing chain RPC in the voice path. This does not implement recall, traits, heartbeat, privacy challenges or judge minting.

## Amendment: runtime-signer rotation (authorized by Tolu Shekoni, 2026-10-29)

This ticket additionally implements an owner-authorized runtime-signer replacement instruction. Rationale: a lost or compromised runtime signer would otherwise permanently lock `commit_memory_root` and future signed instructions. The amendment is scoped exactly as follows; anything beyond it remains out of scope.

**Authorized scope:**
1. New instruction `rotate_runtime_signer` requiring BOTH the config owner's signature AND the proposed replacement signer's signature. Either alone must fail. A rotation to the current signer (no-op) must be rejected.
2. Preservation guarantees: program ID, config PDA seeds and `CharacterConfig` layout/serialization compatibility, Core asset, receipt mint, `memory_epoch`, and any committed root history are untouched by rotation. Only the `runtime_signer` field changes. Existing account data must deserialize identically post-rotation.
3. Rotation emits a parseable event carrying config identity, old signer, new signer and chain timestamp. LiteSVM tests must prove: unauthorized rotation (owner alone, replacement alone, unrelated signer) fails; after rotation the OLD signer can no longer execute `commit_memory_root` (REQ-11 regression); the NEW signer can; and a failed rotation leaves all state unchanged.
4. Key handling: create a NEW dedicated replacement runtime keypair on Tolu's Mac via `solana-keygen new` (or equivalent), stored only in Tolu's local secure key storage. This is creation of a new key, never regeneration/overwrite of existing program, deployer or genesis keys. The replacement public key is shared for configuration; the secret never leaves the Mac, never enters the repo, chat, SDL, or evidence.
5. Remediate the insecure VPS deployer-key copy as an explicit, separately approved action: identify the exposed key file, and on Tolu's approval either move it off the VPS to secure local storage or, if the key cannot be reliably recovered/protected, document a follow-up rotation of the program upgrade authority with exact commands (that rotation is its own gated action, not part of this ticket's default run). Never print or transmit key material. Record the remediation taken in the ticket report without exposing paths containing secrets beyond what documentation already pins.
6. Approval gates unchanged and additive: the devnet program upgrade (now required, since rotation adds an instruction), any funding, and ANY first transaction involving the new signer each require a separate, exact-action approval from Tolu (action, authorities, payer, SOL estimate) before broadcast.
7. Memory storage stays Mac-local per the existing contract; no Neon or external database integration in this ticket. The live root commit is prepared from Tolu's local sealed manifest.

**Implementation notes:**
- `commit_memory_root` continues to require the CURRENT `config.runtime_signer` (REQ-11 semantics unchanged). Rotation is the only path that changes that field.
- Config account space: rotation changes no field sizes; no reallocation needed. State this in a test assertion.
- The committer/CLI gains no automatic rotation behavior. Rotation is an operator action via explicit CLI command (e.g. `rotate-runtime-signer`), gated on the dual-signature transaction and Tolu's approval.
- If a rotation instruction conflicts with any architecture REQ as written, STOP and report the conflict; do not edit REQ tables. REQ-11 remains satisfied (a stale signer is rejected).

**Amendment acceptance criteria (each observable):**
- [ ] LiteSVM: dual-signature rotation succeeds; owner-only, replacement-only, unrelated-signer, and no-op (same signer) rotations all fail with typed errors and unchanged state.
- [ ] Post-rotation: old signer's `commit_memory_root` fails; new signer succeeds (epoch progression rules unchanged); config.layout/serialization, asset, receipt, memory_epoch and history preserved byte-compatibly.
- [ ] Rotation event decodes with config, old signer, new signer, timestamp.
- [ ] New runtime keypair created on the Mac; public key recorded in config/docs; no secret in repo, VPS artifacts or evidence.
- [ ] VPS deployer-key remediation executed per the authorized option and recorded without exposing secrets.
- [ ] Separate approvals obtained for: program upgrade, funding (if needed), first new-signer transaction, and any deployer-key remediation action.

## Prerequisite gate

Read docs/004-review-and-005-readiness.md. Ticket 004's local implementation is `2d3c982`; verify which commit is present before working. Do not broaden 005 to silently fix 004. If manifest/proof validation and single-writer protection are not resolved in a reviewed 004 continuation, STOP before implementing or broadcasting 005. Retain existing root hashing semantics and supply regression tests for corrupt manifest mappings, malformed proof metadata and concurrent namespace writers. Live Meta extraction evidence must be clearly separate from offline fixtures.

## Files in scope

- `programs/soulbound/`: root-history instruction, state, events, errors, IDL, focused LiteSVM tests and reproducible build documentation.
- `agent/src/memory/committer.ts` (new), adjacent committer-only modules/tests as necessary; consume the validated 004 store API rather than alter its hash protocol.
- `agent/scripts/commit-memory-root.mjs`, `agent/scripts/committer.test.mjs` (new).
- `agent/src/index.ts`: minimal nonblocking post-session/epoch scheduler and bounded shutdown handling if needed; no audio/model/voice changes.
- `agent/.env.example`: placeholder-only RPC/program/runtime-key configuration.
- `agent/package.json`, lockfile: smallest compatible Gill/Solana Kit client dependency, justified and pinned through lockfile.
- `docs/devnet.md`, `docs/memory-schema.md` (chain handoff documentation only), `docs/005-committer-runbook.md` (new).

Do not edit architecture REQs, other tickets, SOULBOUND.md, audit/, private key files or TTS deployment. Load doer, solana-doer and applicable project Solana build/test/security skills.

## Chain design

- Preserve existing program ID and CharacterConfig layout/owner/asset/receipt state. Config PDA remains [b"character", owner public key bytes, character_id as u64 little endian]. Do not regenerate program/deploy keys or silently migrate genesis.
- Root history uses a separately derived PDA bound to the exact config account. Document a single seed recipe and verify it in Rust/client tests. Store config association, bounded entries and bump; calculate exact rent/size. A capacity of 128 entries is acceptable for the demo; full capacity fails cleanly, never truncates history.
- Runtime signer must sign and equal config.runtime_signer. Verify config seeds/ownership, history binding and payer/system constraints before mutations. Define authenticated first-history initialization, rent payer and funding requirements; no arbitrary signer can claim a character's history PDA.
- Use chain Clock timestamp; append immutable (epoch u64, root [u8;32], timestamp). Reject zero/invalid root, wrong accounts, wrong signer and arithmetic/capacity errors with typed errors and unchanged state.
- Epoch zero is valid for the FIRST entry: 004 starts at zero. Empty history is the uninitialized sentinel, not config.memory_epoch==0. For later entries require strictly increasing epochs. Update config.memory_epoch to the last accepted epoch; do not add one or remap epochs in the client. Initial config still satisfies REQ-07.
- Emit a parseable event with config identity, epoch, exact root and timestamp. Tests must capture and decode the actual event; do not assert an invented tx log.

## Manifest and identity contract

- Consume a sealed validated manifest and its namespace. Recompute each referenced record's content_hash, validate record-ID/leaf mapping, epoch/schema/algorithm and root before preparing a transaction. Empty/unsealed/corrupt batches are refused.
- Keccak-256, canonical UTF-8 JSON excluding content_hash, raw 32-byte leaves, sorted leaves and pairs, odd-last duplication, single-leaf identity: use docs/memory-schema.md unchanged. Root hex must be exactly 64 valid hex characters and decode to 32 bytes; never hash hex text instead of root bytes.
- Existing demo fixture IDs such as char-elder are not valid on-chain u64 character IDs. Require the configured public owner and canonical decimal u64 character ID to match the intended config. Do not guess an alias mapping or anchor another character's data. Stop for explicit identity reconciliation if existing live records use aliases; never rewrite sealed records in place.
- Root inclusion proves integrity/membership, not truth, data availability or completeness of all conversations. Keep summaries and provenance private/off-chain.

## Async committer and recovery

- Keep submission outside speech/turn publication and extraction execution. Seal only after the relevant extraction jobs settle; a failed/incomplete queue must not be presented as a complete session history. Document trigger and explicit operator sealing command; process each namespace sequentially.
- Dry-run mode is default: validate and show public identity/root/epoch/cluster, simulate when supported, no broadcast. Sending requires explicit --send and approved devnet operation.
- Persist a private submission journal keyed by cluster/genesis identity + config PDA + epoch, including intended root, transaction signature if known and pending/confirmed/error state. Never store signing secrets or transcript text.
- Before sending or retrying, query history. Same epoch+root already present is reconciled success without another transaction; same epoch+different root is a hard conflict; later on-chain epochs do not erase earlier journal checks. Program still rejects a directly replayed instruction.
- On ambiguous send/confirmation timeout, inspect signature status and history before any resend. Retry transient RPC failures with bounded backoff; re-sign only after checking blockhash expiry/state. Never blindly rebroadcast a new logical commit or mark failure as success.
- Validate RPC cluster as devnet, program executable/ID, config identity and runtime signer public key. No mainnet use or private-key printing. Keep key material in existing local secure files, not browser/env examples/committed code.
- A restarted committer resumes/reconciles journal state. It must not block the voice worker on RPC outages, Solana confirmations or retry sleeps.

## Deployment and tooling gate

Check usable tool versions before editing dependencies. This Mac's anchor command reported a wrapper mismatch (expected 0.30.1, installed 0.31.1); project docs pin a different proven Anchor toolchain. Use programs/soulbound/BUILD.md's supported pinned environment or report the exact blocker. Do not randomly upgrade Anchor/Solana/Rust until something compiles.

Before upgrade/deploy or funding transaction, show Tolu devnet program ID, upgrade authority public key, runtime signer public key, fee payer, balance, estimated SOL/rent and exact action. Obtain approval; do not assume available secrets imply authority or spending consent. Preserve program ID and existing genesis accounts. Missing local deployment/runtime key means BLOCKED, not key regeneration.

## Acceptance criteria

- [ ] 004 validation prerequisite is resolved and its reviewed manifest protocol is consumed exactly.
- [ ] LiteSVM: first epoch 0 appends; higher epoch appends; earlier entries unchanged; config epoch matches latest entry (REQ-10).
- [ ] Wrong signer, foreign config/history/PDA, duplicate/regressed epoch, zero root and full history fail without state changes (REQ-11/12).
- [ ] Actual event decoded and matches root/config/epoch/timestamp (REQ-13).
- [ ] Realistic rent/account-size bounds and history capacity tested; existing genesis tests remain green.
- [ ] Off-chain committer tests cover validation, wrong cluster/identity/signer, byte conversion, dry-run no-send, restart, same-root reconciliation, conflicting root and ambiguous-send recovery.
- [ ] Existing memory and 003/019 regression tests pass; RPC failure does not delay speech.
- [ ] Approved upgrade on devnet preserves program/config identity and executable status.
- [ ] A root from a real Meta-extracted 004 session is confirmed on devnet; read it back and independently reproduce root/proof from private stored records. Tamper verification fails. Offline fixtures alone cannot satisfy the live criterion.
- [ ] Report actual signatures/explorer links, runtime signer public key, program/IDL revision and confirmed root/epoch; no secret or raw memory content in evidence.

## Verification

Use the pinned build environment documented in programs/soulbound/BUILD.md. These are required commands inside that environment, not a claim the current Mac wrapper works:
```bash
cd programs/soulbound
anchor build
cargo test -p tests -- --nocapture --test-threads=1
```
Do not substitute anchor test --skip-local-validator: it does not run the documented LiteSVM suite.

From repo root, with app dev stopped before full Next build:
```bash
env -u NODE_ENV pnpm build
node --test agent/scripts/committer.test.mjs agent/scripts/memory.test.mjs agent/scripts/tts-core.test.mjs agent/scripts/tts-provider.test.mjs agent/scripts/pipeline-tts.test.mjs agent/scripts/live-latency-report.test.mjs
node --env-file=agent/.env agent/scripts/commit-memory-root.mjs --epoch 0 --dry-run
```
The CLI reads explicit configured namespace/store/RPC/program/key references; missing settings fail visibly. Implement and document all flags, do not assume existing commands.

Only after approval, verified live memory and authority checks:
```bash
node --env-file=agent/.env agent/scripts/commit-memory-root.mjs --epoch 0 --send
```
Use the actual eligible sealed epoch if epoch 0 is not the intended batch; never silently alter identity/epoch. Verify by RPC readback and proof recomputation. No signing/deploy occurs during offline verification.

## Handoff

Doer reports prerequisite state, files, commands/results, exact transaction plan and blockers. Do not edit audit/ or claim independent PASS; Tolu supplies redacted session evidence and AdaL verifies separately. No commit marked complete while required live evidence is missing. Ticket 005 does not complete conversational recall; schedule that explicitly before the demo's cross-session recall claim.
