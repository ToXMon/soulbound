# SOULBOUND

Date: 2026-11-02 · POC: Tolu Shekoni

SOULBOUND is a persistent voice-and-vision character with memory history anchored on Solana devnet. The hackathon prototype combines Meta Voice Transcribe and Muse Spark with LiveKit transport, OpenBMB VoxCPM2 speech synthesis, a durable memory graph and Merkle inclusion proofs.

Public `main` is the source of the last demo image built for deployment, plus one small token-route change that lets the local Compose stack serve a same-machine browser (see below to run it yourself). The deployed demo worked intermittently, with transcription failures and stale-room behaviour observed live: treat this as a hackathon prototype, not a production service. The [submission checklist](docs/033-recovery-and-submission.md) records verification and remaining work. The final video link is pending.

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

## Try it: two separate paths

| | **A. Offline proof demo** | **B. Live stack (Docker Compose)** |
| --- | --- | --- |
| Needs secrets or accounts | No | Yes: Meta Model API key at minimum |
| What it proves | Memory persistence, local Merkle proof verification, tamper rejection | The real voice/vision conversation loop on your machine |
| What it is **not** | Not live AI, not a conversation, not an on-chain transaction | Not a hosted service, not reliably production-ready |

### A. Offline proof demo (no secrets, no network)

Prerequisites: Git, Node.js 24.x, and corepack (ships with Node).

```sh
git clone https://github.com/ToXMon/soulbound.git
cd soulbound
corepack enable
corepack prepare pnpm@10.17.1 --activate
pnpm install --frozen-lockfile
pnpm --filter agent build
sample_store=$(mktemp -d)
node agent/scripts/memory-demo.mjs --offline --store "$sample_store"
```

Expected: three `[memory] job done` lines, then a JSON report with `"mode": "offline-fixture"`, `"records": 3`, `"proofVerified": true`, `"tamperRejected": true`, `"persistedAcrossReopen": true`, and exit code 0.

**This is synthetic sample data processed by a deterministic fake extractor.** It calls no Meta model, makes no network request and sends no Solana transaction. It exercises the local memory store, its Merkle proofs and tamper rejection only. The script refuses a non-empty `--store` directory, so use a fresh one each run. Its `--live` mode uses real Spark extraction with your credentials and incurs inference cost.

### B. Live stack with Docker Compose (credentials required)

One image runs both the Next.js app and the LiveKit voice worker; Compose adds a LiveKit server with private generated keys.

**Prerequisites (none of these are provisioned for you):**

- Docker with Compose v2. Verified on Docker 29.1 / Compose 2.40 on Apple Silicon. The image's base layers are pinned to `linux/amd64`, so on Apple Silicon it runs under emulation (slower build and start).
- A Meta Model API key with access to Muse Spark 1.3 and Voice Transcribe. Live camera looks additionally need SAM 3.1 entitlement on that key. Without Voice Transcribe access the worker joins the room and then fails with `Muse VT handshake rejected`; there is no fallback transcriber.
- For spoken replies: your own pinned VoxCPM2 endpoint (OpenBMB VoxCPM2 is not a Meta model). It needs an NVIDIA GPU host; the reference deployment used a 24 GB RTX 3090 on Akash, see [akash/deploy.yml](akash/deploy.yml) and the [deployment runbook](docs/003-deployment-runbook.md). Compose does not start it. Without it, replies are text only, which is not a full voice demo.
- A desktop Chrome-class browser on the same machine, with microphone (and camera, for vision) permission. Voice and vision correctness on your hardware is not verified here.

```sh
git clone https://github.com/ToXMon/soulbound.git
cd soulbound
./scripts/init-compose-env.sh      # writes .env (mode 0600) with generated LiveKit keys and operator password
$EDITOR .env                       # set MODEL_API_KEY; for voice also TTS_BASE_URL, TTS_API_KEY, TTS_VOICE_DESCRIPTION
docker compose up --build
```

Then open http://localhost:3000. The browser asks for the operator login: user `operator`, password is `DEMO_ACCESS_PASSWORD` in `.env` (`grep DEMO_ACCESS_PASSWORD .env`). Select **Join room**, allow the microphone, and use **Start audio** if playback is blocked. Each join creates a fresh room and dispatches the worker.

| Port (127.0.0.1 only) | Service |
| --- | --- |
| 3000 | App, behind the operator login |
| 7880 / 7881 / 7882 | LiveKit signaling, ICE/TCP, ICE/UDP |

Secrets and keys:

- `init-compose-env.sh` generates the LiveKit key/secret and operator password into `.env` and never prints them. It refuses to overwrite an existing `.env`. The template ([.env.example](.env.example)) deliberately ships these three values empty, so the stack cannot start with a secret published in this repository.
- LiveKit runs without `--dev`, so its public `devkey`/`secret` pair is rejected. All published ports are bound to loopback. Do not change them to `0.0.0.0` or expose this stack to a network.
- Only the worker receives the Meta and VoxCPM2 keys. `.env` is gitignored; never commit it.
- Memory is on by default for a throwaway identity (`judge-demo` / `warden`) in the `soulbound-data` volume. The `/life` proof page needs a real Solana owner key and a committed root, so expect it to report no verdict on this local identity.

Stop and clean up:

```sh
docker compose down        # keeps the memory volume
docker compose down -v     # also deletes the memory volume
```

Common failures:

- `required variable ... is missing a value`: run `./scripts/init-compose-env.sh`, or set `MODEL_API_KEY` in `.env`.
- App container exits with `Operator access must be configured`: `DEMO_ACCESS_PASSWORD` must be 24+ characters; regenerate it.
- Worker log `Muse VT handshake rejected: Unauthorized`: the Meta key is wrong or lacks Voice Transcribe access.
- Character answers in text only, worker log `[tts] not configured; text-only mode`: set the TTS variables. A voice also needs `TTS_VOICE_DESCRIPTION` (a candidate is in [docs/voice.md](docs/voice.md); the approved reference clip is private and not reproduced here).
- You join but no character appears: reload the page for a new room. The live demo showed transcription failures and stale-room behaviour intermittently, so treat this as a rehearsal stack.
- Camera look fails: the key may lack SAM 3.1 entitlement (not verified for your key); check the worker log.
- Port already in use: stop whatever holds 3000 or 7880-7882.

### Running without Docker (development)

This path was not re-verified in this change. Use Node.js 24.x with pnpm, the Compose LiveKit server (`docker compose up -d livekit`, which also needs `.env`) or your own, and keep the same LiveKit key and secret in `agent/.env` and `app/.env.local`. Copy the examples (`agent/.env.example`, `app/.env.example`), then replace the example `devkey`/`secret` pair with your `.env` values (the examples assume a bare `--dev` server, which this Compose file no longer runs):

```sh
pnpm install --frozen-lockfile
pnpm --filter agent build
pnpm --filter app dev                                   # terminal 1
node --env-file=agent/.env agent/dist/index.js dev      # terminal 2
```

The optional proof read service is `node --env-file=agent/.env agent/dist/life-server.js`; it uses the configured memory identity and Solana RPC. An empty fresh store will not reproduce Tolu's private memories or their proofs. Sealing and committing a new root are explicit operator actions with private signing keys: see the [committer runbook](docs/005-committer-runbook.md). Talking alone never submits a chain transaction.

Production exposure requires trusted HTTPS/WSS and the operator access gate; the token issuer is a bounded demo issuer, not production user authentication. The one `ws://` exception is a loopback URL for same-machine use. Temporary tunnel URLs in dated reports may expire and are not the reproducible setup path.

## Sample inputs and honest demo labels

Judges can use these non-sensitive sample prompts in the real live conversation:

- "Please remember this sample fact: my favourite colour is teal."
- "What sample fact did I ask you to remember?" The repaired worker uses bounded session context for immediate follow-up. Recall after leaving and starting a new session requires a sealed persistent memory; follow the operator sealing workflow before that separate test.

These are sample facts, not information about Tolu. A sample prompt does not guarantee a scripted model response. The live worker still calls Meta models for transcription, conversation and memory extraction.

For a free offline mechanics check with synthetic data, use [path A](#a-offline-proof-demo-no-secrets-no-network).

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
node --test agent/scripts/tts-provider.test.mjs agent/scripts/tts-core.test.mjs agent/scripts/pipeline-tts.test.mjs agent/scripts/life.test.mjs agent/scripts/037-recent-look.test.mjs
node --test akash/runtime/security.test.mjs   # operator gate and token route
```

For a production app check use an isolated output: `SOULBOUND_DIST_DIR=.next-verify pnpm --filter app build`. Next may add that generated type path to `app/tsconfig.json`; review and remove only the generated include after checking, without overwriting other work. Tests use fixtures/fakes where documented and do not substitute for live inference or speaker rehearsal.

## Submission

The three-minute video must show the actual working flow. Label sample facts, prerecorded inputs, fallback footage and simulated data. Show proof success and tamper rejection from the real implementation; do not present local test fixtures as on-chain evidence. Keep claims tied to the table above and [current checklist](docs/033-recovery-and-submission.md). Heartbeat, payments and privacy must not be presented as live-complete without their own evidence.

Do not publish API keys, operator login credentials, signing keys, private runtime manifests or personal memories. Review the intended Git changes and run a secret scan before publishing. Essential untracked files must be included in scoped reviewed commits before a fresh public clone can reproduce this checkout.
