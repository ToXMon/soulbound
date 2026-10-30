# Ticket 004: memory-graph-merkle

Date: 2026-10-29
Owner: Tolu Shekoni
Verifier: AdaL
TL;DR: Add durable versioned memory and deterministic off-chain proofs after completed turns. Preserve the working Ticket 003 voice configuration.

## Intent and authority

Turn completed interactions into structured memory records that survive worker restart, preserve corrections and produce reproducible Merkle roots/proofs. This is off-chain infrastructure for Ticket 005. It does not itself prove inclusion against an on-chain root or implement conversational recall.

Supports REQ-50, REQ-51 proof generation, and REQ-52 tamper detection. Read docs/architecture.md's exact rows. Ticket 003 is owner-accepted for continued development, not a verified latency/voice-lock PASS; see docs/003-working-checkpoint.md.

The old proposed agent/brain.ts hook does not exist. Integrate at the actual completed-turn publication boundary in agent/src/index.ts. The current runTurn in agent/src/pipeline.ts includes spoken output and returns a completed turn record.

## Files in scope

- `agent/src/memory/` (new store, schema validation, extraction, bounded job queue, hashing and Merkle modules).
- `agent/src/index.ts` (minimal post-publication enqueue and shutdown drain).
- `agent/src/act.ts` and `agent/src/pipeline.ts` only if stable non-diagnostic provenance IDs need threading; do not restructure voice execution.
- `agent/scripts/memory-demo.mjs`, `agent/scripts/memory.test.mjs` (new).
- `agent/.env.example` (placeholder-only memory configuration).
- `agent/package.json` and `pnpm-lock.yaml` only if a maintained Keccak implementation is not already available; justify the smallest direct dependency.
- `.gitignore` for private runtime memory storage if needed.
- `docs/memory-schema.md` and `docs/built-vs-borrowed.md`.

Do not modify TTS deployment, app UI, other tickets, architecture REQs, SOULBOUND.md or audit/. Avoid unrelated local files and existing modified Ticket 003.

## Non-goals

No Solana transactions, root committer, Arcium, dream cycle, retrieval/chat recall, embeddings/vector database, judge wallet UI/session authentication, new TTS/model provider, or generalized eval platform. If conversational recall needs another scope, report it clearly; stored memories alone do not mean the character can recall them.

## Identity and privacy

- Memory is opt-in with explicit server-side configuration: enabled flag, private storage path, owner public key and character ID. Missing identity while enabled is a startup/configuration error; disabled memory preserves the current loop.
- Partition records by the configured owner AND character ID. Validate/encode identifiers to prevent path traversal. Diarization speaker labels, room names, transcript instructions and arbitrary browser packets are not durable identity or authorization.
- This ticket supports Tolu's configured demo character, not verified arbitrary judge wallets. Provide a storage API that requires a namespace so Ticket 020 can later supply authenticated character binding.
- Do not disclose owner-private memory to strangers. No retrieval/disclosure is introduced here. Use owner-classified turns only for automatic extraction in this slice; speaker classification is a heuristic, not authenticated ownership. Mark that limitation and require explicit operator opt-in to storage.
- No raw audio or full transcript persistence in the memory store, diagnostics or demo report. Structured summaries may contain personal information: keep them local/private, never add them to Git or send them to contributor-tier models.
- Extraction sends only the bounded relevant turn text to non-contributor Spark. Treat that text as untrusted data, never instructions to execute tools or select file paths/identity.

## Post-turn job flow

1. Assign stable session and source-turn IDs independent of optional Ticket 019 diagnostic IDs. Preserve order and namespace.
2. Publish the completed text turn before enqueueing memory work. Do not await extraction, storage, root computation or chain RPC in the speech/turn publication path.
3. Use a small bounded per-character queue, one extraction job in flight per namespace, bounded input and request timeout. Document overflow behavior and visible failed-job counts; never silently lose work or create unbounded retries.
4. Enqueue immutable snapshots of eligible completed turns. Test the three-turn demo using an explicit flush so batching does not depend on arbitrary sleeps.
5. Handle extraction/storage errors separately from voice errors. On shutdown, attempt a bounded drain and report incomplete jobs; do not claim crash-durable pending jobs unless implemented.
6. Retries/repeated flushes use source-turn/job idempotency keys; do not append duplicate memories. Atomically persist completed records before acknowledging a successful memory job.
7. Memory inference still shares API capacity with conversation. Bound concurrency and input; record stage durations without content. Do not claim zero latency impact solely because the job is asynchronous.

## Extraction and schema

Use the existing OpenAI SDK against Meta Spark, with a versioned structured-output JSON schema. Verify current API support from official Meta documentation or an existing project skill. No free-text/regex fallback or invented structured-output feature. Deterministic tests inject an extraction boundary fake; the live demo must use real Meta inference.

Record v1:
`{ id, character_id, epoch, timestamp, type, content_hash, summary, trait_delta?, provenance: { turn_ids, frame_hash? }, confidence, supersedes?, version }`.

- Server assigns namespace/IDs, timestamp, epoch, version and content_hash; never trust model-generated ownership or storage metadata. Provenance must reference submitted source-turn IDs.
- Define allowed type values, size limits, confidence range, optional trait_delta constraints and rejection of unknown/invalid fields.
- Distinguish schema version from record revision version in the documented envelope.
- Spark may return no memories; never fabricate an item to satisfy a count. The synthetic three-turn live fixture must contain an explicit memorable fact and a correction.
- Corrections append a new record referencing a prior record in the SAME namespace. Version increases, v1 bytes remain retrievable and unchanged. Reject missing/cross-character supersedes targets.
- Persist to a private local store with serialized writes and recoverable/atomic replacement or append protocol. Reopen in a fresh process and validate existing data. Never overwrite corrupt history silently.
- Avoid logging summaries or turn content. Report counts, opaque IDs, errors and hashes only.

## Hash and Merkle contract

Document this before implementation so Ticket 005 can reproduce it exactly:
- Use Keccak-256, not Node sha3-256. Reuse a suitable installed implementation, otherwise add one small maintained direct dependency.
- Define canonical JSON recursively with sorted object keys, UTF-8 encoding and supported primitive values; reject undefined/non-finite/unsupported inputs. State normalization policy rather than silently changing committed text.
- Define content_hash over the canonical record excluding content_hash itself. Define the leaf as the 32-byte content_hash; use it consistently in root building and verification.
- Sort leaf bytes deterministically; define how duplicate hashes are handled. For internal nodes, lexicographically sort the two fixed 32-byte children, concatenate raw bytes and Keccak hash.
- For an odd level, duplicate the last node. Single leaf root equals that leaf. Empty batches produce no committable root.
- Persist an immutable epoch manifest with ordered record IDs, leaf hashes, algorithm/schema version and root. Late records/corrections enter a new epoch; never change a sealed epoch.
- Proof verification recomputes the hash from supplied record bytes and verifies against the manifest root. Changing a committed field must fail loudly. A root proves integrity/inclusion, not truth of the model's summary.

## Acceptance criteria

- [ ] Deterministic three-turn fact/correction fixture causes extraction, schema-valid persistence and a superseding version with v1 retained.
- [ ] An explicitly requested live synthetic three-turn demo performs real non-contributor Spark structured extraction; no personal content in its report.
- [ ] Memory persists across fresh-process reopen; replay/retry is idempotent; corrupt data and interrupted writes are handled visibly.
- [ ] Two namespaces cannot read, correct or overwrite each other's records; traversal/invalid configuration is rejected.
- [ ] Malformed extraction, extra fields, bad confidence/provenance/identity and foreign supersedes references are rejected without breaking a completed voice turn.
- [ ] Queue limits, timeout, overflow and bounded shutdown drain have deterministic tests.
- [ ] Deferred/failed extraction cannot delay audio or turn publication; tests prove publication occurs before extraction settles.
- [ ] Canonical hashing is stable across property insertion order. Empty/single/odd/multiple leaf cases, valid inclusion and tampering fail/pass as specified; sealed manifests survive restart unchanged.
- [ ] Existing Ticket 003/019 deterministic tests pass. Memory disabled preserves the working voice path; memory enabled receives a Mac smoke check when Tolu is available.
- [ ] docs/memory-schema.md describes storage, privacy/identity limits, hashing/proof protocol, source IDs, failure handling, epoch seal procedure and the Ticket 005 handoff.
- [ ] No on-chain inclusion, conversational recall, authentication or full REQ-40/41 PASS is claimed by this ticket.

## Verification

Stop only the identified app dev process before a full Next build to avoid concurrent .next writes. Do not restart/modify the Akash deployment.

```bash
env -u NODE_ENV pnpm build
node --test agent/scripts/memory.test.mjs
node --test agent/scripts/tts-core.test.mjs agent/scripts/tts-provider.test.mjs agent/scripts/pipeline-tts.test.mjs agent/scripts/live-latency-report.test.mjs
node agent/scripts/memory-demo.mjs --offline --store /tmp/soulbound-004-offline
```

Offline demo must reject an existing nonempty destination unless explicitly reopening it; it must never delete an operator's store. Test fixtures/fakes must be clearly labeled and never treated as live inference evidence.

After offline tests, document the exact configuration/command and request one small real Meta extraction test:
```bash
node --env-file=agent/.env agent/scripts/memory-demo.mjs --live --store /tmp/soulbound-004-live
```
Use synthetic public facts, a fresh private destination and configured demo namespace. Live demo invokes real Spark, seals an epoch and verifies a proof, including a deliberate tamper failure. No TTS request, Akash transaction or chain commit is needed. Report model, mode, counts, root and verification result without full input/summary text. Credentials missing or API feature unsupported means BLOCKED, not simulated success.

Do not write under audit/. Deliver commands/results, changed files, limitations and exact next human action. AdaL independently reviews/verifies; Tolu supplies the redacted doer session export for `audit/004-memory-graph-merkle/`. Follow one-ticket commit/attribution rules only when the work is complete. Ticket 005 will consume the frozen manifest protocol; it needs a separate refresh before execution.
