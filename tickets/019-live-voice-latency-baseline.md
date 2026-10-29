# Ticket 019: live-voice-latency-baseline

Date: 2026-10-28
Owner: Tolu Shekoni
Verifier: AdaL
TL;DR: Measure the working voice loop before optimizing it. Run this before Ticket 003; keep Ticket 011 for final rehearsal-grade verification.

## Intent

Instrument browser microphone → LiveKit → Muse Voice Transcribe → Spark → visible reply so we can identify the delay Tolu experiences. Ticket 001's functional Mac exchange is confirmed by Tolu; that does not establish REQ-40 performance. The existing decide-only and WAV-replay reports are not warm live-mic response-latency measurements.

This ticket delivers instrumentation, deterministic evaluator tests, a repeatable diagnostic flow, and a baseline. It does not implement TTS or optimize latency.

## Requirements and sequence

- Supports REQ-40 measurement. Its first-audio p50 <2.5s warm target remains authoritative and cannot pass on a text-only baseline.
- Preserve REQ-42 speaker/ambiguity behavior.
- Execute after the working Ticket 018 voice path, before Ticket 003 TTS integration.
- Ticket 003 must extend these measurements to first audible response, with sentence-level TTS pipelining and prewarm. Ticket 011 verifies final latency and rehearsals.
- User-confirmed functionality is not a claim that every Ticket 018 regression test or closing audit already exists.

## Files in scope

- `agent/src/index.ts`, `agent/src/observe.ts`, `agent/src/decide.ts`, `agent/src/act.ts`, `agent/src/pipeline.ts`
- `agent/src/latency.ts` (optional new shared timing utility)
- `agent/scripts/latency-harness.ts` (preserve existing modes)
- `agent/scripts/live-latency-report.mjs` (new report CLI)
- `agent/scripts/live-latency-report.test.mjs` (new Node built-in tests)
- `app/app/page.tsx` (minimal opt-in diagnostic controls, timing, export)
- `docs/live-voice-latency.md` (new operator instructions and measurement definitions)

No dependency or manifest changes. Use existing libraries, browser APIs and Node's built-in test runner.

## Non-goals

No TTS, model/provider/prompt changes, speculative optimization, new eval platform, LLM judge, annotation dashboard, recording/storage of personal audio, or changes to the VT handshake, audio encoding, diarization semantics or track-discovery behavior. Do not modify existing tickets, architecture REQs, SOULBOUND.md or audit files.

## Measurement contract

1. Diagnostic mode must be opt-in and preserve the normal conversation flow. Use opaque run and turn IDs, scoped to a session; never match turns by transcript text.
2. Define a fresh start and end for EACH turn. Session mic-enabled time is connection setup only, never the origin of every response timer. Keep one diagnostic utterance outstanding at a time; detect overlapping or unmatched events rather than guessing attribution.
3. Main intended pre-TTS metric: end of user speech → visible reply. Also report speech-start → visible reply when a defensible start exists. State precisely how each boundary is observed.
4. Prefer an existing, documented speech boundary. A VT speechEnd event observed on the agent is not the browser's physical speech-end timestamp. If exact browser speech boundaries need unavailable VAD or clock synchronization, do not add a dependency or fabricate precision. Use an explicitly labeled browser-side "Finished speaking" marker as a manual proxy, and report marker→visible reply separately. Human marker delay is a limitation; it must not be labeled true speech-end latency. Document a short, repeatable operator procedure.
5. Capture available agent-local intervals: VT speechEnd-event receipt→speechComplete receipt; VT completion→Spark request; Spark request→full response; data publish start→promise resolution. If first-token timing requires enabling streaming, report it unavailable in this measurement-only ticket and leave streaming work to Ticket 003. Do not silently change inference behavior to measure it.
6. Capture browser data receipt→reply DOM commit, acknowledging that DOM commit is not guaranteed physical paint. Measure marker/start→DOM commit on the same browser monotonic clock. Do not subtract browser and agent performance.now() values or unrelated wall clocks. Unavailable transport intervals are null with a reason, not zero or misleadingly inferred totals.
7. Preserve the VT timing argument through the pipeline instead of silently defaulting it to zero. Label existing speechStart→completion timing as utterance/VT elapsed, not post-speech recognition delay.
8. Publish-resolution timing is known only after the turn packet was sent. Use a small diagnostic follow-up or an agent-side record joined by turn ID; do not put a future timestamp into the original packet. Diagnostic messages must not recursively trigger more acknowledgements.
9. Keep browser records and agent records joinable and exportable using opaque IDs. Timing exports contain metadata and numbers only: no audio, transcript/reply text, tokens, keys, participant identity or signed URLs. Do not broaden existing content logging; warn operators not to export raw content logs as timing evidence.

## Run and evaluator contract

- Record one declared warm-up attempt separately, then 20 consecutive measured attempts. Do not replace slow or failed samples with extra successful ones.
- Choose and document a finite timeout before the run, using the same timeout for every measured attempt.
- Report attempted, successful, failed, timed-out, missing, duplicate and unmatched records with non-overlapping terminal outcomes where applicable. Explain duplicate/unmatched events separately from attempt outcomes.
- For each metric, report its eligible sample count, unavailable/excluded count, p50 and p95. Use nearest-rank: sorted samples at ceil(p*n)-1 for 0<p<=1. Empty distributions return null, not zero.
- Percentiles describe eligible successful samples; always display failures alongside them. An incomplete/failing run is not a successful 20-turn baseline.
- Record date, code revision supplied by operator, browser, model ID, VT encoding, warm-up policy, timeout, mode, boundary/proxy definition and percentile method.
- Keep live-mic, WAV-replay and decide-only outputs separate. No mock or fixture can substitute for Tolu's real-mic acceptance.
- Review a small set of actual replies locally with Tolu for relevance, speaker behavior and completeness. Record only aggregate counts/categories in exported timing evidence. An LLM judge is unnecessary.
- Borrow the evals companion's narrow code-eval and observed-error principles; do not install the skill suite or framework.

## Acceptance criteria

- [ ] Normal live transcription/replies still work; instrumentation is opt-in and adds no blocking external checks.
- [ ] Every measured attempt has a fresh browser boundary and opaque correlation ID; no accumulating mic-enabled timer.
- [ ] Available stage durations and browser end-to-end/proxy timings follow the clock and boundary rules above; unsupported measurements are labeled unavailable.
- [ ] Publish completion is recorded honestly after it happens, without diagnostic message loops.
- [ ] Metadata-only JSON export can be summarized by the report CLI; invalid/negative/non-finite/inverted timestamps are rejected or flagged, never repaired into valid samples.
- [ ] Built-in tests cover known p50/p95 values, empty/singleton datasets, invalid timestamps, warm-up exclusion, missing/duplicate IDs, timeouts/failures and sample accounting.
- [ ] One warm-up plus 20 measured real-mic attempts are captured on the Mac, with stage p50/p95, failures, limitations and aggregate manual quality observations.
- [ ] Existing decide-only and WAV-replay modes retain their honest labels and meaning.
- [ ] Documentation supplies exact launch/export/report steps, required services and operator actions, including how to avoid duplicate workers and concurrent Next build/dev processes.
- [ ] Agent and app builds pass. No REQ-40 first-audio PASS is claimed.

## Verification

Offline checks from the repo root (stop the app dev server before building; do not delete caches or kill unrelated processes):
```bash
env -u NODE_ENV pnpm build
node --test agent/scripts/live-latency-report.test.mjs
```

Local services in separate terminals, only if an instance is not already running:
```bash
livekit-server --dev
```
Use the credentials printed by the server in the existing gitignored env files. Never assume or commit credentials.
```bash
cd app
env -u NODE_ENV pnpm dev
```
Worker launched from its own directory so the polyfill and child-process imports resolve:
```bash
cd agent
node --env-file=.env --import ./polyfill-error-event.mjs dist/index.js start
```
The current product code accepts MODEL_API_KEY or META_API_KEY; preserve existing values and do not overwrite one from the other. Registration must be observed before the browser test.

Open http://localhost:3000. Use the documented diagnostic flow for one warm-up and 20 measured attempts. Export metadata-only JSON outside the repo, for example `/tmp/soulbound-019-live.json`, then:
```bash
node agent/scripts/live-latency-report.mjs --input /tmp/soulbound-019-live.json --expected-turns 20
```
The report command must exit nonzero on malformed or incomplete baseline data. Keep machine-readable output available for independent verification. If Tolu is unavailable for the microphone test, deliver the instrumentation and mark the live criterion BLOCKED; do not invent results or silently substitute replay.

## Handoff and evidence

Doer: report changed files, commands/results, unverified criteria and exact human action needed. Do not write under audit/ or edit this specification; if instructions conflict, stop and report. Do not mark the ticket complete or commit partial work as complete while the live criterion is blocked. Once work is complete, follow the repo's ticket-specific commit and attribution rules; stage only your implementation files, not the pre-existing untracked ticket drafts.

Tolu exports the doer session through the supported Muse export command, reviews/redacts secrets and personal content, then supplies it to the verifier. AdaL independently runs verification and packages evidence under `audit/019-live-voice-latency-baseline/`. No raw secrets or personal conversation logs belong there.

After baseline review, choose the next optimization from measured bottlenecks and execute it under a scoped ticket or Ticket 003's approved scope. Do not postpone the first-audio acceptance to Ticket 011.
