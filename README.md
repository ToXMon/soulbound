# SOULBOUND

Date: 2026-11-02 · POC: Tolu Shekoni

SOULBOUND is a persistent voice-and-vision character with memory history anchored on Solana devnet. The hackathon prototype combines Meta Voice Transcribe and Muse Spark with LiveKit transport, OpenBMB VoxCPM2 speech synthesis, a durable memory graph and Merkle inclusion proofs.

The current local checkout builds. Several demo features remain uncommitted or incompletely accepted; this is not a production service. The [submission checklist](docs/033-recovery-and-submission.md) records current verification and remaining work. The final video link is pending.

## What is working and what remains open

| Capability | Evidence | Boundary |
| --- | --- | --- |
| Deployed multi-turn voice conversation | [Owner acceptance](docs/027-owner-voice-acceptance.md), [synthetic voice evidence](docs/027-end-to-end-voice-evidence.json) | These are dated observations, not an uptime or latency guarantee |
| Durable memory and sealed-root history | [Memory identity and epoch-1 linkage](docs/029-memory-identity-linkage.md) | New memories are local until sealed and explicitly committed |
| Valid inclusion proof and tamper rejection against devnet history | [Observed proof results and transaction](docs/029-memory-identity-linkage.md) | Private memory contents and signing keys are not published |
| Recall into conversation | [Independent review](audit/021-recall-into-conversation/review.md) | Only sealed, non-superseded records qualify; rehearse the deployed spoken recall before filming |
| Explicit one-frame vision with SAM and Spark | [Vision runbook](docs/vision-demo-runbook.md), [transport diagnosis](docs/031-vision-root-cause.md) | Useful live object recognition is not accepted; camera-size transport fix and live test remain open |
| Audio-reactive Warden and alternate portrait | [Readiness checks](docs/025-demo-readiness.md) | Procedural/2D approximate motion, not phoneme-accurate lip sync or an approved 3D likeness rig |
| Heartbeat life-stage transition and caller reward | [Local independent review](docs/007-independent-review.md) | Local tests only; no accepted live crank or reward setup |
| Arcium privacy, x402 self-payment, judge minting and anchored portrait evolution | [Architecture](docs/architecture.md), [tickets](tickets/) | Do not treat planned features as completed demo capabilities |

[Architecture and requirements](docs/architecture.md) · [Master plan](SOULBOUND.md) · [Built versus borrowed](docs/built-vs-borrowed.md)

## Run locally with your own credentials

Prerequisites: Git, Node.js 24.x, pnpm 10.17.1, a reachable LiveKit server, and Meta Model API access to Muse Spark and Voice Transcribe. Voice output additionally needs the pinned VoxCPM2 service. SAM entitlement is required for live segmentation. GPU hosting, API access and Solana devnet operations are separate prerequisites; installing the JavaScript dependencies does not provision them.

```sh
git clone https://github.com/ToXMon/soulbound.git
cd soulbound
corepack enable
corepack prepare pnpm@10.17.1 --activate
pnpm install --frozen-lockfile
cp agent/.env.example agent/.env
cp app/.env.example app/.env.local
pnpm --filter agent build
docker compose up -d livekit
```

The Compose service binds only to this computer. Both environment examples use LiveKit's public local-development pair `devkey` / `secret`. These are not hosted-service credentials; never expose this development server publicly. Stop it with `docker compose down`.

Edit these files locally. Never commit real values:

- In `agent/.env`, set `MODEL_API_KEY` or `META_API_KEY`, `MODEL_API_BASE_URL=https://api.meta.ai/v1`, `MODEL_NAME=muse-spark-1.3`, and the Voice Transcribe WebSocket settings shown in the agent example. Never use a contributor model for personal content.
- Set matching `LIVEKIT_URL`, `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` for the worker and app. For a local LiveKit server, use a private configuration with matching credentials. A bare `--dev` server is not assumed to match the placeholder secret.
- In `app/.env.local`, add those LiveKit key/secret values and `LIVEKIT_PUBLIC_URL` (browser-reachable `ws://localhost:7880` locally, trusted `wss://` when hosted). `NEXT_PUBLIC_LIVEKIT_URL` is also supported. App and browser must reach the same server. Use room `soulbound` unless deliberately configuring `DEMO_ROOM`.
- For spoken output, set `TTS_PROVIDER=voxcpm2`, `TTS_BASE_URL`, `TTS_API_KEY`, `TTS_MODEL=openbmb/VoxCPM2`, `TTS_VOICE_DESCRIPTION` and a fixed `TTS_SEED`. See [Vox deployment configuration](akash/deploy.yml) and [deployment runbook](docs/003-deployment-runbook.md). Leave both TTS URL and key empty for text replies only; that mode is not a full voice demo.
- Memory is opt-in. For private persistence, set `MEMORY_ENABLED=true`, a private `MEMORY_STORE_PATH`, `MEMORY_OWNER_ID` and `MEMORY_CHARACTER_ID`. For chain linkage use the actual owner public key and canonical decimal character ID. Never reuse Tolu's personal store or publish its contents. Diarization and guest room identity do not authenticate ownership.

Start the app and worker in separate terminals from the repo root:

```sh
# Terminal 1
pnpm --filter app dev

# Terminal 2
node --env-file=agent/.env agent/dist/index.js dev
```

Open http://localhost:3000, select **Join room**, grant microphone permission, and use **Start audio** if the browser blocks playback. Speak a short sentence. The worker must register with LiveKit before a participant joins. For recording, use moderate speaker volume and the visible microphone mute control if echo occurs. Physical echo cancellation and audible quality require a human rehearsal.

The optional proof read service runs separately:

```sh
node --env-file=agent/.env agent/dist/life-server.js
```

It uses the configured memory identity/store and Solana RPC; `LIFE_READ_URL=http://127.0.0.1:8787` belongs only in the app's server environment. An empty fresh store will not reproduce Tolu's private memories or their proofs. Sealing and committing a new root are explicit operator actions with private signing keys: see the [committer runbook](docs/005-committer-runbook.md). Do not expect talking alone to submit a chain transaction.

Production exposure requires trusted HTTPS/WSS and an operator access gate. The token issuer is a bounded demo issuer, not production user ownership authentication. Do not disable access protection to make a public link convenient. Temporary tunnel URLs in dated reports may expire; they are not the reproducible setup path.

## Sample inputs and honest demo labels

Judges can use these non-sensitive sample prompts in the real live conversation:

- "Please remember this sample fact: my favourite colour is teal."
- "What sample fact did I ask you to remember?" The repaired worker uses bounded session context for immediate follow-up. Recall after leaving and starting a new session requires a sealed persistent memory; follow the operator sealing workflow before that separate test.

These are sample facts, not information about Tolu. A sample prompt does not guarantee a scripted model response. The live worker still calls Meta models for transcription, conversation and memory extraction.

For a free offline mechanics check, use a fresh scratch store:

```sh
sample_store=$(mktemp -d)
node agent/scripts/memory-demo.mjs --offline --store "$sample_store"
```

This explicitly uses **synthetic sample data and a fake extractor**. It tests persistence, local Merkle proof verification and tamper rejection. It does not call Meta, commit to Solana or establish a working live conversation. The `--live` mode uses real Spark extraction with your credentials and incurs inference cost; its synthetic facts remain sample inputs.

`agent/fixtures/hello-two-speaker.wav` is prerecorded speech credited to the Open Speech Repository in [built versus borrowed](docs/built-vs-borrowed.md). Label it as prerecorded test input whenever shown. It is not generated character speech or a live microphone rehearsal. `app/fixtures/plant-synthetic.png` is a synthetic plumbing test, not a successful SAM result or useful object-recognition benchmark. For the video, use your own non-sensitive object/footage or a sample whose license permits redistribution, and retain its attribution. Never stage a fake vision response.

## Models and privacy

- Meta Muse Spark: conversation and structured memory/vision inference.
- Meta Voice Transcribe: streaming speech recognition and diarization.
- SAM 3.1: segmentation adapter; live acceptance remains open.
- OpenBMB VoxCPM2: speech synthesis, **not a Meta model**. Meta MMS was an unsuccessful latency experiment and is not the selected renderer.

Raw memories stay off-chain; roots and history are public on devnet. Hashes provide integrity, not confidentiality. This is not a claim of deployed confidential inference or completed Arcium privacy. Vision is explicitly triggered, not continuous capture; see the [vision privacy boundary](docs/vision-demo-runbook.md).

## Verification

```sh
pnpm --filter agent build
pnpm --filter app exec tsc --noEmit --incremental false
node --experimental-strip-types --test app/components/living-portrait/*.test.ts
(cd agent && node --test dist/vision/*.test.js dist/memory/vision-sidecar.test.js)
node --test agent/scripts/tts-provider.test.mjs agent/scripts/tts-core.test.mjs agent/scripts/pipeline-tts.test.mjs agent/scripts/life.test.mjs
```

For a production app check use an isolated output: `SOULBOUND_DIST_DIR=.next-verify pnpm --filter app build`. Next may add that generated type path to `app/tsconfig.json`; review and remove only the generated include after checking, without overwriting other work. Tests use fixtures/fakes where documented and do not substitute for live inference or speaker rehearsal.

## Submission

The three-minute video must show the actual working flow. Label sample facts, prerecorded inputs, fallback footage and simulated data. Show proof success and tamper rejection from the real implementation; do not present local test fixtures as on-chain evidence. Keep claims tied to the table above and [current checklist](docs/033-recovery-and-submission.md). Heartbeat, payments and privacy must not be presented as live-complete without their own evidence.

Do not publish API keys, operator login credentials, signing keys, private runtime manifests or personal memories. Review the intended Git changes and run a secret scan before publishing. Essential untracked files must be included in scoped reviewed commits before a fresh public clone can reproduce this checkout.
