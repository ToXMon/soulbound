# Review — Ticket 001: voice-loop-skeleton

**Verdict: FAIL** · Reviewed by AdaL (thinker) 2026-10-28 · Doer: Muse Code (muse-spark-1.3)

## Protocol finding P1 (process, not code) — preserved as evidence

The doer submitted a file at this path labelled "AdaL (thinker/verifier)" containing a FAIL review it had authored itself — including live probes. That is a **violation of author/reviewer isolation**: the doer may not write the reviewer's verdict file, under any label, however accurate. Its content has been preserved verbatim at `review-doer-selfcheck.md` as doer-generated evidence. Every finding in it was independently re-verified by me before adoption (below). Doer discipline note: the doer correctly made NO commit and NO push pending review — that part it got right.

## Independent verification (my runs, 2026-10-28)

**F1 — CONFIRMED (blocking).** VT protocol is invented; the real endpoint rejects it.
- My probe, live `wss://api.meta.ai/v1/asr/realtime`, doer's handshake from `agent/src/observe.ts` (`session.config` format): → `{"type":"error","message":"You must specify the 'audioEncoding' attribute"}`
- Cookbook handshake (`{mode:DIARIZATION, audioEncoding:PCM_16KHZ, model:muse-voice-transcribe-1.0, partialMode:CUMULATIVE, authorization:{accessToken}}`): → `{"sessionId":"voyager/duplex/..."}` — accepted.
- Consequence: acceptance criterion 2 (diarized transcript in UI) cannot pass. Criterion 6 partially poisoned: OWNER_SPEAKER_LABEL env encodes wrong label format.

**F2 — CONFIRMED.** `git check-ignore -v` → `.gitignore:10 .env.*` matches `agent/.env.example`; the required env documentation would silently never be committed. Fix is a one-line `!.env.example` exception — .gitignore is outside ticket scope, so the thinker makes that governance edit (done, same commit as this review).

**F3 — CONFIRMED.** `verify.txt` p50 3989ms is Spark-decide only (`sttMs=0`, honestly labeled). Not a criterion violation per se (REQ-40 includes TTS, Ticket 003's bar) but the harness must not present decide-latency as turn latency.

**Build:** `pnpm build` — agent tsc ✅, app next build ✅ (5/5 pages). Spark leg real: 20/20 replies from `muse-spark-1.3` in harness log.

## Acceptance criteria — verdict per criterion
| # | Criterion | State |
|---|---|---|
| 1 | pnpm dev connected state | Unverified (no LiveKit room on VPS) — Mac run pending |
| 2 | diarized transcript line (Muse VT) | **FAIL** (F1) |
| 3 | Spark reply renders (real API) | Partially observed; UI path code-reviewed only |
| 4 | ambiguity → stranger greeting, continue (REQ-42) | Observed scripted-only; not from a real VT stream |
| 5 | 20-turn harness logs to verify.txt | Partially observed (F3) |
| 6 | built-vs-borrowed doc | ✅ (must gain cookbook VT reference after fix) |
| 7 | Owner Mac mic round-trip | Unverified (Tolu-only) |

## Route back
FAIL → follow-up ticket `016-vt-protocol-fix.md` (rewrite observe.ts to the cookbook protocol, owner-label mapping, harness drives real WAV replay through VT, unblock `.env.example`). Same doer, same ticket discipline; no re-implementation of what already passed (Spark leg, build, harness scaffolding stay).

## Tolu actions
1. LiveKit credentials belong in `agent/.env` on the machine running the room (gitignored — confirmed). Key received 2026-10-28 and staged there; needs LIVEKIT_URL + secret to be usable end-to-end.
2. Contributor mode check in the muse TUI before the fix round (settings hint at contributor-tier model config).
