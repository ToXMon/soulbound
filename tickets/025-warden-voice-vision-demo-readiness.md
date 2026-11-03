# Ticket 025: Warden voice and vision demo readiness

Date: 2026-11-01
POC: Tolu Shekoni
TL;DR: Make the approved Warden room the integrated demo baseline, reuse committed Ticket 008 vision, support speaker playback, and establish honest readiness gates. A build is not a live acceptance test.

## Authorization and intent

Tolu approved the Warden UI and asset and requested that the project use it for a winning, reliable voice-and-vision demo recorded without headphones. Preserve all existing dirty work and the alternate human portrait. Do not promise flawless production behavior. Do not deploy publicly or spend on inference during implementation. AdaL independently verifies.

Preserve REQ-40/41 (voice latency and consistent VoxCPM2), REQ-43/44/70 (explicit vision capture and provenance/privacy), REQ-51/71 (proof and honest model visibility), REQ-60 (speech not payment gated). Do not edit REQs or earlier tickets.

## Model and execution

Use pi as separate doer, current non-Surplus `openai-codex/gpt-6.1-sol`. Concrete alternatives tested: listed github-copilot/kimi-k3 rejects with model_not_supported; listed venice/deepseek-v4-pro cannot execute because provider is unknown. No Surplus. No commits/push/reset/stash. Record pre-edit baseline outside repo and compare protected files. Do not print, read via tool output, copy, or commit secrets.

## Scope

1. Existing approved Warden UI/component/portrait remain primary and alternate. Keep existing changes intact. Add project docs recording approved primary visual and exact source provenance. Source/asset bytes must persist in checkout; no remote image dependency.
2. Reuse committed vision implementation from clean worktree `.agents/worktrees/ticket-008-eyes-sam`, commit `1b05bab`, not a new invented protocol. Integrate only its vision-related changes into current page, worker, token capabilities and package dependency/lockfile. DO NOT replace page wholesale or lose Warden/audio/diagnostics. Inspect raw source yourself. Allowed new/reused files: its `agent/src/vision/`, `agent/src/memory/observation.ts`, `vision-sidecar.ts`, `vision-sidecar.test.ts`, `agent/scripts/vision-demo.ts`, `app/app/vision-trigger.ts` and tests, `app/fixtures/` with provenance. Existing integration edits: `app/app/page.tsx`, `app/app/room.module.css`, `app/app/api/token/route.ts`, `agent/src/index.ts`, `agent/package.json`, `pnpm-lock.yaml`. Preserve current life-stage/main-branch work; do not merge branch wholesale.
3. Speaker mode: explicitly request echoCancellation, noiseSuppression, autoGainControl for browser microphone capture (reuse LiveKit API). Show requested vs actual support/settings honestly. Keep a single remote-agent audible path. Add accessible microphone mute/unmute control for recording safety; never auto-enable capture on page load. Do not claim acoustic echo cancellation eliminates all feedback. No default headphone requirement. Explain moderate speaker volume and built-in mic positioning; if feedback persists operator mutes mic while agent speaks. Do not implement naive silence-gating from a persistent audio track, fake barge-in or secretly break full duplex. Do not change VoxCPM2 TTS/model/voice path or per-reply synthesis decision. Preserve existing interruption/reset logic and gated avatar energy.
4. Add app-ready truthful model presentation: Meta Voice Transcribe for recognition, Meta Spark for conversation/vision, SAM 3.1 for segmentation only if actually integrated/configured. Keep live response model separate from architecture labels. VoxCPM2 is OpenBMB voice synthesis, NOT Meta: disclose accurately without hiding stack. No fabricated costs, inference results, masks, receipts, synchronization claims or latency.
5. Add a secret-safe local preflight CLI `agent/scripts/demo-preflight.mjs` (and tests) that reports ONLY boolean presence/configuration and sanitized health statuses for necessary env names, no values/URLs/tokens, no inference. Use existing env loading appropriately; no shell source/eval of secret files. Explicit path inputs or Node --env-file are fine. Check frontend/worker LiveKit config, Meta inference credentials presence, TTS configured/voice description/seed, memory/vision config prerequisites. Missing config must be actionable and nonzero for required live path; mere credential presence is NOT connectivity or provider entitlement. Optional HTTP health probes read-only only, bounded timeout; never output response body or URL with secrets. No inference/network spend, no shell command interpolation of secret values. Do NOT load .env values into model context.
6. Document production/exposure boundary: existing unauthenticated token issuer and guest identity are demo access, not owner authentication. Bound room/name, token TTL, grants and no-store response using minimal installed SDK facilities. Do not silently introduce shared-password auth or claim production-grade multitenancy. Public hosting/auth/rate limits/HTTPS/WSS/secret management remain explicit blocking gates if not implemented.
7. Add `docs/025-demo-readiness.md` with date/POC/TLDR, changes, exact run commands (app + worker + LiveKit), speaker-mode setup, real rehearsal script (two consecutive unscripted voice turns, silence, interruption, track remove/reconnect, camera click object recognition, mask vs bbox, later recall), 20-turn latency protocol and measured browser render perf procedure. Clearly label pending live tests and require operator confirmation for audible quality/timbre and physical speaker echo. No paid tests, microphone/camera activation, remote deployments/chain transactions or video recording by builder. Existing $5 vision note is not blanket inference authorization.
8. Ignore only generated isolated Next output with a narrow `.gitignore` addition (`app/.next-*/`), preserve other patterns. UI work is already in source, do not inadvertently add build artifacts. Allowed docs: README.md integration/startup notes, docs/025-demo-readiness.md and docs/025-builder-report.md. Do not edit SOULBOUND decision log, audit, other tickets/REQs, global styles, unrelated chain/backend code.

## Acceptance and verification

- Warden default and approved human portrait alternate, transcript, proof link and all diagnostics remain.
- Visible explicit Look at this action, truthful result/error UI, camera tracks cleaned after one capture/disconnect, no capture/network before explicit trigger. Existing bounded vision envelope, id correlation, no retries/budget bypass, sanitized worker failures and private memory linkage preserved.
- Voice browser capture explicitly requests processing, reports actual settings (not unsupported guarantees), accessible mic toggle. All audible agent speech remains received LiveKit/VoxCPM2, avatar follows gated received track.
- All pre-existing tests pass; new speaker/preflight/token/vision tests cover behavior/security.
- `pnpm --filter agent build`.
- `node --experimental-strip-types --test app/components/living-portrait/*.test.ts`.
- Compile vision-trigger .js-import tests to a temp dir as documented in docs/vision-demo-runbook.md; execute emitted tests.
- Execute agent vision and memory sidecar suites plus existing applicable suites.
- `pnpm --filter app exec tsc --noEmit --incremental false`.
- `SOULBOUND_DIST_DIR=.next-025-build pnpm --filter app build` (isolated; never target active .next). Restore ONLY generated next-env/tsconfig changes from this run baseline, check against concurrent human work first.
- `git diff --check` and protected baseline comparisons. Do not connect mic/camera during builder verification. Avoid modifying the Ticket008 worktree.
- Report exact tests, missing dependencies/config/services, unverified live claims, performance not measured, and no public production certification. Stop if source conflicts cannot be safely resolved.
