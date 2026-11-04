# SOULBOUND

Checked against commit `b974bea` on 2026-11-03 · POC: Tolu Shekoni · Meta Global AI Developer Hackathon, Indie track, solo

SOULBOUND is an AI character you talk to out loud and show things to through your webcam, and it remembers. What it learns goes into a versioned memory graph. Each sealed batch of memories becomes a Merkle root, and the root history is kept by a program on Solana devnet, so anyone can check that a remembered fact belongs to a committed history without the fact being published. Conversation, vision and memory extraction run on Meta's Muse Spark, Voice Transcribe and SAM 3.1. The voice is OpenBMB's VoxCPM2.

It is a hackathon prototype. The memory and devnet proof pieces have the best evidence. Live voice and vision have worked in the owner's rehearsals, and the live worker has also shown transcription failures, so nothing here promises uptime or session durability. There is no hosted demo to click: every live path runs on your machine with your own credentials. The demo video link is pending.

## What you can run

| | A. Offline proof demo | B. Live stack (Docker Compose) |
| --- | --- | --- |
| Credentials | None | Meta Model API key; a VoxCPM2 endpoint if you want spoken replies |
| Shows | Memory store, versioned corrections, local Merkle proof, tamper rejection | The real voice and camera conversation loop on your machine |
| Does not show | Live AI, a conversation, anything on Solana | A hosted service, or anything reliable enough for production |

### A. Offline proof demo (no secrets)

Needs Git, Node.js and corepack. Verified with Node 24.6.0 and pnpm 10.17.1 from a fresh clone of this repository. Only fetching pnpm and `pnpm install` touch the network.

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

Expected: three `[memory] job done` lines, then a JSON report with `"mode": "offline-fixture"`, `"records": 3`, `"versions"` listing 1, 1, 2 (the third turn corrects the first), `"proofVerified": true`, `"tamperRejected": true`, `"persistedAcrossReopen": true`, and exit code 0.

The input is three synthetic sentences run through a deterministic fake extractor. No Meta model is called and no Solana transaction is sent. The script refuses a non-empty `--store`, so use a fresh directory each time. Its `--live` flag runs real Spark extraction with your key and costs inference credits.

The automated suites also run offline. They use fakes and fixtures, including a fake camera frame, so they say nothing about live inference. At this commit:

```sh
node --test agent/scripts/*.test.mjs                                          # 139 tests: 136 pass, 3 skipped
(cd agent && node --test dist/vision/*.test.js dist/memory/vision-sidecar.test.js)   # 34 pass
node --experimental-strip-types --test app/components/living-portrait/*.test.ts      # 57 pass
node --test akash/runtime/security.test.mjs                                   # 4 pass
pnpm --filter app exec tsc --noEmit --incremental false                       # no errors
```

### B. Live stack (credentials required)

One image runs the Next.js app and the LiveKit voice worker. Compose adds a pinned LiveKit server, so you do not need a LiveKit account, and generates its keys locally.

You provide:

- Docker with Compose v2. Verified on Docker 29.1.3 and Compose 2.40.3 on Apple Silicon, where the amd64 image runs under emulation.
- A Meta Model API key with Muse Spark 1.3 and Voice Transcribe, set as `MODEL_API_KEY`. Camera looks also need SAM 3.1 access on that key. There is no fallback transcriber: if Voice Transcribe rejects the key, the worker logs `Muse VT handshake rejected` and the character never hears you. On 2026-11-02 the owner's key was rejected with `Billing verification failed` ([record](docs/033-recovery-and-submission.md)).
- For spoken replies, a VoxCPM2 server on a GPU host you provision, protected by a bearer key. Set its address as `TTS_BASE_URL` (the worker appends `/v1/audio/speech`) and the key as `TTS_API_KEY`. VoxCPM2 is not a Meta model, and Compose does not start it. [akash/deploy.yml](akash/deploy.yml) is the reference SDL for one 24 GB-class NVIDIA GPU on Akash. Replace its `REPLACE_WITH_RUNTIME_SECRET` in a local copy and reuse that value as `TTS_API_KEY`. The [runbook](docs/003-deployment-runbook.md) records how the owner deployed and tested it, using the owner's own wallet and spend limits. The endpoint tested there, on 2026-10-29, was a plain `http://` forwarded port. The worker accepts that, but it sends your key and the reply text unencrypted, so use TLS if you can. Without a server the character replies in text in the transcript and never speaks.
- A desktop Chrome-class browser on the same machine, with microphone permission and, for vision, camera permission.

```sh
git clone https://github.com/ToXMon/soulbound.git
cd soulbound
./scripts/init-compose-env.sh      # writes .env (mode 0600) with generated LiveKit keys and operator password
$EDITOR .env                       # set MODEL_API_KEY; for voice also TTS_BASE_URL, TTS_API_KEY, TTS_VOICE_DESCRIPTION
docker compose up --build
```

A cold build from a clean cache succeeded on the Apple Silicon test machine. After `up`, the app was still refusing connections 15 seconds in under emulation, so give it a minute before you treat a connection error as a failure. Open http://localhost:3000 and sign in as `operator` with the `DEMO_ACCESS_PASSWORD` value from `.env`. The app is on 3000 and LiveKit on 7880 to 7882, all bound to 127.0.0.1. Do not rebind them to `0.0.0.0`.

A boot check with a placeholder key and no real credentials confirmed that the three containers start, the app answers 401 without the login and 200 with it, the token route issues a room token, and the worker registers with LiveKit. Voice, vision and speech output were not exercised, because they need real credentials.

Operational notes:

- The three generated values (`LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `DEMO_ACCESS_PASSWORD`) ship empty in [.env.example](.env.example) on purpose. `init-compose-env.sh` fills them without printing them and refuses to overwrite an existing `.env`. LiveKit runs without `--dev`, so its public default key pair is rejected.
- Only the worker receives the Meta and VoxCPM2 keys. `.env` is gitignored.
- Memory is on by default for a throwaway identity (`judge-demo` / `warden`) in the `soulbound-data` volume. `docker compose down` keeps it and `docker compose down -v` deletes it.
- If you join and no character appears, click Leave, then Join room again. Each join creates a fresh room and dispatches the worker. Check `docker compose logs worker`.
- A worker log line `[tts] not configured; text-only mode` means the TTS variables are empty. A voice needs all three of `TTS_BASE_URL`, `TTS_API_KEY` and `TTS_VOICE_DESCRIPTION` (a candidate description is in [docs/voice.md](docs/voice.md)).
- Running outside Docker is possible (`pnpm --filter app dev` plus `node --env-file=agent/.env agent/dist/index.js dev`, using the two `.env.example` files and your own LiveKit server), but that route has not been re-verified.

## Short demo flow

This is the flow to rehearse for the video. Each step says what has to be true for it to work.

1. Talk for two or three turns. Select Join room, allow the microphone, and select Start audio if playback is blocked. Say "Please remember this sample fact: my favourite colour is teal," then ask "What sample fact did I ask you to remember?" The follow-up works from bounded in-session context, kept per speaker label for up to 20 turns or 8000 characters and dropped when the room ends. It does not need sealed memory. Without a VoxCPM2 endpoint you read the answers instead of hearing them.
2. Show one object. Hold up something non-sensitive and select Look at this. Nothing is captured before the click. The browser asks for camera permission, takes one frame, shrinks it to fit a 48 KiB message and stops the camera. The worker then makes one SAM 3.1 call and one or two Spark calls (Spark is retried once if it answers that it saw no image). The page shows the still, the object summary and a mask outline, or a bounding box labeled as a fallback. Discard view clears it. With a voice configured the character also says "I see a ..." when it is not already speaking.
3. Ask about it. "What do you think of this?" The worker adds that room's last look to the prompt for ten minutes, as session-only context that is never sealed. It saw a single still, and it is told to say so.
4. Show memory and proof only if you have them. The look is saved as an unsealed record in your local volume. It joins a Merkle root only after an operator seals it and commits the root with private keys ([committer runbook](docs/005-committer-runbook.md)); talking never sends a transaction. On a fresh stack the Life & proof page at `/life` reports no verdict, which is correct. A valid proof and a rejected tampered copy have been observed only for the owner's committed identity, listed below.

Use your own non-sensitive object, or a sample you may redistribute, and label any prerecorded input. `agent/fixtures/hello-two-speaker.wav` is prerecorded speech credited in [built-vs-borrowed](docs/built-vs-borrowed.md), and `app/fixtures/plant-synthetic.png` is a synthetic plumbing test. Neither shows live recognition.

## Claims and evidence

Dated evidence comes from files in this repository. "Re-checked" means it was run again against this commit or read live on 2026-11-03.

| Claim | Evidence | Kind and date | Limits |
| --- | --- | --- | --- |
| Memory store keeps versions, builds Merkle proofs and rejects a tampered record | [memory-demo.mjs](agent/scripts/memory-demo.mjs), [memory tests](agent/scripts/memory.test.mjs) | Re-checked from a fresh clone, 2026-11-03 | Synthetic facts, fake extractor, no network |
| Automated suites pass | Commands in Path A | Re-checked, 2026-11-03 | Fakes and fixtures only; no live inference |
| The Anchor program is live on devnet with a genesis character | [docs/devnet.md](docs/devnet.md) | Dated 2026-10-28 to 2026-10-30; program account re-read as executable on 2026-11-03 | Devnet can be reset. Signing keys are not in the repository |
| Two memory roots are committed on devnet (epoch 0 and epoch 1) | [docs/029](docs/029-memory-identity-linkage.md), [epoch-1 transaction](https://explorer.solana.com/tx/4hYrLRj2Ezu6ygV5zk8n5pCmJ5PomibiTKBADLB9PkicWPDhogaYR5wUJiz7rNwDi1AG1ugq135ig4sCD2X78Nev?cluster=devnet), [history account](https://explorer.solana.com/address/BVF8KRRGK6CV55GaQd4KdJFhYtrKX1GekFdoVpn1AY6p?cluster=devnet) | Dated 2026-11-01. Re-checked 2026-11-03: the transaction is finalized without error, and the history account is owned by the program and contains both roots | Roots are public hashes. Memory contents stay private |
| A real memory proves valid against the devnet root, and a tampered copy is rejected | [docs/029](docs/029-memory-identity-linkage.md), [docs/033](docs/033-recovery-and-submission.md) | Owner-observed in a browser on a private deployment, 2026-11-01 and 2026-11-02 | You cannot repeat it from a fresh clone: it needs the private memory contents and the operator login |
| The character recalls sealed memories in conversation | [ticket 021 review](audit/021-recall-into-conversation/review.md) | Reviewed 2026-10-31 | Sealed, owner-only records. Capture from a fresh microphone was deferred |
| A multi-turn voice conversation on the deployed build | [owner acceptance](docs/027-owner-voice-acceptance.md), [synthetic-input check](docs/027-end-to-end-voice-evidence.json) | Dated 2026-11-01. The synthetic check used no physical devices and one measurement | No latency, echo or barge-in measurement. The 2026-11-02 recovery check could not repeat it (key rejected, above) |
| One-frame vision path, with the camera-size transport fix and per-room follow-up | [root cause](docs/031-vision-root-cause.md), [runbook](docs/vision-demo-runbook.md), [follow-up tests](agent/scripts/037-recent-look.test.mjs) | Dated 2026-11-01 to 2026-11-03; tests re-checked | Fake frames and fakes. The only recorded live pair in the runbook, on a uniform green test image, returned no mask and no observation |
| Heartbeat life-stage crank passes locally | [independent review](docs/007-independent-review.md) | Dated 2026-11-01, LiteSVM, 17 tests | No live crank, reward mint or vault |

Current manual rehearsal, not backed by a repository artifact: the owner reported that the character recognized a "recessed ceiling light" through a real camera, then held a multi-turn conversation. The live worker also logged transcription failures after those successful turns. No recording or log of either is committed, so treat both as an owner report. Your own run may differ.

Not live, whatever the architecture document says:

- Arcium private-memory challenge: a [feasibility report](docs/arcium.md) only. It found that Arcium's in-circuit hash is SHA3-256, not the Keccak-256 used for these commitments.
- x402 self-payment: no paywall code exists in the repository.
- Judge minting: ticket only.
- Heartbeat crank, trait evolution and the dream cycle: the deployed program has memory-root commits and runtime-gated trait evolution, but no trait mutation has run on devnet and the dream cycle is not scheduled ([review](audit/006-dream-cycle/review.md)). The heartbeat crank exists only in local tests, with no live crank or reward setup ([devnet notes](docs/devnet.md)).
- Continuous vision: deliberately cut. Vision is one explicit frame per click.

[Architecture and requirements](docs/architecture.md) states the intended design, including items above that are not built. [SOULBOUND.md](SOULBOUND.md) is the master plan and decision log.

## Architecture, models and privacy

```
browser <-> LiveKit <-> worker:  Voice Transcribe -> Spark -> VoxCPM2 -> audio back to the room
                                 "Look at this": one frame -> Spark + SAM 3.1 -> observation
                                 after each turn: Spark extraction -> versioned records
operator (offline, private keys): seal epoch -> Merkle root -> commit_memory_root on Solana devnet
app /life: reads the devnet history, verifies an inclusion proof, tries a tampered copy
```

| Model | Role | Runs on |
| --- | --- | --- |
| Muse Voice Transcribe 1.0 (Meta) | Speech to text and speaker labels | Meta Model API |
| Muse Spark 1.3 (Meta) | Conversation, image observation, memory extraction | Meta Model API |
| SAM 3.1 (Meta) | Object segmentation on a look | Meta Responses API, through `@meta-sam/parser` |
| VoxCPM2 (OpenBMB, not Meta) | Spoken replies, optional | A GPU host you provision |

The hackathon asks for Meta models at runtime ([compliance note](docs/029-meta-model-compliance.md)). Self-hosted Meta MMS TTS was built and measured at 9.4 to 98.7 seconds per short sentence on rented CPU, so the owner kept VoxCPM2 ([docs/030](docs/030-mms-tts-swap.md)). The text-only configuration calls Meta models only. Muse Image and Muse Wonder are not called in the demo path.

Privacy boundaries:

- Audio, transcripts and the one captured frame go to Meta's Model API, using the non-contributor model names. Reply text goes to your VoxCPM2 endpoint if you configure one.
- Raw memories stay off-chain. Only roots and history are public on devnet, and a hash gives integrity, not confidentiality. A valid inclusion proof shows a record is in a committed history, not that it is true.
- Vision is never continuous. The frame buffers are zeroed after use, the mask overlay is never stored, and the stored record keeps a frame hash and text, not pixels ([vision privacy boundary](docs/vision-demo-runbook.md)).
- The token route is a demo issuer with guest identities, and the operator login is a rehearsal gate. Neither is production authentication. Production use would need HTTPS and WSS, real admission control and rate limits.

## Limitations and submission status

- No uptime or session durability is promised. If transcription stops, leave and rejoin the room.
- The architecture's latency target (first audio p50 under 2.5 seconds) has not been demonstrated. The measured cold first chunk for VoxCPM2 was 11.3 seconds ([docs/030](docs/030-mms-tts-swap.md)).
- Real-camera recognition rests on one owner report. The camera-size fix has automated tests, not a recorded acceptance run.
- The Warden visual is procedural and audio-reactive. It is not lip sync or a likeness rig.
- The repository has no top-level license file yet. Third-party material is listed in [built-vs-borrowed](docs/built-vs-borrowed.md) and [third-party notices](docs/024-third-party-notices.md).
- The [submission checklist](docs/033-recovery-and-submission.md) is dated 2026-11-02 and lists open gates. Later commits address some of them (camera transport, per-join rooms), but those fixes have not been re-accepted on a fresh live run. The submission is not ready until the demo video is recorded and its claims are checked against the table above.
- Do not publish API keys, operator credentials, signing keys, runtime manifests or personal memories. Some dated reports in `docs/` mention temporary operator-gated tunnel URLs. They are expired or login-protected and are not part of the setup path.
