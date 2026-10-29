# Voice lock (Ticket 003, REQ-41)

Status: **NOT LOCKED — endpoint live (Gate B passed); awaiting Tolu's Gate D selection and consistency verdict (voice shift under investigation, see below).**

## Pinned stack

| Item | Pin |
| --- | --- |
| Model | `openbmb/VoxCPM2` @ HF revision `32279effe8c19989596f05d353d1447f51d9e915` |
| Serving | vLLM-Omni `v0.32.0`, image `vllm/vllm-omni:v0.32.0@sha256:6b44ee504a0dc3a21eacf72e7dc5da318b7bcc8ed0e349dc928e67278414430c` (linux/amd64) |
| Endpoint | `POST /v1/audio/speech` at the forwarded provider address (see runbook). Live-verified: `stream=true`, `stream_format=audio`, `response_format=wav` (header + raw PCM). `response_format=pcm` streams are dropped by the pinned server |
| Output | 48 kHz mono s16le PCM after the client strips the streaming WAV header (validated per request; format mismatch fails the sentence, never guesses) |
| Deploy config | Upstream `voxcpm2.yaml` defaults: `temperature 0.0`, `seed 42` server-side default; per-request `seed` is sent explicitly |

## Voice-shift investigation (Tolu observation, 2026-10-29)

Tolu hears the voice identity change **between sentences within one reply**.
Mechanism under test: the pipeline synthesizes each sentence as an
independent request. Voice Design has no persistent speaker embedding, so
each request samples its own voice realization — same description/seed does
not bind timbre across requests (identical text+seed does repeat
byte-identically, which only proves determinism for identical input).

Sentence-mapped samples for Tolu's A/B verdict (same description A, seed 42):
- Per-sentence, concatenated: `/tmp/soulbound-003-sent-concat.wav`
  (parts: `sent-1.wav`, `sent-2.wav`, `sent-3.wav`)
- One combined request: `/tmp/soulbound-003-sent-combined.wav`

If the combined request is consistent and the concatenation is not, the
cause is independent per-sentence synthesis. If Tolu judges that Voice
Design still cannot meet REQ-41, report **BLOCKED** for a product decision.
Do not introduce reference cloning or change providers without that decision.

**Verdict (Tolu, 2026-10-29):** the combined single-request sample has the
best consistency. Accepted fix, implemented in `pipeline.ts`: one synthesis
request per reply (first-sentence overlap traded away by this decision).
Per-sentence synthesis must not return without a new consistency verdict.
Description selection (A/B/C) remains Tolu's; `agent/.env` currently uses A.
Long-run consistency across turns/restarts still needs Tolu's confirmation
before REQ-41 can be called passed; nothing here is a seed guarantee.

## Voice Design (no reference audio, no real-person cloning)

Spark authors the description; VoxCPM2 input is `(<description>)<sentence>`.
Candidates are generated only after the endpoint passes Gate B. Tolu selects.

| Candidate | Description (Spark-authored) | Seed | Sample (outside repo) | Tolu verdict |
| --- | --- | --- | --- | --- |
| A | a warm, youthful voice, gentle and curious, clear and natural at a relaxed pace | 42 | `/tmp/soulbound-003-voice-a.wav` (repeatability: `-b.wav`; different text: `-c.wav`) | _pending listening_ |
| B | a calm, deeper voice, warm and steady, thoughtful and unhurried | 42 | `/tmp/soulbound-003-voice-descB.wav` | _pending listening_ |
| C | a bright, energetic young voice, playful and expressive, quick and lively | 42 | `/tmp/soulbound-003-voice-descC.wav` | _pending listening_ |

Selected voice: _none yet — Tolu selects after listening._ Record the exact
description, seed, model/serving revisions and parameters here when selected.
No auth secrets in this file.

Live evidence (2026-10-29, dseq 29283087): same text + seed 42 produced
byte-identical WAVs on repeat (`cmp` clean). That is encouraging but is NOT
a timbre guarantee — Tolu's listening confirmation is still required,
including after a restart.

## Repeatability protocol (seed is NOT a guarantee)

Upstream docs expose `seed` but do not guarantee stable timbre. Required
evidence before REQ-41 can pass:

1. Same text twice under the exact deployment — compare by listening.
2. Different sentences, same description+seed — compare by listening.
3. Repeat (1) after a controlled restart/re-readiness.
4. Tolu confirms consistency. If Voice Design cannot satisfy REQ-41, report
   BLOCKED for a product decision. Never silently switch to reference cloning.

## Runtime configuration (agent env, placeholders in `.env.example`)

`TTS_BASE_URL`, `TTS_API_KEY` (secret), `TTS_MODEL=openbmb/VoxCPM2`,
`TTS_VOICE_DESCRIPTION`, `TTS_SEED`.
