# Ticket 026: Akash end-to-end deployment

Date: 2026-11-01
POC: Tolu Shekoni
TL;DR: Deploy the current local Warden room, Meta worker, LiveKit and pinned VoxCPM2 for a bounded private rehearsal.

Owner explicitly authorized AdaL to implement deployment changes directly using built-in capabilities, without pi or Surplus. Author/reviewer independence is waived for this ticket; verification is not an independent code review. Preserve all existing dirty work. No commits/push or private memory migration.

Approved limits: up to 15 ACT combined escrow, projected total provider costs at most 2 ACT for initial two-hour test, gas at most 0.1 AKT. No automatic topups/domain purchase. Protect existing deployments 28831027 and 29314839. Only newly created test deployments may be cleaned up. Record actual accepted rates, start/deadline, closure and remaining balances. Do not rent idle GPU while app packaging remains blocked.

Scope: deployment artifacts under akash/; deny-by-default .dockerignore; Dockerfile; app/middleware.ts access gate; app token route bounded grants/runtime public LiveKit URL; client consumes returned URL; narrow generated-output gitignore entry; deployment runbook. No existing audio/TTS/portrait/inference changes. Preserve REQ40/41/43/44/60/70/71; never fabricate live results.

Package linux/amd64 with local current source/asset allowlist. No .env, personal memories, chain keys, audit or caches in build context/layers. Runtime secrets private outside repo. Public image publishing only after local secret exclusion and source inspection. No inference provider changes. Use pinned working Vox image/model revision and WAV stream protocol.

Require trusted HTTPS for browser UI and WSS signaling; direct public media UDP/TCP must be reachable. Do not claim HTTP tunnels carry WebRTC media. Check provider capacity before signing. No public unauthenticated token minting or proof-data exposure: whole-app access gate fails closed in production without configured credentials. Short-lived fixed-room tokens; self-asserted identity remains not owner auth.

Verification: app and worker builds; existing portrait/vision tests; gate/token offline checks; Linux native runtime image launch; image context secret exclusion; deployed TLS/WSS/media; Vox health/model auth/stream probes only within inference authorization. Real mic/camera activation and subjective quality require operator rehearsal. Record blockers honestly, close any unusable paid leases within approved scope.
