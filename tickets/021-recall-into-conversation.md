# Ticket 021: recall-into-conversation

**Intent:** The character actually remembers. At voice-turn time, the agent queries the validated Ticket 004 memory store, retrieves the most relevant records for what the user just said, and injects them into the Spark conversation context — so cross-session recall ("I remember what you told me yesterday") happens in live speech, not just on a page. Closes the gap left open by Ticket 005's handoff ("does not complete conversational recall") before any cross-session claim is made in the demo or README.

**Implements:** UC-4 (recall + verify, app backend side), D3 (voice turn + minimal recall = synchronous). **REQ gap:** architecture has no explicit recall-injection REQ; only Tolu may add one (proposed REQ-56 pending ratification — see Constraints).

**Depends on:** Ticket 004 (store API, validated) — consumed as-is, hash protocol untouched. Ticket 005 is NOT a dependency: recall reads the Mac-local store, never the chain.

**Files in scope:**
- `agent/src/memory/retrieval.ts` (new): query embed/rank/top-k over the existing store API
- `agent/src/decide.ts` (or adjacent context-builder): bounded memory-context injection into the Spark system/turn prompt
- `agent/src/index.ts` (authorized adjacency, AdaL 2026-10-31): minimal bind/unbind of the EXISTING live MemoryStore into the retrieval/decide path — index.ts keeps sole ownership of store create/close; recall is strictly read-only (never opens a second instance, never acquires the write lock, never creates files)
- `agent/scripts/retrieval.test.mjs` (new): offline retrieval + injection tests
- `agent/.env.example`: recall tuning knobs (top_k, max context chars) placeholder-only
- `docs/memory-schema.md`: document the recall selection contract (append-only doc section)

**Non-goals:** no vector database or external index (store scan + ranking suffices at demo scale); no on-chain reads in the voice path (roots stay async per 005); no reranking model; no memory WRITES here (extraction path unchanged); no voice/audio changes.

**Constraints:**
- **Latency budget (amended by AdaL 2026-10-31):** the current harness reports *decide-only* latency, not full voice-turn latency — building a voice-turn harness is out of scope here. Measure (a) decide-only p50 delta with recall enabled vs disabled via `node agent/scripts/latency-harness.ts --turns 20`, and (b) direct recall-call timing (p50 of N retrieval calls). Budget: **both < 30 ms**; label the numbers in verify.txt as decide-only + direct recall, noting the full voice-turn delta is deferred to the voice-lane ticket. If over budget, shrink top_k — never block the turn (D3, same spirit as x402's "never gate speech").
- Meta-only in the product path: ranking is deterministic (recency + term overlap + epoch weight), NOT a model call. Spark sees the injected context; no non-Meta model touches memory content (existing Jev carve-out does not extend here).
- **Bound the injection:** hard cap on injected characters per turn; truncate at record boundaries, never mid-record; provenance (record id + epoch) included so any injected memory is verifiable via the 015 Verify path.
- Store API is consumed read-only: no schema, hash, or seal changes (004 protocol stays exact).
- Empty store / recall miss must degrade to today's behavior silently — no invented memories, no placeholder text ("I remember everything" only when records actually say so).
- Claims honesty: until this ticket is verified, README/demo must not claim live cross-session recall.

**Acceptance criteria (each observable):**
- [ ] Two sessions: record A persisted in session 1; in session 2 the user references topic A and the Spark context visibly contains record A's content (log line shows injected record ids)
- [ ] Latency harness: decide-only p50 delta with recall enabled vs disabled < 30 ms AND direct recall-call p50 < 30 ms (all numbers labeled in verify.txt per the 2026-10-31 amendment)
- [ ] Recall miss / empty store → turn proceeds, zero injected context, no error
- [ ] Injection bound respected: oversized store → context capped at record boundary, unit test proves it
- [ ] Existing suites stay green: `node --test` (61 tests) + latency harness regression
- [ ] Provenance in context is machine-checkable: every injected record id exists in the store and its inclusion proof verifies against the committed epoch-0 root

**Verification (exact commands AdaL will run):**
```bash
node --test agent/scripts/retrieval.test.mjs agent/scripts/committer.test.mjs agent/scripts/memory.test.mjs
env -u NODE_ENV pnpm build
node agent/scripts/latency-harness.ts --turns 20        # before/after delta recorded in verify.txt
# live two-session check on the owner Mac, transcript redacted into audit/
```

**Evidence:** `audit/021-recall-into-conversation/{doer-session.log, review.md, verify.txt}`

---
*Refresh before execution.*
