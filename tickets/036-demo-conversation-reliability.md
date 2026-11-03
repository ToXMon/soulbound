# Ticket 036: demo conversation reliability

Date: 2026-11-02
POC: Tolu Shekoni
TL;DR: Restore coherent consecutive conversation and diagnose the owner-reported silence after the first turn. Session context is not a sealed or on-chain memory.

## Intent

Owner requests the planned live memory and on-chain personality-growth demo today and reports the app stops responding after its first turn. Existing code conversationMessages includes only system+sealed recall+latest user message. This cannot support immediate conversational follow-up. Fix that verified context gap; investigate the silence separately without claiming its cause from inspection alone.

Preserve REQ-40/41/42/50/51/52/70 and Ticket 021 owner-only sealed recall. Session history is an ephemeral contextual feature authorized by this request, not a change to REQs or a proof claim.

## Scope

agent/src/decide.ts, agent/src/pipeline.ts, agent/src/index.ts, agent/src/observe.ts; focused new session-context or turn-lifecycle modules and tests; agent/scripts/* tests specific to these changes; docs/036-builder-report.md. No app changes unless reviewer separately approves exact scope.

## Constraints

Use separate pi doer with live-tested surplus/deepseek-v4-flash. Preserve all dirty work. No credentials/env/private-memory reads, network/provider calls, deployments, chain actions, git changes/commits/push/reset/stash, audit/ticket/master/REQ edits. No new dependencies, no model changes, no voice-reference changes. Owner is live: do not interact with room or devices.

## Acceptance

1. Write a failing deterministic test for two sequential turns: first supplies a synthetic fact, second asks a relevant follow-up. Verify the actual Spark request message builder includes prior user AND assistant context in correct order. Mock only external inference; never script actual live answers.
2. Session history belongs to a room job, not a module-global cross-room buffer. Bound turns and total characters; retain complete pairs, enforce per-message limits, reset on job end. Never leak owner recall or prior owner context to stranger-classified turns. Treat prior messages as data in their original roles, not system instructions. No logging transcripts or summaries.
3. Persistent recall remains owner-only and sealed/non-superseded. New session context is NOT durable memory, a root commit, or chain proof. Do not silently seal records or remove the seal eligibility gate.
4. Diagnose first-turn-only silence with a red-capable test at actual turn lifecycle: async callbacks, failure/cancellation, next turn handling. Simulate first Spark request rejection and provider close/error, assert no unhandled rejection and later turn still processes OR a clear sanitized fatal signal is emitted. Do not swallow provider failures and claim healthy service. Do not invent reconnect protocol without evidence.
5. For overlapping turns preserve deliberate supersession and prevent a stale cancelled turn from clearing newer turn audio or publishing a late stale result. Reproduce this concurrency pattern before fixing. Do not queue obsolete speech or disable genuine cancellation.
6. Changes to audio subscription/feed must use installed APIs, avoid duplicate feed of one track and avoid feeding agent audio back into ASR. Only change when a regression demonstrates it. No heuristic silence-gating or fake full duplex.
7. Build and existing tests pass. Add targeted regression commands to report. Clearly separate confirmed cause, hypotheses, tests and live-unverified behavior. No claim that a test of request messages proves the live model remembers.

## Verification

```sh
pnpm --filter agent build
node --test agent/scripts/pipeline-tts.test.mjs agent/scripts/retrieval.test.mjs agent/scripts/tts-provider.test.mjs agent/scripts/tts-core.test.mjs
# Run every new focused test and report exact command.
git diff --check
```

Write docs/036-builder-report.md with date, POC, actual pi/DeepSeek identity, TL;DR, red-before/green-after evidence and remaining live gates. Stop after implementation and report. AdaL independently reviews and runs tests before deploying.
