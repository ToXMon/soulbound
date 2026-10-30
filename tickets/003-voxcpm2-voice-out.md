# Ticket 003: voxcpm2-voice-out

Date: 2026-10-29
Owner: Tolu Shekoni
Verifier: AdaL
TL;DR: Prove a pinned VoxCPM2 endpoint, then LiveKit playback, then streamed Spark sentence → TTS audio. No financial transactions until Tolu approves a specific bounded spend.

## Intent and authority

Make Soulbound answer aloud in its designed voice, preserving the working voice-in/text-out loop. Implements REQ-40 (warm first-audio p50 <2.5s), REQ-41 (locked voice seed), REQ-42 regression, and architecture D13/D15. Architecture also specifies warm p95 <4s and three consecutive clean readiness runs. Do not edit REQs to accommodate a slow implementation.

019 is owner-accepted diagnostic context, not a first-audio PASS: manual finished-speaking marker→DOM proxy p50 3819ms/p95 5269ms; Spark full-response p50 3256ms. Streamed first-sentence synthesis must replace waiting for full Spark completion. Measure actual results rather than promising a speedup.

## Files in scope

- `akash/`: SDL, pinned serving image Dockerfile/build configuration if needed, readiness/prewarm and bounded lifecycle scripts.
- `agent/`: TTS adapter, Spark streaming, ordered audio publication, tests, documented placeholder-only env configuration, extension of latency diagnostics.
- `app/app/page.tsx`: remote audio attachment/playback activation, teardown, minimal playback diagnostics; preserve existing UI/diagnostics.
- `.env.example`: placeholders only, if app configuration requires them.
- `scripts/tts-smoke.sh` and `scripts/tts-readiness.sh`.
- `docs/voice.md`, `docs/003-deployment-runbook.md`, `docs/live-voice-latency.md`, `docs/built-vs-borrowed.md`.
- Lockfile/manifests only for a necessary, explicitly justified dependency; reuse installed SDKs first.

No architecture, other ticket, SOULBOUND.md or audit edits. No wallet/private-key files in scope.

## Verified readiness snapshot (recheck before using)

- Mac: `akash` 2.1.2; `provider-services` v0.16.4; Docker client installed, daemon not running at inspection.
- Existing local keyring-test wallet named `burner`, public address `akash1d92ua8cqelkky67566htu8nymc2zktwh0kvl7k`; certificate filename exists. No secret/certificate contents inspected, signing ability or certificate validity not established.
- Live mainnet balance observed: 25.883282 ACT and 9.949934 AKT. Requery; balance is not spending authorization.
- Existing ACTIVE deployment dseq `28831027`, CPU-only. Protect it: do not close, update, fund, restart or reuse it for this task without explicit approval.
- Mainnet `akashnet-2`; RPC `https://rpc-akash.ecostake.com:443` responded and provider-services balance/deployment queries worked.
- No wallet creation, ACT minting or deployment transaction was performed during preparation. Reuse the funded wallet; no new wallet is needed now.

## Required references

Read the official tenant skill before deployment:
https://github.com/akash-network/akash-skill/blob/main/skills/akash/SKILL.md
Preparation revision: `7bc7e5aa11edccbe285a95bab2dd5dbb5f6cccac`.
Use its pricing, compute-resource, self-custody and bid-matching guides from the upstream tree. Some skill loaders fetch SKILL.md without its companion guides; retrieve the real referenced paths rather than invent commands.

Stay on the existing self-custody provider-services path unless incompatibility requires an explained, approved migration. AKT/uakt pays gas; ACT/uact pays compute escrow and lease prices. Existing ACT means no conversion is currently necessary.

Upstream serving sources:
- https://github.com/OpenBMB/VoxCPM
- https://huggingface.co/openbmb/VoxCPM2
- https://voxcpm.readthedocs.io/en/latest/deployment/vllm_omni.html
- https://github.com/vllm-project/vllm-omni/blob/main/examples/online_serving/text_to_speech/README.md

Revisited reference: https://github.com/frankramosdev/akashvisionagent
Its SDL is CPU-only hello-world, NOT a VoxCPM2 GPU deployment. Its browser audio renderer/start-audio pattern is relevant; its OpenRouter/Nemotron model path is not. Keep architectural reference attribution. No LICENSE was found: do not copy repository code on the strength of verbal clearance alone.

## Gate A: deployment contract and spending plan

Read-only discovery and local implementation may proceed. Before signing/broadcasting ANY deployment, lease, deposit, ACT conversion or certificate transaction:
- Show Tolu network, public wallet, exact action, gas estimate, escrow deposit, per-block maximum, estimated hourly/daily ACT cost, maximum test duration and total authorized loss.
- Ask for explicit numeric approval; no budget has been authorized by this ticket. Wallet balance is not a budget. Reserve AKT for gas; never convert the entire balance.
- Compare available suitable GPU candidates, including a 24GB 3090/4090 where compatible. Select the cheapest candidate that passes measured readiness/latency, not the cheapest regardless of performance. Do not rent A100/H100 by default.
- Pin container image/version (prefer digest), compatible serving commits and model revision. Build GPU image for the provider's architecture, not accidentally Mac arm64. No moving main/latest.
- One TTS replica and one GPU initially. Justify CPU/RAM/cache/storage from the actual image/model; avoid oversized resources or duplicate leases.
- Document cost calculation from actual uact/block bid and observed/explicit block interval, not a fixed marketing quote.
- Set bounded escrow/runway, monitor it and obtain permission for exact cleanup/close action. A local timer is not a guaranteed stop if the Mac disconnects. Do not add automatic top-ups.
- Never touch the existing dseq. Report new transaction hashes and dseq only from actual successful results.
- Protect keyring-test files; it is not an encrypted vault. Never print mnemonics, keys, PEM contents or credentials. Authentication material must not enter public SDL, image layers, browser bundles or evidence.

Stop at this approval gate when funding/deployment is needed. Do not silently switch to Console, managed inference or another model.

## Gate B: endpoint first

Prefer pinned vLLM-Omni: it documents `/v1/audio/speech` VoxCPM2 serving. Nano-vLLM's Python generator/non-production `/generate` MP3 demo is not a drop-in OpenAI server.

Prove on the chosen deployment:
- Spark-authored natural-language Voice Design description supplied in VoxCPM2 input as `(<description>)<text>`; no real-person reference audio.
- Actual streaming request/response contract, auth, content type, sample rate, channel count and PCM format. Candidate documented options are stream=true, stream_format=audio, response_format=pcm; verify against the pinned service.
- Native VoxCPM2 48kHz output, chunk arrival before synthesis ends, valid bounded PCM decoding, timeout and cancellation.
- Public endpoint access control with runtime secrets; no publicly open unlimited inference service.
- Test incremental bytes through the ACTUAL provider URI. Official Akash skill warns proxy buffering controls are not yet honored by all providers; an SDL flag alone proves nothing.
- Health/readiness after model load, application-level warm-up, three consecutive clean probes, controlled restart and re-readiness. Syntax validation alone is not runtime readiness.
- Reuse/cache model weights where cost-effective; document cache behavior across restart/redeployment without claiming persistence beyond its scope.

If image/GPU/streaming/auth fails, stop with exact evidence; do not wire an imagined endpoint into the product.

## Gate C: audio egress and pipeline

Prove known audio plays through the pinned LiveKit SDK and target browser before combining TTS.
- Publish ordered mono PCM via installed rtc-node AudioSource/LocalAudioTrack APIs verified from installed declarations.
- Attach/detach browser remote audio; handle autoplay rejection with a visible user activation control.
- Preserve frame boundaries across arbitrary HTTP chunks; retain odd-byte leftovers; validate metadata and convert/resample only when required. Avoid full-response buffering.
- Use headphones initially; verify the agent does not transcribe its own audio into an echo loop. Do not disable diarization as a shortcut.

Then stream Spark:
- Meta `muse-spark-1.3`, non-contributor, stays the conversational model. VoxCPM2 is the explicitly approved speech renderer under D13/D15.
- Preserve final assembled reply, speaker classification, model identity and text publication.
- A bounded sentence assembler emits complete sentences, flushes the trailing fragment once, and handles punctuation/split tokens without duplicate speech.
- VoxCPM2 accepts fixed sentence text with streamed AUDIO output; do not assume token-by-token text ingestion.
- First complete Spark sentence starts synthesis before full reply completion. Preserve sentence/audio order using a bounded queue and backpressure.
- Expose a replaceable TTSProvider streaming interface with explicit format metadata and cancellation; no silent provider fallback.
- Handle generation/publish errors visibly; preserve usable text conversation on TTS failure. Do not pass a failed voice test as successful.
- On disconnect/shutdown/new-turn policy, cancel or drain explicitly; no stale speech, unbounded queues, listeners or orphan inference. Document interruption/barge-in behavior, even if full production barge-in is deferred.

## Gate D: voice selection and repeatability

Spark writes the description; generate up to three candidates and let Tolu select. Record description, seed, model/serving revision and parameters in docs/voice.md (no auth secrets).
Seed support is NOT a documented guarantee of stable timbre: test identical text twice and different sentences under the exact deployment, then repeat after restart.
Tolu confirms voice consistency. If Voice Design cannot satisfy REQ-41, report BLOCKED for a product decision. Do not silently introduce reference cloning, including a synthetic-reference mode.

## Gate E: measurement and acceptance

- [ ] `scripts/tts-smoke.sh` yields an audible, valid 48kHz WAV from the deployed endpoint; repeated chosen-voice samples are available outside the repo for review.
- [ ] Exact pinned image/model/serving revisions and runtime format documented.
- [ ] SDL converts/validates with supported installed tooling, new GPU lease is observed running, secure streamed endpoint survives restart, three consecutive warm probes succeed.
- [ ] Known PCM plays in browser; real Mac speech produces an audible reply in the selected voice with correct text/model record and no self-trigger loop.
- [ ] Spark first-sentence→TTS streaming overlap is observed, not inferred from flags.
- [ ] Tests cover sentence splits/trailing text/order, PCM chunk boundaries, queue bounds, cancellation, failures and text-only regression.
- [ ] Extend 019 diagnostics with first-token/first-sentence/first-TTS-chunk and browser playback observations; never subtract unrelated monotonic clocks.
- [ ] One declared warm-up plus 20 measured real speech turns; all failures/timeouts/duplicates reported, p50/p95 with defined boundaries. REQ-40 warm first-audio p50 <2.5s and architecture p95 <4s tested without redefining the target.
- [ ] Physical speech-end and first audible playback require defensible observations (for example reviewed timing of a consented local recording). Agent queue/HTTP bytes/track attachment/manual click proxies alone cannot establish first-audio PASS. Document manual/clock/measurement limitations; if only proxies are available mark exact acceptance unverified, never relabel them.
- [ ] Document GPU bid, per-block/hour/day costs, escrow/runway, new dseq, health, bounded test plan and cleanup procedure. No unauthorized spend or change to existing deployment.
- [ ] Full build and deterministic tests pass; borrowed dependencies/skills credited. No fabricated deployment, benchmark or seed guarantee.

## Verification and handoff

Stop only identified app dev processes before a full Next build; do not build and dev against the same .next output concurrently. Never kill unrelated services or start duplicate workers.

```bash
env -u NODE_ENV pnpm build
node --test agent/scripts/live-latency-report.test.mjs
provider-services sdl-to-manifest akash/deploy.yml
scripts/tts-readiness.sh
scripts/tts-smoke.sh "Hello, I am alive." /tmp/soulbound-003-voice-a.wav
scripts/tts-smoke.sh "Hello, I am alive." /tmp/soulbound-003-voice-b.wav
scripts/tts-smoke.sh "I remember everything we build together." /tmp/soulbound-003-voice-c.wav
```

Implement/document the exact speech benchmark command before asking Tolu to run it. Existing `--speech` is a requested deliverable, not assumed current functionality; reject unsupported flags. Run deterministic added tests with documented commands and use metadata-only timing exports outside the repo.

Worker from agent directory:
```bash
node --env-file=.env --import ./polyfill-error-event.mjs dist/index.js start
```

Doer must not edit audit/ or this ticket. Report gates completed, test results, explicit blockers and the next human action. Tolu supplies/redacts the Muse session export; AdaL independently verifies and packages `audit/003-voxcpm2-voice-out/`. Stop at unmet gates rather than declaring completion or broadening scope. Commit completed implementation with ticket ID and required attribution; do not push or claim PASS without the project's review/merge process.

## Non-goals

Lip-sync, avatar animation, cloning real people, multiple voices, new conversational models, memory/on-chain/payment features, production-scale autoscaling or full deployment-platform hardening. Baseline auth, validation, bounded resource use, error handling and privacy are not optional.
