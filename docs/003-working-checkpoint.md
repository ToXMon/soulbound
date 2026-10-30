# Ticket 003 working checkpoint

Date: 2026-10-29
Owner: Tolu Shekoni
TL;DR: Preserve the working voice implementation at `5e38540`. Proceed to memory work with owner acceptance; REQ-40/41 verification remains open.

## Acceptance status

Tolu reports working spoken conversation and chose to continue building before full independent verification. This checkpoint is not a formal PASS. Outstanding: selected voice and cross-text/restart consistency, post-fix 20-turn first-audio benchmark, live cancellation/failure/echo tests, and the first-sentence-overlap tradeoff.

## Reproduce the working configuration

- Application implementation: Git commit `5e38540` and its committed lockfile.
- TTS image: `vllm/vllm-omni:v0.32.0@sha256:6b44ee504a0dc3a21eacf72e7dc5da318b7bcc8ed0e349dc928e67278414430c` (linux/amd64).
- VoxCPM2 weights: `openbmb/VoxCPM2`, revision `32279effe8c19989596f05d353d1447f51d9e915`.
- Startup package: `voxcpm==2.0.3`, currently installed at container startup. Its transitive packages are not fully frozen; the image digest alone does not capture that installation. Preserve observed behavior and collect a safe package-version inventory before a later rebuild.
- Working speech request: `stream=true`, `stream_format=audio`, `response_format=wav`. Decode the WAV framing and validate 48kHz mono s16le PCM. Raw PCM response mode failed on this serving build.
- Pipeline: stream Spark text, then issue ONE TTS request for the completed reply. Do not restore separate sentence requests during Ticket 004; Tolu selected combined synthesis for better voice consistency.
- Spark remains `muse-spark-1.3`, non-contributor, with the implementation's minimal reasoning-effort default.
- Voice configuration: preserve existing private runtime values. docs/voice.md describes candidate A, seed 42 as current provisional settings; final selection/lock is pending. Do not overwrite private settings based on this document.
- Keep current gitignored agent/.env and app/.env.local in place. Never commit or print their contents. Tolu should retain a private backup in an appropriate encrypted store; no secret backup is embedded here.

Application rollback is a deliberate return to the known commit on a clean checkout or branch, never a destructive reset over uncommitted memory work. Preserve private env configuration separately. Returning application code does not recreate or restart a GPU lease.

## Existing deployment

- Network: akashnet-2.
- Owner: `akash1d92ua8cqelkky67566htu8nymc2zktwh0kvl7k`.
- TTS dseq: `29283087`; gseq/oseq: 1/1.
- Provider: `akash1p5qkxeu3hcxzx9nvfvva93pyvxcyqduly9udz9`.
- Documented forwarded endpoint: `http://provider.ahn3-na.akash.pub:30670`.
- Last read-only chain query during this checkpoint: deployment and lease both reported active.
- Actual accepted rate: `265.753915 uact/block`. At an assumed six-second block interval this is about 0.15945 ACT/hour, 3.82686 ACT/day. Recalculate from current block cadence before budgeting.
- Initial escrow was 23 ACT. Latest query showed 23 ACT stored with an older settlement height; this is not a guarantee of currently spendable escrow or remaining runway. Account for accrued lease charges since settlement.
- Do not confuse the SDL ceiling of 500000 uact/block with the accepted lease rate.
- Protected unrelated CPU dseq `28831027` must remain untouched.

Keeping a lease open reserves compute and incurs charges even with no TTS requests. Stopping the worker or container does not necessarily stop lease billing. Closing the deployment ends this resource allocation; recreating it may change the endpoint and lose model cache.

No close, restart, deposit, conversion, replacement lease or automatic top-up is authorized by this checkpoint. For continued testing, retain the working lease only within Tolu's previously approved budget and review its accrued cost. For a long break, ask Tolu to authorize closing this exact TTS deployment after preserving configuration and recovery instructions. A replacement lease must pass readiness again.

The documented endpoint uses plain HTTP. Bearer authentication does not encrypt transport. Avoid sensitive conversation text over untrusted networks; document verified TLS/private transport as a separate security follow-up rather than implying this checkpoint is production hardened.

## Memory-work boundaries

Ticket 004 must not change deployment resources, TTS request mode, voice settings, inference model choice, reasoning effort, audio output or cancellation policy. Run the existing voice tests alongside new memory tests. A memory failure must not lose the text or audible reply, and memory extraction must not be awaited before reply publication.

Return to the outstanding 003 verification before final rehearsals. Any new functional voice regression blocks further feature integration immediately.
