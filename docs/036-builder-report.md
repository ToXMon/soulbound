# Ticket 036 — Demo conversation reliability

**Date:** 2026-11-02
**POC:** Tolu Shekoni
**Builder identity:** pi (pi CLI, DeepSeek-v4-flash via surplus routing — interim doer while Muse Code is unavailable, ratified per SOULBOUND.md §9)
**TL;DR:** Implemented job-scoped `SessionContext` with bounded turns/chars, owner-only isolation, and message-role preservation. Threaded session history through `conversationMessages()` → `StreamCallbacks` → `pipeline.ts` via `RunTurnOptions`. Wrote 19 new tests covering conversation context (AC1/AC2), async failure isolation (AC4), and overlapping-turn cancellation safety (AC5). All 70 tests (51 existing + 19 new) pass green.

## Files changed

| File | Change |
| --- | --- |
| `agent/src/session-context.ts` | **New.** `SessionContext` class: per-room-job bounded context, 20-turn / 8000-char defaults, per-message 2000-char truncation, owner-only gate, reset on job end. |
| `agent/src/decide.ts` | Modified `conversationMessages()` to accept optional `sessionHistory: SessionMessage[]` and inject prior pairs between system and current user. Added `sessionHistory` to `StreamCallbacks` and `decide()` parameter. |
| `agent/src/pipeline.ts` | Added `sessionHistory` to `RunTurnOptions` and passes it through to `streamReply()`. |
| `agent/src/index.ts` | Creates `SessionContext` per room job (in `entry()`). Passes `sessionCtx.getMessages()` to `runTurn()`. Appends completed turns via `sessionCtx.append()`. Resets on shutdown. |
| `agent/scripts/036-context.test.mjs` | **New.** 11 tests: conversation messages shape, prior-pair injection, SessionContext bounded turns/chars/message limits, reset, owner-only stranger gate, role preservation, defaults. |
| `agent/scripts/036-lifecycle.test.mjs` | **New.** 8 tests: Spark failure propagation (AC4), second-turn independence after failure, TTS crash text preservation, hanging-stream cancellation isolation, stale cancellation safety (AC5), fresh-AbortController isolation, overlapping-turn concurrency, cancelled-turn sink cleanliness. |
| `docs/036-builder-report.md` | This file. |

## Evidence

### Green: all AC tests pass

```sh
node --test agent/scripts/036-context.test.mjs agent/scripts/036-lifecycle.test.mjs
# → 19 tests, 0 failures
```

Key green assertions:

- **AC1:** `conversationMessages(turn, "owner", history)` returns `[system, prior-user, prior-assistant, current-user]` — 4 messages, correct roles, correct content.
- **AC2:** `SessionContext` caps at `maxTurns=3` (6 messages), evicts oldest pairs first, enforces `maxChars=100` budget, truncates per-message at `maxMessageChars=10`, resets cleanly, drops stranger turns after owner context locked, preserves user/assistant roles.
- **AC4:** First Spark `Error("Spark endpoint unreachable")` propagates as caught exception; second turn with fresh signal processes independently; TTS `Error("TTS provider crashed")` preserves text reply and reports `status: "failed"`.
- **AC5:** Pre-cancelled turn shows `tts.status: "cancelled"`, publishes zero audio to sink; stale old-AbortController abort does not prevent new turn; fresh-AbortController-per-turn pattern fully isolates failures; concurrent cancellation race produces clean cancellation with independent subsequent turn.

### Red-before evidence (absent prior context)

Before this change, `conversationMessages()` **always** returned exactly `[system, user]` — no prior assistant/user pairs between consecutive turns. This is demonstrated by:

```
test("[AC1] conversationMessages shape reflects sessionHistory parameter"):
  // First turn: [system, user] — length 2 ✓
  // Second turn: [system, user] — length 2 ✓ (NO prior context)
```

The fix is that `index.ts` now passes `sessionCtx.getMessages()` through the pipeline, and `conversationMessages()` injects them. The RED behavior (absent context) is preserved as the no-session-history baseline.

### Live-unverified (explicitly separated)

- The session history fix **enables** conversational follow-up in the pipeline, but does NOT prove the live model (Spark 1.3 via Meta API) produces coherent multi-turn dialogue — that is a live-inference verification that cannot be done in these offline-harness tests.
- The AC4 tests prove Spark **failure** isolation (second turn processes after first fails), but do NOT prove the live silence-after-first-turn root cause — that diagnosis requires live Room/WS/Spark integration testing which was not performed (no network calls per ticket constraints).

## Remaining live gates

1. **Live multi-turn coherence:** deploy and run a 3+ turn conversation through the actual LiveKit → Muse VT → Spark → VoxCPM2 path. Verify the second and third turns reference earlier user statements.
2. **First-turn silence root cause:** test with live Spark and TTS endpoints to reproduce the owner-reported silence. This implementation isolates failure/cancellation but the actual silence cause may be in LiveKit transport, VT diarization, or Spark config rather than the (now-fixed) context gap.
3. **Overlapping-turn audio quality:** with live TTS, verify that cancelled-turn partial audio is not audible or is properly flushed before new-turn audio starts.
4. **Session cleanup on disconnect:** verify `SessionContext.reset()` is triggered on participant disconnect and a new session starts fresh on reconnect.
