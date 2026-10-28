# Ticket 011: hardening-rehearsal

**Intent:** Demo-day-proof the build. Latency polish pass, kill the weakest feature, record fallback clips for every live beat, and run the two-rehearsal rule: the full 180s storyboard must pass twice consecutively on the record. Also the stretch go/no-go decision point (CCIP/ERC-8004/S3).

**Implements REQs:** REQ-40 final numbers, Q17 two-rehearsal rule (architecture.md §9)

**Files in scope:** `agent/`, `app/` (polish only), `audit/rehearsals/` (new), `docs/cut-list.md` (new)

**Non-goals:** new features. Anything new = automatic FAIL of this ticket's spirit.

**Constraints:**
- Kill list first: name the weakest feature and cut it (Jia Chen: one magical moment > five half-features). Record in `docs/cut-list.md`.
- Fallback clips recorded for beats 1–5 (voice, look-at-this, proof, economics, dream) BEFORE rehearsals.
- Rehearsal = the storyboard script run end-to-end, screen-recorded, latency harness attached.
- Stretch gate: CCIP/ERC-8004 CUT (judge-aligned 2026-10-28). Subagent fanout permitted in this phase for read-only checks only (one child: latency, one: explorer roots, one: paywall receipts) — never core-ticket writers.
- **Prewarm gate (added 2026-10-28):** every live beat starts from a warm path — VoxCPM2 endpoint prewarmed (003 probe), facilitator reachable, MXE/proof path warm. A cold-start failure during rehearsal counts as a rehearsal failure.

**Acceptance criteria (each observable):**
- [ ] (added 2026-10-28) Jev dev-harness judge run over recorded demo traces: in-persona consistency score for every scripted beat recorded to `audit/rehearsals/jev-scores.json`; any beat scoring below the harness threshold is flagged in the review, not silently shipped (REQ-73 adjacent; dev harness — non-Meta model allowed)
- [ ] p50 < 2.5s warm measured on the real path (verify.txt)
- [ ] `docs/cut-list.md` names ≥1 cut
- [ ] Two consecutive clean rehearsal recordings in `audit/rehearsals/`
- [ ] Stretch go/no-go decision logged in SOULBOUND.md §9

**Verification:**
```bash
node agent/scripts/latency-harness.ts --turns 20 --speech --out audit/011-hardening-rehearsal/verify.txt
```

**Evidence:** `audit/011-hardening-rehearsal/`

---
*Refresh before execution.*
