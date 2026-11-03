# Ticket 035: consistent synthetic character voice

Date: 2026-11-02
POC: Tolu Shekoni
TL;DR: Owner reports changing speaker timbre and uneven interaction. Keep VoxCPM2, bind one synthetic speaker reference across replies, and verify actual listening before claiming REQ-41 passes.

## Authorization and requirements

Owner explicitly requested one voice during today's submission sprint. Preserve REQ-40/41 and existing privacy, cancellation and single-audible-path behavior. This task does not authorize real-person voice cloning or a new engine. The existing voice document requires owner acceptance before reference conditioning replaces Voice Design; present the synthetic-reference approach explicitly. A generated SOULBOUND character reference is not permission to use someone's real voice.

## Evidence so far

- Deployed provider/model match VoxCPM2; seed is 42 and description matches documented voice A.
- Current pipeline already uses one synthesis request for the complete reply.
- Test browser has one attached audio element, not demonstrated duplicate playback.
- Upstream VoxCPM documentation says text-only Voice Design does not bind timbre across calls. The pinned vLLM-Omni v0.32.0 example supports `ref_audio` as data URI and precomputed custom voices. Exact upstream source was inspected through GitHub; verify the running server contract before use.
- Meta transcription accepted a fresh handshake after owner resolved billing; real fixture transcription and Spark replies were observed. Audible reply failed because configured Vox HTTPS URL is unreachable.
- GPU forwarded unauthenticated health returns 200 and model route 401. Provider lease-shell reports service failed despite ready status. No secure synthesis sample was obtained; drift is owner-reported, not independently reproduced today.

## Execution boundaries

Do not start until Ticket 034 implementer exits and reviewer assigns this ticket. Prefer the live-tested open-weight surplus/deepseek-v4-pro. Preserve all existing dirty work. No commits/push/reset/stash, secrets/env reads, chain actions, inference calls, paid deployments, real media capture or audits by the code builder.

## Proposed implementation scope

agent/src/tts.ts, agent/scripts/tts-provider.test.mjs, agent/scripts/pipeline-tts.test.mjs; a small focused voice-reference module and tests only if needed; agent/.env.example; docs/voice.md and docs/035-builder-report.md. Do not modify app/page or agent/index unless separately scoped after diagnosis.

## Acceptance

1. Explicit opt-in fixed synthetic reference configuration, no fallback from invalid/missing reference to randomized Voice Design. Fail visibly. Existing text-only and explicitly selected Voice Design behavior remain deliberate, not silent fallback.
2. Read a bounded local WAV reference once; validate MIME/format/size, avoid arbitrary remote fetch, pin the reference digest and pass the same supported conditioning for every request. Never log/publish reference bytes, local paths containing personal data, request bodies or credentials. No reference from another user's memory or recorded voice.
3. Retain one full-reply synthesis request, fixed seed/config, WAV validation, cancellation/backpressure and exactly one audible product path. Do not restore per-sentence independent random synthesis. Test stable reference across differing text and rejection paths, not just identical text determinism.
4. Review turn supersession separately before changing concurrency. Any stale-turn audio/clear race must have a reproduced regression at the actual concurrent seam; do not invent a fix from speculation.
5. Operator restores trusted speech endpoint before bounded comparisons. Compare same text twice and at least two different replies under the same synthetic reference, then reconnect/restart when safe. Tolu judges speaker identity, intelligibility, gaps and echo. Byte repeatability alone is not timbre acceptance; unit tests alone cannot pass this criterion.
6. Final docs distinguish implemented, deployed, objectively tested and owner-listened outcomes. No latency guarantee or REQ-41 PASS without evidence.

## Verification

```sh
pnpm --filter agent build
node --test agent/scripts/tts-provider.test.mjs agent/scripts/pipeline-tts.test.mjs agent/scripts/tts-core.test.mjs
# Run any newly introduced reference tests with their exact documented command.
git diff --check
```

Builder must document the exact running-server compatibility boundary and tests. Operator samples stay private until reviewed for rights and secret safety. No engine switch, real-person clone or production-readiness claim.
