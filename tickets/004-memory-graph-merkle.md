# Ticket 004: memory-graph-merkle

**Intent:** The character's past becomes structured and provable. Build the off-chain memory graph (versioned episodic records — supersede, never delete), Spark structured-output extraction that turns session turns into memory records, and the Merkle batcher that produces an epoch root ready for on-chain commit. This ticket is off-chain only; Ticket 005 puts roots on-chain.

**Implements REQs:** REQ-50, REQ-51 (proof generation side), REQ-52 (tamper detection side)

**Files in scope:** `agent/memory/` (new), `agent/memory/merkle.ts` (new), `agent/brain.ts` (extraction hook only), `docs/memory-schema.md` (new)

**Non-goals:** on-chain commits, dream cycle, UI, embeddings/vector search (v2 — note as TODO).

**Constraints:**
- Load `meta-model-api` skill: extraction = Spark structured output, versioned JSON schema, never parse free text.
- Record shape (v1): `{ id, character_id, epoch, timestamp, type, content_hash, summary, trait_delta?, provenance { turn_ids, frame_hash? }, confidence, supersedes?, version }`.
- Merkle: sorted-pair keccak256 leaves over canonical JSON hashes; proof = sibling path; deterministic recompute from stored leaves.
- Corrections create a new record with `supersedes` — nothing is deleted.

**Acceptance criteria (each observable):**
- [ ] 3-turn scripted conversation → ≥1 extraction call → valid schema records written (REQ-50 path)
- [ ] Correction turn produces v2 record with `supersedes` set; v1 retained (REQ-50)
- [ ] `merkle.ts` builds root from N records; inclusion proof verifies; flipping one byte fails verification (REQ-51/52)
- [ ] `docs/memory-schema.md` documents the schema + root recomputation procedure

**Verification:**
```bash
node agent/scripts/memory-demo.ts --out audit/004-memory-graph-merkle/verify.txt
```

**Evidence:** `audit/004-memory-graph-merkle/`

---
*Refresh before execution: confirm against actual 001–003 state.*
