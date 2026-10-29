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

## Ticket 003 extension (TTS + playback proxies)

Same export file and report CLI; new fields are additive and nullable.

| Measurement | Definition | Clock |
| --- | --- | --- |
| `sparkFirstTokenMs` | Spark request start → first streamed token | agent |
| `firstSentenceMs` | Spark request start → first complete sentence emitted | agent |
| `firstTtsChunkMs` | Spark request start → first TTS PCM chunk received | agent |
| `firstAudioPublishMs` | Spark request start → first PCM frame handed to LiveKit `AudioSource` | agent |
| `ttsMs` | Whole-turn TTS synthesis + publish elapsed | agent |
| `markerToAudioPlayingMs` | Operator Finished-speaking click → audio element `playing` event. **Manual proxy, not physical first-audio proof.** | browser |
| `startToAudioPlayingMs` | Operator Start-turn click → audio `playing` event | browser |

Rules unchanged: one clock per duration, never subtract browser from agent,
unavailable = `null` with a reason in the agent record, failures/timeouts/
duplicates always reported. REQ-40 (warm first-audio p50 < 2.5 s, p95 < 4 s)
is **not** passed by these proxies: physical speech-end and first audible
playback need a defensible observation (e.g. reviewed timing of a consented
local recording with headphones). If only proxies exist, mark the exact
acceptance unverified.

Interruption policy: a new turn, disconnect, or shutdown cancels the active
Spark/TTS turn (`AbortController`), clears queued audio, and never plays
stale speech. Full barge-in during playback is deferred; cancellation is
the documented behavior. Use headphones: the agent must not transcribe its
own audio (diarization is never disabled as a shortcut).

Speech benchmark command (after Gates B–D, with agent + app + LiveKit up and
TTS env set in `agent/.env`): open the app, tick the diagnostic, then one
declared warm-up + 20 measured real speech turns exactly as above, export,
and run the same report CLI. Unsupported flags are rejected by the CLIs;
there is no separate `--speech` flag.

### 20-turn live run (2026-10-29, run-b4888cd9, pre-consistency-fix pipeline)

Report: `COMPLETE` — 1 warm-up excluded, 20 attempted, 20 successful, 0
failed/timed-out/missing/duplicate/invalid. Percentiles (nearest-rank):

| Metric (clock) | p50 | p95 | Note |
| --- | --- | --- | --- |
| `sparkFirstTokenMs` (agent) | 4962 | 6592 | **Dominant stage** |
| `firstSentenceMs` (agent) | 4980 | 6699 | ~18 ms after first token |
| `firstTtsChunkMs` (agent) | 5528 | 7250 | ~548 ms after first sentence |
| `firstAudioPublishMs` (agent) | 5528 | 7251 | Publish ≈ free |
| `sparkMs` (agent) | 5067 | 6764 | Full stream barely outlasts TTFT |
| `ttsMs` (agent, old per-sentence) | 11821 | 21693 | Superseded by reply-level synthesis; rerun pending |
| `markerToAudioPlayingMs` (browser proxy) | — | — | **Unavailable 20/20**: page gated stamps on `pending`; fixed after this export |

REQ-40 verdict on this run: **FAIL (honest bound).** Even stacking only
defensible agent segments — VT speechEnd→complete p50 0 ms +
complete→Spark 2 ms + Spark→first-PCM-publish 5528 ms — first audible
playback cannot be earlier than ~5.5 s p50 / ~7.3 s p95, above the
<2.5 s / <4 s budget, before any browser/network delay. The cause is Spark
time-to-first-token, not TTS or LiveKit. The manual proxies
(`markerToVisibleMs` p50 ~12.3 s) include human marker + speaking time and
must never be quoted as latency.

### TTFT fix found + measured (2026-10-29): reasoning effort

Root cause of the 5 s TTFT: Spark spends **~650–770 invisible reasoning
tokens** before the first visible token at the model default. Measured with
a streamed probe (same persona prompt, 3 runs each, Meta API):

| Variant | Reasoning tokens | TTFT median |
| --- | --- | --- |
| default (no param) | ~700 | 3881 ms (one 13 s cold run) |
| `reasoning_effort=low` | ~330 | 2681 ms |
| `reasoning_effort=minimal` | ~75 | **1130 ms** |

Wire facts (HTTP 400 messages + probe): the nested `reasoning:{effort}`
object is rejected on Chat Completions; supported values are
`minimal|low|medium|high|xhigh|max` (`none` rejected). Small `max_tokens`
is dangerous — reasoning eats the budget and replies come back empty.
Prompt caching showed `cached_tokens=0` here (short prefix; it is a cost
lever, not the TTFT lever).

Fix shipped: `reasoning_effort` (env `MODEL_REASONING_EFFORT`, default
`minimal`) on both Spark calls in `decide.ts`, validated against the
supported set. Verified through the real agent path (`decideStream`):
first token **755–930 ms** over 3 runs with intact reply quality.
Projected first-audio ≈ TTFT + ~0.1 s stream tail + ~0.55 s TTS TTFB ≈
**1.5 s**, inside the REQ-40 p50 budget — but REQ-40 stays UNVERIFIED
until a fresh warm 20-turn live run (with the reply-level TTS mode and the
fixed audio stamping) produces defensible numbers.

### First live decomposition (one observed turn, agent clock, Spark-start relative)

| Stage boundary | At (ms) | Segment |
| --- | --- | --- |
| Spark first token / first sentence | 3366 | Spark request → first token dominates everything downstream |
| Spark stream complete | 3483 | Only ~117 ms after first token: once tokens start, the reply lands fast |
| First TTS bytes | 3992 | ~509 ms after first sentence (endpoint TTFB, consistent with smoke ~0.5 s) |
| First PCM published to LiveKit | 3997 | ~5 ms publish cost — negligible |

Do not sum these; they overlap by design (first-sentence synthesis started
~117 ms before Spark completed — overlap verified for this turn). The
dominant latency stage is **Spark time-to-first-token**, not TTS or LiveKit.
These are agent-clock segments, NOT physical speech-end→first-audio latency.
REQ-40 (<2.5 s p50 / <4 s p95) can only be judged from a defensible
first-audible observation over the warm 20-turn run; the browser
`markerToAudioPlayingMs` proxy is reported separately and never renamed.

## Offline verification

From the repo root, with the app dev server stopped:

```bash
env -u NODE_ENV pnpm build
node --test agent/scripts/live-latency-report.test.mjs
node --test agent/scripts/tts-core.test.mjs agent/scripts/tts-provider.test.mjs
```
