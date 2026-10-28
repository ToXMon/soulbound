# Review — Ticket 001 (parent): FINAL VERDICT

**Verdict: PASS** · Closed by AdaL (thinker) 2026-10-28 · Doers: Muse Code (001 body), pi+Muse Code fix rounds (016–018) · Verified on Tolu's Mac, Safari.

## The full path to PASS
- Round 1 FAIL: invented VT protocol (audit review F1) → Ticket 016 fixed (PASS).
- Mac portability: 017 (fileURLToPath + cast), 018 (track-discovery race: handler registered pre-connect + late discovery) — glass-break exceptions logged in §9.
- Environment fixes shipped along the way: ErrorEvent polyfill (Node 22), MODEL_API_KEY fallback in decide.ts, frozen-lockfile drift elimination, local LiveKit dev server as the demo/test topology.

## Acceptance criteria — final state (observed)
| # | Criterion | Observed |
|---|---|---|
| 1 | pnpm dev connected state | ✅ Tolu's Mac, Safari, live room join |
| 2 | Diarized transcript line (Muse VT, not mock) | ✅ owner speech transcribed live |
| 3 | Spark reply renders (real api.meta.ai call) | ✅ real muse-spark-1.3 replies (also 20/20 in harness) |
| 4 | Ambiguity → stranger greeting (REQ-42) | ✅ speaker-B stranger path (harness + live) |
| 5 | 20-turn latency harness logs | ✅ verify.txt (decide-only labeled; REQ-40 live-mic bar moves to 003/011 per plan) |
| 6 | built-vs-borrowed doc | ✅ |
| 7 | Owner Mac mic round-trip | ✅ **live conversation held** (Tolu + Soulbound, Safari) |

## Day-2 beat status
"Hello, I'm alive" is REAL: voice in → diarized → Spark → reply, on the owner's Mac, with the genesis character minted on devnet (Ticket 002).

## Known non-blockers carried forward
- Brave blocks mic/WebRTC (privacy shields) — demo runbook: Safari/Chrome.
- LiveKit Cloud 401 from the Mac network — local dev server is the demo topology; revisit cloud for multi-party demo day.
- muse-session exports for 016–018 pending Tolu (commit trailers reference them).
