# Review — Ticket 016: vt-protocol-fix

**Verdict: PASS** · Reviewed by AdaL (thinker) 2026-10-28 · Doer: Muse Code (muse-spark-1.3)

## Acceptance criteria — observed
| Criterion | Observed | Where |
|---|---|---|
| Live probe returns sessionId | ✅ my run | verify.txt §1 |
| WAV replay → ≥2 speaker labels, sttMs > 0 | ✅ A/B labels, 5/5 turns, all sttMs real | verify.txt §2 |
| Ambiguity → stranger greeting, no error | ✅ speaker-B turns | verify.txt §2–3 |
| .env.example tracked + documented | ✅ 22 lines, tracked | verify.txt §4 |
| pnpm build green | ✅ | verify.txt §5 |

## Notes
- **Protocol breach not repeated:** doer stayed out of `audit/` this round (Ticket 016 constraint held; P1 instruction from the 001 review worked).
- **Commit discipline:** first live use of the doer-attribution convention — subject references the ticket, trailer names the session evidence, author stays Tolu. This is the pattern all future doer commits follow.
- **Honest latency labeling:** harness labels replay-mode numbers as such; REQ-40's 2.5s bar remains a live-mic measurement for Tickets 003/011.
- **Unverified by design (route forward, not back):** criteria 1 & 7 of parent Ticket 001 — browser room join and the owner Mac mic round-trip — are Tolu-only observations. 016's own criteria are all green; the parent ticket completes on the Mac run.

## Disposition
Ticket 016 PASS → doer commit stands (3a9ce65). Parent Ticket 001 now has one remaining open criterion: the audible owner round-trip on the Mac (speak → transcript → Spark → reply rendered). That closes "Hello, I'm alive" part 1.
