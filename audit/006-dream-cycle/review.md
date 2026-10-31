# Ticket 006 review — dream-cycle

Reviewer: AdaL (thinker/verifier), 2026-10-31. Observed evidence: `verify.txt`
(all commands executed by the reviewer in the pinned sb-anchor:1.2.1 image;
chain reads via public RPC). Doer evidence: pi session logs and receipts in this
folder (62 files), honest closeout claims in commit `553de2f`.

## Verdict: PASS — with two scope items explicitly deferred (recorded, not hidden)

All engineering acceptance criteria are met. Two demo-facing items are deferred
by Tolu's own closeout authorization and are labeled here so no one later
mistakes them for verified: (1) scheduled execution (dream.cron shipped, not
activated — server scheduling deferred), (2) a live *nonempty* trait mutation
on devnet (the real Wonder run proposed no changes, so no trait transaction was
signed; consequently **no DreamState provenance account exists on devnet** —
reviewer re-check 2026-10-31: zero 89-byte accounts owned by the program.
Provenance storage is verified in LiteSVM only. The program upgrade itself IS
live and reviewer-verified bit-for-bit). Both are Day-5/Demo-day actions, not
defects.

## Criteria → evidence

| Criterion | Verdict | Evidence |
|---|---|---|
| Cron fires → journal written | DEFERRED | dream.cron + run-once.ts shipped; scheduling deferred by Tolu; journal format proven via fixture + real direct-Meta run (pi-real-direct-meta-journal-metadata.json) |
| Trait proposal → evolve_traits on devnet → explorer shows change | PARTIAL | Program upgrade live on devnet (reviewer: ProgramData hash matches local build bit-for-bit). **DreamState provenance account is NOT on devnet** (reviewer re-check 2026-10-31: zero 89-byte accounts owned by the program) — provenance storage is verified in LiteSVM only. A live trait transaction remains a Day-5 demo beat. |
| Direct mutation by owner fails (REQ-21) | PASS | LiteSVM: owner UpdatePluginV1 → Custom(26) NoApprovals (update authority = config PDA); evolve_traits without runtime signer → Custom(3010), state atomic |
| LiteSVM: non-oracle signer rejected; journal hash stored (REQ-22/20/04) | PASS | 10/10 tests green in reviewer's own run; success path re-reads full attribute list, stores journal hash + revision, decodes TraitsEvolved |
| Model purity | PASS | muse-spark-1.3 + Muse Wonder only; Baseten swap to direct Meta approved by Tolu, recorded |
| REQ-04 oracle gate resolution honored | PASS | implemented as program-level gate bound to runtime signer per 2026-10-30 thinker ruling; no mpl-core Oracle plugin; no genesis migration (config stays 154 bytes, asserted in test) |
| One ticket = one commit, no secrets | PASS | commit 553de2f scoped to 005's follow-ons + 006; secret scan clean |

## Thinker ruling incorporated (2026-10-30)

Core's UpdatePluginV1 does not invoke Oracle lifecycle validation, so REQ-04's
"Oracle plugin" wording was implemented as a program-level gate: the config PDA
is the asset's update authority (set at genesis), and `evolve_traits` requires
the runtime signer before CPIing UpdatePluginV1. Non-oracle mutation is
rejected twice over (PDA authority + runtime-signer check). **Tolu action
pending:** ratify the REQ-04 wording amendment ("Oracle gate (program-level,
bound to the runtime signer)") — only Tolu edits REQ tables; decision-log entry
to be appended at closure.

## Open items (carried)

1. VPS deployer-key exposure remediation (005, approval-gated) — still unperformed.
2. Stray local keypair `programs/soulbound/target/deploy/soulbound-keypair.json`
   (pubkey 7VRcVdv… ≠ program ID) — delete or replace; never `anchor keys sync`.
3. REQ-04 wording ratification + SOULBOUND.md state/decision-log updates at closure.
4. Demo-day: activate scheduler, run the live dream → visible trait mutation beat.
