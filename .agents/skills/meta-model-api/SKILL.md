---
name: meta-model-api
description: SOULBOUND Meta Model API execution pack — verified endpoints, model ids, and cookbook patterns for Muse Spark, Voice Transcribe, Image, SAM 3.1, Wonder, and Spark Open. Any agent MUST load this before writing code that calls a Meta model.
---

# Meta Model API pack (verified 2026-10-26 against dev.meta.ai + meta-model-cookbook)

## Auth & client

- Base URL `https://api.meta.ai/v1`, OpenAI SDK compatible. Key format `LLM|{numeric_id}|{secret}` in env `MODEL_API_KEY` (SDK does NOT auto-read it — pass explicitly).
- Muse Code uses the same key via `META_API_KEY` (always takes priority over `muse login`).
- **Never the `-contributor` model variants for personal data** (they train on inputs).

## Models

| Model | Id | Notes |
|---|---|---|
| Muse Spark 1.3 | `muse-spark-1.3` | 1M ctx; tool calling; structured output (schema-guaranteed JSON); streaming; reasoning effort knob; vision input (URL or base64); search grounding; prompt caching (stable prefixes, track cached tokens). $1.25/$4.25 per Mtok |
| Muse Voice Transcribe | (voice API) | **WebSocket only** for streaming — NOT an HTTP endpoint. Speaker-attributed turns w/ diarization. Also supports whole-recording HTTP POST |
| Muse Image | (Responses API) | Generate/edit/compose; **anchored generation**: small reference set keeps character on-model across a series; conversational chained edits |
| SAM 3.1 | via `meta-sam` SDK | Image + video segmentation/tracking; Python & TS parsers |
| Muse Wonder | `muse-wonder-1.0` | Long-running agents, sub-agent delegation, active memory. $4/$20 per Mtok — dream cycle only, never live turns |
| Muse Spark Open | `muse-spark-open-1026` via Baseten | **Use this exact id** — Baseten docs show a different one. Subconscious/consolidation loop |
| Muse Glimmer | local/open weights | Optional local dev brain |

## Cookbook patterns to reuse (github.com/meta-models/meta-model-cookbook)

- `01_api_fundamentals/03_tool_calling` — execute-and-feed-back loop (our brain loop)
- `01_api_fundamentals/04_structured_output` — memory extraction schema
- `01_api_fundamentals/05_prompt_caching` — stable persona prefix + cached tokens (cost)
- `02_agent_patterns/03_managing_context` — long-run context hygiene
- `05_muse_image/03_anchored_generation` — character consistency recipe
- `06_muse_voice/01_voice_api_fundamentals` — WS client + diarization
- `07_sam/01_api_basics` — segmentation calls

## Rules

- Persona/system prompt is a stable prefix (prompt caching); per-turn variable content goes last.
- Memory extraction = structured output with a versioned JSON schema; never parse free text.
- Rate limits unknown → exponential backoff with jitter; never retry client (4xx) errors.
- Latency path (REQ-40): stream tokens; start TTS on first complete sentence.
