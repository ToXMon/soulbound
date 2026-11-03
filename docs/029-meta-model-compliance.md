# Meta model eligibility compliance

Date: 2026-11-01
POC: Tolu Shekoni
TL;DR: New hackathon rule requires every runtime model to be Meta. Voice Transcribe, Spark and SAM are compliant. VoxCPM2 (OpenBMB) speech synthesis is NOT and must not run in the submitted demo. A TTS decision is required before the demo script, README and final rehearsal are finalized.

## Rule (owner-provided 2026-11-01)

"Every model your project calls at runtime must be a Meta model. Meta models being a core part of the project doesn't allow other models to run alongside them. This replaces earlier guidance that non-Meta models could run alongside Meta's. Non-model libraries such as OpenCV are fine within their terms, and open-source Meta models such as SAM count however you run them. Say in your README which Meta models you use and where they run."

This supersedes the earlier project assumption that VoxCPM2 could run alongside Meta models (D13/D15, AGENTS.md model-purity non-negotiable and its Jev carve-out remain unchanged for dev harnesses).

## Runtime model inventory

| Model | Vendor | Where it runs | Role | Compliant |
| --- | --- | --- | --- | --- |
| Muse Voice Transcribe 1.0 | Meta | Meta Model API realtime ASR WebSocket, agent worker | speech-to-text + diarization every voice turn | yes |
| Muse Spark 1.3 | Meta | Meta Model API (non-contributor), agent worker | conversation replies, vision observation, memory extraction | yes |
| SAM 3.1 | Meta (open-source) | @meta-sam/parser against Meta Responses API | explicit object segmentation on Look at this | yes |
| VoxCPM2 | OpenBMB | vLLM-Omni on rented Akash GPU | character speech synthesis | NO |

Hackathon catalog models found via search: Muse Spark, Muse Image, SAM 3.1, Voice Transcribe, Wonder via Meta Model API. No Meta TTS is offered. Muse Image and Wonder are not called by this project at runtime; do not claim them.

Dev-harness-only models (Jev trace judging, offline) are not runtime calls; keep them out of the product path and do not present them as product features.

## Options

A. Swap TTS to self-hosted Meta MMS (facebook/mms-tts-eng). Open-source Meta model, so it counts however run. Serve it ourselves (Akash; likely CPU-capable given its size, which could retire the 265uact/block GPU lease entirely). The existing TTSProvider seam in agent/src/tts.ts bounds the change: new provider class, env switch, keep the one-request-per-reply pipeline. Trade-offs: fixed single voice (no voice-description/seed design; consistency becomes trivial, quality drops below VoxCPM2; treat as a persona voice change and re-rehearse), MMS is CC-BY-NC 4.0 (acceptable for a non-commercial hackathon entry; note it), serving details and latency are expectations to verify, not measurements.

B. Browser Web Speech API for character speech. No model call by the project, but weak voice and a judge-risky reading of the rule; do not prefer.

C. Keep VoxCPM2 in the submitted demo. Explicitly non-compliant; eligibility risk. Not recommended.

D. Owner asks organizers whether TTS is exempt. Optional parallel action; the rule text currently admits no exception.

Recommendation: A, with B as fallback only if A cannot be integrated in the remaining build window (ends Nov 4). VoxCPM2 provider code may remain as an optional local-dev provider, but the submission build and demo runtime must be configured Meta-only, and the README must not present VoxCPM2 in the demo path.

## README model table (draft to finalize)

| Meta model | Where it runs | What it does |
| --- | --- | --- |
| Muse Voice Transcribe 1.0 | Meta Model API realtime ASR WebSocket (agent worker) | recognizes and diarizes every spoken turn |
| Muse Spark 1.3 | Meta Model API (agent worker) | conversation replies, object observation, memory extraction |
| SAM 3.1 | open-source Meta model via @meta-sam/parser (Meta Responses API) | segments the explicitly captured object |
| Meta MMS TTS (mms-tts-eng) | self-hosted by us on Akash compute | synthesizes the character's spoken replies (pending decision) |

Stack story this enables: a 100 percent Meta runtime — three models via Meta Model API plus one self-hosted open-source Meta model on decentralized compute.

## Impact on existing work

Voice Transcribe, Spark, SAM, memory/Solana visibility, vision diagnosis, UI publication, deployment operations: unaffected. The VoxCPM2 serving stack and voice-description/seed work remain valid local-dev tooling and a documented engineering path, but the submitted demo cannot run them. REQ-41 as written (VoxCPM2 consistency) cannot be the submission's acceptance gate; the owner should record the TTS decision in SOULBOUND.md section 9. First-audio latency must be re-measured after any TTS swap; VITS-class synthesis is expected to be faster than the observed 11.3s cold VoxCPM2 first chunk, but that is an expectation, not a claim.
