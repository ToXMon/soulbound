# Built vs Borrowed

Hackathon "new work only" record. Everything borrowed is listed here; everything
else in the repo is new work written for SOULBOUND.

| Component | Source | Borrowed / Built | Notes |
| --- | --- | --- | --- |
| Browser room client + token route pattern | `livekit-examples/agent-starter-react` (LiveKit, official examples) | Pattern borrowed, code new | We follow the starter's shape: Next.js app, server-signed token endpoint (`app/app/api/token/route.ts`), browser joins a room and publishes mic. No starter code copied verbatim; no state library or CSS framework added. |
| Agent worker pattern | LiveKit Agents JS (`@livekit/agents`, `@livekit/rtc-node`) | Library dependency | Worker registration, room connect, audio-track subscription via the framework; our VT/Spark wiring is new. |
| LiveKit transport (room, mic publish, data channel) | `livekit-client`, `livekit-server-sdk` | Library dependencies | Used as-is; the server secret never reaches the browser. |
| Architectural reference for LiveKit + GPU-agent layout | `frankramosdev/akashvisionagent` | Reference only, no code | Author verbally confirmed re-use to Tolu on 2026-10-26 (SOULBOUND.md §4a). We build on the official starter instead and credit the reference here. |
| Muse Spark brain call | Meta Model API via `openai` SDK (OpenAI-compatible at `https://api.meta.ai/v1`) | Library dependency + Meta service | Model `muse-spark-1.3`; never a `-contributor` variant (enforced in `agent/src/decide.ts`). |
| Muse Voice Transcribe streaming STT + diarization | Meta Model API, WebSocket only; protocol from `meta-models/meta-model-cookbook` `06_muse_voice/01_voice_api_fundamentals` | Meta service + cookbook reference | Client in `agent/src/observe.ts` implements the cookbook protocol (Ticket 016): `wss://api.meta.ai/v1/asr/realtime`, auth inside the handshake JSON, binary PCM, `endStream`, `turnId`-keyed event lifecycle, bare-letter speaker labels. Cookbook code read as reference, not copied. |
| Two-speaker test fixture `agent/fixtures/hello-two-speaker.wav` | Open Speech Repository (voiptroubleshooter.com), clips `OSR_us_000_0010_8k.wav` (female) + `OSR_us_000_0030_8k.wav` (male) | Borrowed audio, credited | Free to use/publish with credit to the Open Speech Repository. Alternating 6s segments with silence gaps, resampled to 16kHz mono 16-bit with ffmpeg. Used only by the latency harness; never in the product path. |
| WS client for VT auth headers | `ws` | Library dependency | Node's global WebSocket cannot set an `Authorization` header. |
| observe / orient / decide / act pipeline, persona placeholder, stranger fallback (REQ-42), latency harness (REQ-40) | — | **Built for SOULBOUND** | `agent/src/`, `agent/scripts/latency-harness.ts`. |
| UI (join/leave, transcript + reply render, character placeholder) | — | **Built for SOULBOUND** | `app/app/page.tsx`; static placeholder only, no TTS (Ticket 003), no Muse Image. |

Not borrowed, not present: TTS/VoxCPM2 (Ticket 003), memory graph, anything on-chain, Muse Image, deployment.
