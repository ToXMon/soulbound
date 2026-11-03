# Conversation repair, direct execution

Date: 2026-11-02
POC: Tolu Shekoni
TL;DR: Tolu explicitly authorized AdaL to implement directly in this chat. Author/reviewer isolation is waived for this repair; this is not an independent code review. Five new regressions failed before the repair and passed afterward. Deployment and live conversation acceptance remain separate gates.

## Repairs made here

- Owner-only per-job session history, complete user/assistant pairs, hard character/turn bounds, defensive snapshots and reset on shutdown.
- Actual Spark message builder includes prior session pairs for owner turns and rejects that context for stranger turns even when supplied accidentally.
- Reproduced shared-sink race: a cancelled old synthesis could clear audio already published by a newer reply. The worker now clears once at supersession; an aborted old request cannot clear the shared sink or publish a stale result.
- Async turn callback failures are caught at the transcription boundary. Worker failures emit a sanitized status; recognition disconnects no longer silently look healthy in the UI.
- Browser displays failed-reply and disconnected-recognition statuses with recovery instructions. No invented model response or automatic seal/chain transaction.

The reported stop-after-first-turn symptom is not claimed fully resolved until consecutive live turns are measured. The shared-sink race is a reproduced defect; it is not proof that it caused every reported silence.

## Verification performed

- New five-test defect suite: failed before changes; 5/5 passed after.
- Focused context, local WebSocket lifecycle, cancellation, provider and recall suites: 70/70 passed.
- Complete `node --test agent/scripts/*.test.mjs`: 126 passed, 1 existing skip, 0 failed.
- Agent TypeScript build: passed.
- App TypeScript no-emit check: passed.
- `git diff --check`: passed.

The local WebSocket test injects a rejected first callback, delivers a second turn, and checks an explicit unexpected-close status. It does not call Meta. Tests of context assert actual request-message structure, not a fabricated live memory response.

## Pending release checks

Build and deploy a pinned image preserving character 895354, existing memory store and approved synthetic reference. Run at least three consecutive spoken turns, including immediate sample-fact recall, measuring returned waveform for every reply. Check rejoin, useful vision and persistent recall separately. Follow docs/demo-today.md for the real dream proposal and separately approved trait transaction. No chain mutation is authorized by this repair report.
