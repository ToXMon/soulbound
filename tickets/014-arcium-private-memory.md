# Ticket 014: arcium-private-memory

**Intent:** The character's memories become checkable without being readable. A judge poses a yes/no question about a memory's content; an Arcium MXE computes the answer over encrypted memory shares (no single node — and not even our backend — sees plaintext), and the signed result lands on-chain via callback, linked to the memory epoch and Merkle root. This upgrades the demo from "a childhood you can audit" to "a childhood you can audit without reading the diary." Ratified MUST-HAVE by Tolu 2026-10-28.

**Implements REQs:** REQ-53, REQ-54, REQ-55 (new UC-7). Depends on: Ticket 004 (memory records) and 005 (`commit_memory_root`) — blocked by both.

**Files in scope:**
- `programs/soulbound/` (challenge-result account + callback instruction)
- `agent/mx/` (Arcis computation definitions + MXE config + challenge client)
- `docs/arcium.md` (new — network status observed, cluster, fees, MXE program IDs, reproduction)
- `tests/` (MXE mock/fake for offline suite + live-path integration test gated on network availability)

**Non-goals:** encrypted voiceprint (A2), encrypted dream aggregation (A3), confidential LLM inference inside MXE (model purity — hard violation), anything Base/x402.

**Constraints:**
- **Day-0 spike inside this ticket:** verify Arcium network status (testnet/mainnet-beta), cluster availability, and real fee for one computation BEFORE writing the integration; record observations in `docs/arcium.md`. If the network cannot demonstrate one end-to-end challenge reliably, STOP and report — the ticket downgrades to a documented stretch (Tolu decides), not a silent fake.
- Arcis (Anchor-compatible) for computations; reuse the docker runner pattern from `programs/soulbound/BUILD.md`.
- Failure semantics per REQ-55: MXE aborts must surface as loud errors; no result is better than a wrong result.
- Offline test suite must pass with a deterministic MXE fake; the live MXE path is verified separately and labelled.

**Acceptance criteria (each observable):**
- [ ] `docs/arcium.md` records observed network status + one real fee quote for a challenge computation
- [ ] Offline: challenge over a tampered memory fails loudly (REQ-55); challenge over intact memory returns signed true (fake MXE)
- [ ] Live: one end-to-end challenge on real cluster — callback lands on devnet, result account links epoch + root (REQ-53/54)
- [ ] Plaintext audit: grep proves no memory content appears in any account data, callback payload, or log line (REQ-53)
- [ ] explorer link to a challenge-result account in `docs/arcium.md`

**Verification (exact commands AdaL will run):**
```bash
cd programs/soulbound && cargo test -p tests -- --test-threads=1          # offline incl. REQ-55
grep -ri "<memory-content-marker>" target/deploy/*.json agent/mx/ || echo CLEAN   # REQ-53 plaintext audit
curl getAccountInfo <challenge-result-pda>                                # REQ-54 live
```

**Evidence:** `audit/014-arcium-private-memory/{doer-session.log, review.md, verify.txt}`
