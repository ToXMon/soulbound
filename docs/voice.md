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

### Approved synthetic reference (Ticket 035)

Tolu approved the two fixed-reference comparison clips on 2026-11-02. Activate this exact generated SOULBOUND reference, not a new sample or a real person's recording:

- SHA256: `bff761c93db7cc2581ce64ab61c04e817bfef0745b5cb0d7d94a184e909f6a64`.
- Source: VoxCPM2-generated character speech, voice A, seed 42.
- Approval covers the presented speaker and sound. Live multi-turn smoothness, interruption and restart consistency remain separate checks.

### Synthetic reference configuration

When `TTS_REF_AUDIO_PATH` and `TTS_REF_AUDIO_DIGEST` are both set, the
VoxCPM2 provider loads the local WAV once at startup, validates the
SHA256 digest, and passes the same `ref_audio` data URI in every
synthesis request. This binds timbre across turns — the upstream
`ref_audio` parameter conditions the VoxCPM2 speaker embedding on the
provided audio, unlike Voice Design alone which samples independently.

| Variable | Purpose |
| --- | --- |
| `TTS_REF_AUDIO_PATH` | Absolute path to a local WAV reference file (≤ 10 MB) |
| `TTS_REF_AUDIO_DIGEST` | Expected hex SHA256 of the file (64 chars) |

- Both must be set together or both empty. Any misconfiguration fails
  loudly at startup — there is no silent fallback to randomized Voice
  Design when reference is configured but invalid.
- The file is read once; the data URI is held in memory for the
  provider lifetime. It is never logged, never published to the
  browser, and never committed to the repo.
- When neither var is set, the existing pure Voice Design path runs
  unchanged.
- This is for synthetic/generated character references only.
  Real-person voice cloning is not authorized (Ticket 035).
