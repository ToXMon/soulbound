# Warden voice and vision demo readiness

Date: 2026-11-01
POC: Tolu Shekoni
TL;DR: Warden is the approved primary UI, with the unchanged human portrait alternate. Vision integration and speaker-mode controls are present and compile. Live demo acceptance is blocked: the configured VoxCPM2 health request timed out or was unreachable, and no local LiveKit server was listening at inspection. No physical microphone/camera or paid inference was activated.

## Verified in this session

- Stopped the external coding session when Tolu requested AdaL capabilities only. No replacement external session was started.
- Reused Ticket 008 vision code from its separate committed worktree. Integration changes remain uncommitted and need final review; no wholesale branch merge or reset was performed.
- Installed the already-declared SAM parser using the existing frozen lockfile.
- `pnpm --filter agent build`: PASS.
- Worker vision and private sidecar suites: 31 PASS, 0 FAIL.
- Compiled browser vision-trigger tests: 10 PASS, 0 FAIL.
- Existing avatar and Warden tests: 57 PASS, 0 FAIL.
- App TypeScript no-emit check: PASS.
- `SOULBOUND_DIST_DIR=.next-025-build pnpm --filter app build`: PASS. Active `.next` output was not targeted.
- `git diff --check`: PASS.
- Temporary verification type-directory and route-reference changes were removed. Existing unrelated work was preserved; no commit or push.
- Production preview at http://localhost:3025 renders Warden, portrait selector, Start audio, microphone toggle, processing disclosure, explicit Look at this, discard action, transcript, proof link, diagnostics and truthful architecture labels.
- Boolean-only local configuration checks found app/worker LiveKit variables, a Meta credential, TTS configuration, voice description/seed and memory namespace/storage present. Credential presence is NOT provider connectivity, entitlement or validity.
- Read-only TTS `/health` probe with an 8-second timeout failed: unreachable or timed out. Endpoint and secrets were not printed. No synthesis request was made.
- No process was listening on local port 7880. This does not rule out an independently configured remote LiveKit endpoint.

## Speaker-based recording

Headphones are not a demo requirement. Browser microphone capture explicitly requests echo cancellation, noise suppression and automatic gain control. The settings disclosure reports browser API support and actual track settings after capture; requests alone do not prove acoustic echo cancellation works.

Use moderate speaker volume, a quiet room and a microphone positioned away from direct speaker output. Run a real echo rehearsal before recording. If self-listening or feedback persists, use the visible Mute mic control during agent playback, then unmute for the next turn. This is an operator fallback, not verified full-duplex or barge-in performance. Recording should capture system playback and your microphone as separate inputs where supported, with monitoring disabled to avoid a second audible loop. A screen recording cannot be assumed to include system sound without a recorded playback check.

## Truthful model labels

Recognition: Meta Voice Transcribe. Conversation/observation: Meta Spark. Segmentation: SAM 3.1 adapter. Speech synthesis: OpenBMB VoxCPM2, explicitly approved by project architecture; it must not be represented as a Meta model. Warden is a procedural audio-reactive visual, not a human likeness rig or phoneme/viseme animation.

## Required live gates before filming

1. Restore the existing VoxCPM2 deployment or correct its private endpoint configuration. Do not fund, restart or redeploy paid infrastructure without the owner's exact approval. Repeat health checks, then obtain a bounded synthesis/rehearsal budget.
2. Confirm configured LiveKit connectivity and start the existing worker with local secret loading. Typical worker command from root: `node --env-file=agent/.env agent/dist/index.js dev`. Confirm CLI mode against the installed worker before relying on this command. For a local topology, start the installed LiveKit server with an approved local configuration; do not assume development server credentials match the app and worker.
3. Open the production preview; deliberately join and grant microphone permission. Confirm actual processing settings and a remote agent track. Observe two unscripted speaker-based voice turns twice consecutively. Have Tolu judge clarity, stable timbre, volume and unwanted echo/self-replies.
4. Verify Warden follows received agent playback, remains closed during silence, and resets on mute, interrupted reply, track removal and disconnect/reconnect. Do not infer this from generated text or server timestamps.
5. Explicitly click Look at this for one non-sensitive object. Obtain approval for bounded SAM/Spark inference first. Verify useful observation, nonempty real mask or labeled bbox fallback, private memory linkage and later spoken recall. No continuous camera capture or guessed masks.
6. Run one warmup plus 20 measured latency turns using retained diagnostics. Report browser-clock boundaries and failures honestly. Text latency and media playing events are not physical first-audio proof.
7. Measure rendering on the recording hardware with actual agent playback, not just synthetic poses. Inspect dropped frames/long tasks and the resulting recording. No 60fps or hardware-performance claim has been established.

## Still unverified / production boundary

Live VoxCPM2 synchronization, audible quality, speaker echo behavior, voice consistency, actual SAM/Spark image success, real reconnect/interruption behavior, latency and rendering performance remain unverified. Earlier vision notes record an unsuccessful live pair, not accepted vision readiness.

The token endpoint is still a starter/demo issuer with caller-selected guest identity and no production authentication or rate limiting. Do not expose it publicly as production-ready. HTTPS/WSS, deployment ownership, admission control, short bounded grants, abuse controls, secret management and live rehearsals remain production gates. No new public deployment was performed.

## Incomplete integration items

The interrupted implementation has not completed token hardening, a reusable sanitized preflight CLI, speaker-specific unit tests or dedicated speaker/vision CSS. The rendered controls exist, but those items must be reviewed and completed under the project author/reviewer rules before certification. Do not treat this report as a PASS for all Ticket 025 acceptance criteria.
