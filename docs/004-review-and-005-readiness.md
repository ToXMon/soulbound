# Ticket 004 review and Ticket 005 readiness

Date: 2026-10-29
Reviewer: AdaL
TL;DR: Offline implementation works, but root anchoring is blocked on manifest validation and proof-contract fixes. This report is not a completed audit package.

## Observed verification

Reviewed local implementation commit `2d3c982`. At review time origin/main remained `5e38540`; 004 was local, not yet pushed. Local specification edits and unrelated files were preserved.

Executed:
- `pnpm --dir agent build`: passed.
- Combined memory, TTS core/provider/pipeline and latency tests: 37 passed, 0 failed (11 memory tests plus 26 existing tests).
- Offline memory demo with fresh temporary storage: 3 records, revisions 1/1/2, epoch 0, proof verified, tamper rejected, persistence across reopen observed. This uses a fake extractor and is not live Meta inference evidence.
- Malformed proof probe: an otherwise valid proof with leafIndex=-10 and leafCount=0 still verified true.

Full app build was not run: the app dev process was active on port 3000. No live Meta calls, paid TTS calls, signing, redeployment or transaction broadcasts were performed. A redacted Muse session export and real extraction evidence were not supplied in this review.

## Findings

### Blocking: sealed manifest validation

`agent/src/memory/store.ts:43-50` checks record hashes and a root recomputed from stored leaf_hashes, but does not cross-check manifest record_ids against the actual same-epoch records/hashes. Manifest schema, epoch uniqueness and next_epoch progression also need validation. A self-consistent root over unrelated leaves can pass reopen checks. Before 005, validate manifests end-to-end and reject corruption without rewriting the file.

`store.ts:121-126` builds record_ids through a hash-keyed Map while the documented protocol retains duplicate leaf hashes. Preserve ordered (record ID, hash) pairs or explicitly reject impossible/ambiguous duplicates with tests; do not collapse mapping multiplicity.

### Blocking contract fix: malformed proof metadata

`agent/src/memory/merkle.ts:65-78` does not validate leafCount/index/depth. The reproduced negative-index/zero-count object passes. Sorted-pair hashes prove membership, not a cryptographically unique index or count. Validate structural metadata, strict 32-byte hex and odd-duplication rules, and explicitly document what remains non-binding. Do not imply root equality authenticates supplied leaf-position metadata.

### Single-writer limitation

`store.ts:28-31,64-75` serializes only within one store object. Two same-namespace instances can overwrite snapshots. Add an enforceable writer exclusion/transactional strategy or reject concurrent writers and test it. An operator convention alone is not multi-worker durability.

### Accepted architectural limitation, not a requirement for Inngest

`queue.ts:43-57` counts failed jobs but discards them; queued/in-flight input is not crash-durable. The schema docs acknowledge this. Do not claim eventual extraction or automatic retry. Completed records persist; unfinished work may need explicit replay. No new workflow platform is required for this review.

### Evidence still open

Real structured extraction/correction, fresh-process rather than same-process reopen, interrupted-write failure recovery and a memory-enabled Mac smoke need evidence. Existing deterministic tests remain useful but do not establish these live results.

## Verdict and handoff

Ticket 004 is not independently PASS on the evidence reviewed. Route the blocking integrity fixes back to the doer as a 004 continuation before the 005 transaction gate. Do not ask Tolu to repeat voice latency benchmarking for this correction.

Ticket 005 must use validated sealed epochs, preserve the Keccak byte protocol, bind owner+numeric character ID to the on-chain config and resolve epoch zero without changing existing accounts. It must reconcile chain state before retrying ambiguous sends. It must not touch TTS configuration or the Akash lease.
