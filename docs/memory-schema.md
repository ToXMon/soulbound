# Memory schema, hashing and proof protocol (Ticket 004)

Freeze date: 2026-10-29. Ticket 005 consumes this protocol exactly. This ticket proves **off-chain integrity/inclusion only** — no on-chain inclusion, conversational recall, or authentication is claimed.

## Record v1

Stored record (JSON):

```json
{ "schema_version": 1, "id": "uuid", "character_id": "…", "epoch": 0,
  "timestamp": "ISO-8601", "type": "fact|preference|event|correction",
  "content_hash": "hex64", "summary": "≤500 chars", "trait_delta": {"key": 0.0},
  "provenance": { "turn_ids": ["session:1"], "frame_hash": "hex64?" },
  "confidence": 0.0, "supersedes": "prior-id?", "version": 1 }
```

- `schema_version` is the envelope/schema version. `version` is the record revision: `1` for a new record, `prior.version + 1` for a correction. Corrections append a new record with `supersedes` pointing at a prior record **in the same namespace**; the superseded record is retained byte-for-byte, never deleted (REQ-50).
- The server assigns `id`, `character_id`, `epoch`, `timestamp`, `version` and `content_hash`. Model output supplying ownership/storage metadata, unknown fields, out-of-range confidence (`[0,1]`), oversize summaries, `trait_delta` values outside `[-1,1]` (max 8 keys), or provenance referencing unsubmitted turn ids is rejected. Spark may return zero memories; none are fabricated.
- Extraction uses the OpenAI SDK against non-contributor `muse-spark-1.3` with the versioned JSON schema `soulbound_memory_extraction_v1` (`response_format: json_schema, strict`). No free-text/regex fallback. Turn text is untrusted data, never instructions. Only a bounded slice (≤2000 chars per side, ≤10 items out) is sent.

## Storage and identity/privacy limits

- Opt-in only: `MEMORY_ENABLED=true` requires `MEMORY_STORE_PATH`, `MEMORY_OWNER_ID` and `MEMORY_CHARACTER_ID`; missing/invalid identity at startup is a configuration error. Disabled preserves the existing voice loop.
- Layout: `<store>/<keccak256(owner_id + "\n" + character_id)>/store.json`. The opaque hashed directory name means identifiers are validated (`^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$`) and cannot traverse the filesystem. Two namespaces cannot read, correct or overwrite each other; the API always requires a namespace, so Ticket 020 can later supply an authenticated character binding.
- **Limitations:** this supports Tolu's configured demo character, not verified arbitrary judge wallets. Automatic extraction runs only on owner-classified turns; diarization speaker classification is a heuristic, not authenticated ownership. No retrieval/disclosure is introduced, so no memory can leak to strangers through this ticket. No raw audio or full transcript is persisted; only structured summaries (which may still be personal — keep the store local/private, mode `0600` files under a `0700` dir, never commit it).
- Writes are serialized per store and atomic (write tmp, fsync, rename). Completed records are persisted before a job is acknowledged. Corrupt JSON, hash-mismatched records or root-mismatched manifests throw on open; history is never silently overwritten or reset. Orphan tmp files from interrupted writes are ignored. Pending queue jobs are **not** crash-durable.
- **Single writer per namespace (cross-process):** opening a store takes an `O_EXCL` writer lock (`writer.lock`, holder pid recorded) for the store's lifetime; `close()` releases it after the shutdown drain. A competing instance or process is rejected loudly — an instance-local promise chain alone is *not* claimed as locking. If the holding pid is dead (crash/kill), the stale lock is removed and a new writer recovers; the recovered writer revalidates the whole store before writing.

## Source IDs and job flow

- Each worker session gets a random `sessionId`; source turns are `${sessionId}:${seq}` assigned in publication order, independent of Ticket 019 diagnostic IDs. Snapshots are immutable and enqueued only **after** the completed turn is published; extraction/storage/hashing are never awaited in the speech or publication path.
- One extraction job in flight per namespace, bounded queue (default capacity 16). Overflow increments `droppedOverflow` and reports an error — work is never silently lost or unboundedly retried. Per-job timeout defaults to 30s. Job idempotency key: `turn:<source-turn-id>`; replaying a flush/job never appends duplicates.
- On shutdown the worker attempts a bounded 5s drain and logs completed/failed/dropped/pending counts. Memory failures are logged separately from voice errors and never lose the text or audible reply. Stage durations are logged without content. Async extraction still shares Spark API capacity with conversation, so zero latency impact is **not** claimed.

## Hash and Merkle contract (frozen for Ticket 005)

- Hash: **Keccak-256** (via `js-sha3`), not Node `sha3-256`.
- Canonical JSON: object keys sorted recursively, UTF-8, only string/number/boolean/null/array/object primitives. `undefined`, non-finite numbers and other types are rejected. No text normalization — committed strings hash exactly as supplied.
- `content_hash = keccak256(canonical_json(record excluding content_hash))`, lowercase hex. The Merkle **leaf is the raw 32-byte `content_hash`**.
- Root building: sort leaf bytes ascending (`Buffer.compare`); duplicate hashes remain separate leaves. Internal node: lexicographically sort the two 32-byte children, concatenate raw bytes, Keccak-256. Odd level: duplicate the last node. Single leaf: root equals that leaf. Empty batch: **no root** (nothing committable).
- Epoch seal: all records in the open epoch are sealed into an immutable manifest `{ schema_version: 1, algorithm: "keccak256", record_schema_version: 1, epoch, character_id, record_ids, leaf_hashes, root, sealed_at }`, where `record_ids`/`leaf_hashes` are in sorted-leaf order. The next record (including late corrections to sealed records) enters a new epoch; sealed manifests never change and are re-validated on every open.
- Proof: sibling hashes bottom-up over the sorted leaf list (odd duplication implicit). Verification recomputes `content_hash` from the supplied record bytes, requires that hash to be the proven leaf and a manifest member, then recomputes the root. Changing any committed field fails verification loudly (REQ-52). A root proves integrity/inclusion, **not** truth of the model's summary.
- Proof metadata limits (added in the 004 review fix): verification strictly validates hash encodings, `leafIndex`/`leafCount` ranges, exact proof depth for the stated count, and odd-level duplication siblings. However, because pair hashing is sorted (commutative), a valid proof authenticates **membership only** — it does not cryptographically authenticate a unique leaf position or the total leaf count merely because `leafIndex`/`leafCount` are supplied and consistent. The authoritative order and count come from the sealed manifest, which is validated end-to-end (schema, sequential epochs `0..n-1` with `next_epoch == manifest count`, and exact same-epoch record-ID/leaf alignment) on every open and before any proof is generated or verified. Corruption fails visibly; the store file is never rewritten to repair it.

## Ticket 005 handoff

Ticket 005 commits `manifest.root` (with `epoch` and `character_id`) via `commit_memory_root`. It must reproduce canonical JSON, `content_hash`, leaf sorting, pair hashing and odd-duplication exactly as above; manifests on disk are the source of the ordered leaf set for proof generation.

### Ticket 005 chain handoff (not a change to the hash protocol)

`agent/scripts/commit-memory-root.mjs` is an explicit, separate operator process;
there is no RPC, committer import or scheduler in the voice worker. Stop the
worker and inspect shutdown extraction counters first. Only a fully settled
queue with zero failed/dropped/pending jobs may be described as a complete
session. Failed/interrupted jobs are not durable and require explicit replay;
sealing cannot discover or repair jobs that were never persisted.

Configure the **actual owner public key** and **canonical decimal u64 character
ID** before a real session. Existing aliases such as `char-elder` are rejected;
never rewrite sealed records or guess an alias mapping. Seal explicitly with
`--seal --session-settled` (operator attestation, not an automated completeness
proof), then run `--epoch <actual sealed epoch> --dry-run`. Opening the store
reuses 004's exclusive namespace lock and validates all manifests/record bytes;
the committer rechecks record hashes and manifest proofs before preparation.

`manifest.root` is decoded from exactly 64 hex characters to exactly 32 bytes,
never hashed as text. Epoch zero stays zero. Config PDA seeds stay
`[b"character", owner bytes, character_id u64 LE]`; history seeds are
`[b"memory_roots", config PDA bytes]` under the same program. Public chain state
contains only roots/epochs/timestamps and config identity. Private summaries,
provenance and the submission journal remain local. Inclusion is not truth,
data availability, or proof that every conversation was extracted. See
`docs/005-committer-runbook.md` for approvals, recovery and proof readback.

## Failure handling summary

| Failure | Behavior |
| --- | --- |
| Memory disabled | Voice loop unchanged |
| Enabled, identity missing | Startup throws (configuration error) |
| Extraction malformed/timeout/fails | Job counted failed, logged without content; voice turn unaffected |
| Queue full | Enqueue refused, `droppedOverflow` counted, error reported |
| Corrupt store / tampered record | Open/verify fails loudly; nothing overwritten |
| Shutdown with pending jobs | Bounded drain attempted; incomplete jobs reported, not claimed durable |

## Ticket 021 recall selection contract (append-only; protocol unchanged)

Recall receives the existing live store's read views from `index.ts`; it never
opens, closes, creates, seals or writes storage. Shutdown unbinds the reference.
No path lookup, chain read, model call, embedding service or external index is
part of retrieval. Unbound/nonexistent storage is an empty result without IO.

Recall requires memory enabled, recall not explicitly disabled, and an
owner-classified turn. Diarization remains a heuristic, not authentication;
this is not an arbitrary-wallet privacy boundary. Only sealed-manifest member
records qualify, so each injected ID has a local inclusion proof via 004's
`proofFor`/`verifyRecord` API. Unsealed records are not injected; any superseded
record is excluded even if its correction is still unsealed. Sealing remains
an explicit operator action outside this ticket. A local seal is NOT evidence
of an on-chain commit; compare its epoch/root through the separate 015 verify
path before claiming committed inclusion. Recall performs no on-chain check.

The query representation is a lowercase set of Unicode letter/number terms,
excluding one-character terms and the fixed conversational stopwords in
`retrieval.ts`. Summary terms use the identical transform; no stemming or
semantic matching is claimed. Zero overlap is a miss. Ranking is descending:
`100 * shared_terms / query_terms + 1 / (1 + age_days) + epoch / (1 + epoch)`.
Age is nonnegative elapsed days against an explicit clock input. Ties use
ascending record ID (code-unit comparison), independent of store order.

Selection walks ranked records, skipping a record entirely if it cannot fit,
until top_k is reached. The character count is JavaScript UTF-16 string length
and includes the framing, JSON escaping, newline separators, full summaries,
record IDs, epochs and content hashes. No record is sliced. Default top_k is 3
(maximum 10); default cap is 1800 with a hard ceiling of 4000. Zero disables
injection. Invalid numeric knobs yield no context. Empty/miss/disabled/unbound
results append nothing, log nothing and preserve the original prompt.

Both Spark call variants share `conversationMessages`. The stable persona
prefix stays first; bounded recalled JSON data follows with an explicit
not-instructions warning. Summaries remain untrusted data (not guaranteed true,
nor immune to model prompt injection). Only injected IDs are logged, never
summaries or transcripts. Deterministic offline tests are self-checks, not
independent verification or evidence of live owner-voice cross-session recall.
