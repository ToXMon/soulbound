# Ticket 006: dream-cycle

**Intent:** The character lives between sessions. A deterministic cron scheduler invokes Muse Wonder to review the memory graph, write a journal entry, and produce a trait proposal; Spark Open (Baseten) does cheap consolidation; the proposal flows through the oracle-gated `evolve_traits` on-chain so judges see traits mutate on the explorer.

**Implements REQs:** REQ-20, REQ-21, REQ-22 (+ REQ-04 oracle plugin from Ticket 002)

**Files in scope:** `programs/soulbound/` (add evolve_traits + oracle gating), `agent/dream/` (new: scheduler, wonder-prompt, consolidator), `docs/dreams.md` (new)

**Non-goals:** autonomous actions beyond trait mutation + journal; scheduling infra beyond cron/systemd timer.

**Constraints:**
- Load `solana-doer` + `meta-model-api` skills. Dream scheduler is **deterministic cron** (D10) — never an agent remembering to run.
- Wonder for the long-horizon review ($4/$20 — dream only, never live turns); Spark Open `muse-spark-open-1026` on Baseten for consolidation.
- `evolve_traits` = fetch-modify-write FULL attribute list (plugin replaces wholesale — verified); store journal hash for provenance (REQ-22).
- Owner and third parties CANNOT mutate traits (REQ-21 test).

**Acceptance criteria (each observable):**
- [ ] Cron fires → journal file written with timestamp + memory references
- [ ] Trait proposal → `evolve_traits` on devnet → explorer shows changed Attributes (before/after links in verify.txt)
- [ ] Direct mutation attempt by owner key fails (REQ-21)
- [ ] LiteSVM: non-oracle signer rejected; journal hash stored (REQ-22)

**Verification:**
```bash
cd programs/soulbound && anchor test --skip-local-validator
node agent/dream/run-once.ts --character genesis --out audit/006-dream-cycle/verify.txt
```

**Evidence:** `audit/006-dream-cycle/`

---
*Refresh before execution.*
