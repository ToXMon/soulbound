# Live voice latency baseline (Ticket 019)

Pre-TTS measurement of the working voice loop: browser microphone → LiveKit →
Muse Voice Transcribe → Muse Spark → visible text reply. This baseline does
**not** measure first audio and cannot pass REQ-40 (p50 < 2.5s warm, first
audio). Ticket 003 extends these measurements to first audible response;
Ticket 011 does final rehearsal-grade verification.

## Measurement definitions

| Measurement | Definition | Clock |
| --- | --- | --- |
| Connection setup | Mic-enabled / room-connect time. Setup only, never the origin of a per-turn timer. | browser |
| `markerToVisibleMs` | Operator "Finished speaking" click → reply DOM commit. **Manual proxy, not true speech-end latency.** Human marker delay is included. | browser `performance.now()` |
| `startToVisibleMs` | Operator "Start turn" click → reply DOM commit. Manual proxy start. | browser `performance.now()` |
| `dataReceiptToDomCommitMs` | LiveKit data receipt in the browser → reply DOM commit (double `requestAnimationFrame` after render). DOM commit is not guaranteed physical paint. | browser `performance.now()` |
| `utteranceVtElapsedMs` | VT `speechStart` receipt → `speechComplete` receipt on the agent. Utterance/VT elapsed, **not** post-speech recognition delay. | agent `performance.now()` |
| `vtSpeechEndToCompleteMs` | VT `speechEnd`-event receipt → `speechComplete` receipt on the agent. This is agent receipt of a VT event, not the browser's physical speech end. Null with a reason when `speechEnd` was not observed. | agent `performance.now()` |
| `vtCompleteToSparkMs` | VT completion (agent) → Spark request start. | agent `performance.now()` |
| `sparkMs` | Spark request start → full response received. First-token timing is unavailable in this ticket (streaming not enabled; Ticket 003 owns it) and is reported null with a reason. | agent `performance.now()` |
| `publishMs` | Agent `publishData` start → promise resolution for the turn packet. Known only after the packet was sent, so it arrives in a separate `latency-publish` follow-up joined by opaque turn ID; it is never embedded in the original packet. Diagnostic follow-ups never trigger further acknowledgements. | agent `performance.now()` |

Rules:

- Every turn has a fresh browser boundary and an opaque turn ID, scoped to an
  opaque run ID. Turns are never matched by transcript text.
- One diagnostic utterance is outstanding at a time. Overlapping arms are
  detected and ignored on the agent; unmatched replies are recorded as
  unmatched, never guessed.
- Browser and agent `performance.now()` values are never subtracted from each
  other, and neither is mixed with wall clocks. Each duration uses one clock.
- Unavailable intervals are `null` with a reason, never zero.
- Exports contain metadata and numbers only: no audio, transcript/reply text,
  tokens, keys, participant identity, or signed URLs. Do not export raw
  content logs (agent console, browser console) as timing evidence.

## Run contract

- One warm-up attempt, recorded separately and excluded from percentiles,
  then **20 consecutive measured attempts**. Slow, failed, and timed-out
  attempts count; never replace them with extra successful ones.
- Choose one finite timeout before the run (default 30000 ms) and use it for
  every measured attempt. The timeout runs from the "Finished speaking"
  marker to the visible reply.
- For each metric the report shows eligible sample count,
  unavailable/excluded count, p50 and p95 (nearest-rank:
  sorted sample at `ceil(p*n)-1`). Empty distributions are null, not zero.
  Percentiles describe eligible successful samples only; failures are always
  displayed alongside them. An incomplete or failing run is not a successful
  20-turn baseline, and the report CLI exits nonzero for it.
- Keep live-mic, WAV-replay (`latency-harness.ts --wav`), and decide-only
  (`latency-harness.ts`, scripted transcripts, `sttMs=0`) outputs separate.
  Neither harness mode substitutes for the real-mic run.

## Required services

Start each service only if it is not already running (check first; duplicate
workers and duplicate LiveKit servers corrupt the measurement). Use the
credentials printed by `livekit-server --dev` in the existing gitignored env
files (`app/.env.local`, `agent/.env`). Never print or commit credentials.
The product code accepts `MODEL_API_KEY` or `META_API_KEY`; preserve existing
values, do not overwrite one from the other.

Terminal 1 — LiveKit (skip if already listening on 7880):

```bash
livekit-server --dev
```

Terminal 2 — app (skip if already serving on port 3000). **Stop the app dev
server before running `pnpm build`** — Next build and dev must not write the
same output concurrently:

```bash
cd app
env -u NODE_ENV pnpm dev
```

Terminal 3 — agent worker, launched from its own directory so the polyfill
and child-process imports resolve:

```bash
cd agent
node --env-file=.env --import ./polyfill-error-event.mjs dist/index.js start
```

Wait until the worker registration is observed in the agent output before
opening the browser test.

## Operator procedure (warm-up + 20 measured turns)

1. Open http://localhost:3000 and click **Join room**. Allow microphone
   access. Confirm the normal (non-diagnostic) flow works with one ordinary
   spoken exchange first if you have not already.
2. Tick **Latency diagnostic (Ticket 019)**.
3. Fill in **Code revision** (`git rev-parse --short HEAD`), confirm
   **Timeout** (30000 ms) and **VT encoding** (PCM_16KHZ). Do not change the
   timeout mid-run.
4. For each turn (the first is the warm-up, then turns 1–20):
   1. Click **Start turn N**. Speak immediately — one short, natural
      sentence, varied across turns.
   2. The instant you finish speaking, click **Finished speaking**. This
      click is the manual proxy for speech end; click it promptly and
      consistently — your reaction delay is part of the measurement's known
      limitation.
   3. Wait for the reply to appear. Do not speak again until it appears or
      the timeout fires.
   4. If nothing appears by the timeout, the turn is recorded as a timeout.
      If the agent or connection visibly failed, click **Mark failed**
      instead of waiting. Either way the attempt counts.
5. After turn 20, review the replies on screen with the operator for
   relevance, speaker behaviour (REQ-42 stranger greeting), and completeness.
   Enter only the aggregate counts in the quality fields. No reply text goes
   into the export.
6. Click **Export timing JSON**. Your browser downloads
   `soulbound-019-live.json`. Move it outside the repo:

```bash
mv ~/Downloads/soulbound-019-live.json /tmp/soulbound-019-live.json
node agent/scripts/live-latency-report.mjs --input /tmp/soulbound-019-live.json --expected-turns 20
node agent/scripts/live-latency-report.mjs --input /tmp/soulbound-019-live.json --expected-turns 20 --json
```

The report exits nonzero on malformed, incomplete, or failing baseline data.
Send the report output and the export location to the verifier; do not claim
a REQ-40 first-audio PASS from this pre-TTS baseline.

## Offline verification

From the repo root, with the app dev server stopped:

```bash
env -u NODE_ENV pnpm build
node --test agent/scripts/live-latency-report.test.mjs
```
