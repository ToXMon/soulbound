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
| UI (join/leave, transcript + reply render, character placeholder) | — | **Built for SOULBOUND** | `app/app/page.tsx`; static placeholder only, no Muse Image. Ticket 003 adds remote-audio attach/playback + Start audio. |
| VoxCPM2 model + Voice Design format `(description)text`, `seed` | `OpenBMB/VoxCPM` + `openbmb/VoxCPM2` (Apache-2.0), HF revision `32279effe8c19989596f05d353d1447f51d9e915` | External model + format reference | Speech renderer only (D13/D15); never a conversational model. No reference audio of any real person. |
| vLLM-Omni TTS serving (`/v1/audio/speech`, streaming PCM) | `vllm-project/vllm-omni` v0.32.0; image `vllm/vllm-omni:v0.32.0@sha256:6b44ee504a0dc3a21eacf72e7dc5da318b7bcc8ed0e349dc928e67278414430c` | Pinned upstream image + API contract | Client shape verified against the v0.32.0 TTS README, VoxCPM2 client, deploy YAML and Speech API docs. Live endpoint proof is Gate B. |
| Akash tenant deployment method | `akash-network/akash-skill` @ `7bc7e5aa11edccbe285a95bab2dd5dbb5f6cccac` | Official skill/guides reference | Pricing, compute-resource, lifecycle, wallet and GPU guides followed; self-custody `provider-services` path kept. |
| TTS adapter, sentence assembler, PCM framer, ordered LiveKit publisher, smoke/readiness scripts | — | **Built for SOULBOUND** | `agent/src/tts.ts`, `agent/src/tts-core.ts`, `scripts/tts-*.sh`, `akash/deploy.yml`. |

| Keccak-256 hashing (`js-sha3`) | `js-sha3` (MIT, maintained) | Library dependency | Node has sha3-256, not Keccak-256; smallest maintained direct dependency for the frozen Merkle protocol (docs/memory-schema.md). |
| Durable memory store, Spark structured extraction, bounded job queue, Merkle manifests/proofs (Ticket 004) | — | **Built for SOULBOUND** | `agent/src/memory/`, `agent/scripts/memory-demo.mjs`, `docs/memory-schema.md`. Off-chain only; nothing on-chain yet. |

## Current implementation status (2026-11-02)

Solana identity and memory-root anchoring are implemented; the older table entries describe when individual components first landed, not the current feature boundary. See `docs/devnet.md` and `docs/029-memory-identity-linkage.md` for program pins, transactions and observed inclusion/tamper results. The memory store is off-chain; its committed roots and history are on devnet.

The current room has real received-audio playback, a procedural Warden and an alternate 2D portrait. It is no longer the text-only placeholder described in the original UI row. Warden's visual references and attribution are recorded in `docs/024-third-party-notices.md`; portrait provenance and limitations are in `docs/022-living-portrait-verification.md`.

SAM 3.1 uses the pinned `@meta-sam/parser` dependency plus SOULBOUND's explicit-trigger, correlation and memory-sidecar integration. Useful live object-recognition acceptance remains open; synthetic fixtures are not model results. Muse Image anchored genesis/variation work is not established by the reactive portrait.

VoxCPM2 remains the selected speech renderer. The deployed client uses the verified WAV-stream contract, strips the header and publishes PCM through LiveKit. Meta MMS is an unsuccessful optional latency experiment, not the selected product renderer. See `docs/030-mms-tts-swap.md`.

For judge setup, sample-input labels and a current claim-to-evidence table, use the root README. Do not infer completion of Arcium, x402 payments, live heartbeat rewards or judge minting from the architecture plan.
