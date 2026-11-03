# MMS TTS swap + memory/Solana live verification

Date: 2026-11-01
POC: Tolu Shekoni
TL;DR: Live Life & proof page re-verified on the deployed app: real devnet character 895354, two sealed epoch-0 memories and the committed root all render. The Meta MMS TTS swap was implemented, deployed and measured, then REJECTED by the owner on latency (9.4–98.7 s vs VoxCPM2's metrics); both test leases were closed and refunded. Product TTS remains VoxCPM2; the owner's 2026-11-01 decision supersedes the Meta-only runtime rule for TTS. Cleanup a2dc4f verified at session start: pending, fires Nov 2 00:00 local.

## 1. Live memory ↔ Solana verification (observed, browser 20:02 UTC)

URL: https://bold-exhibition-parliamentary-composite.trycloudflare.com/life (docs/029-memory-identity-linkage.md remains accurate).

- `Life stage · born`, `Solana devnet · read-only`, **Confirmed slot 517608255** (fresh, later than the 517596141 recorded earlier — chain reads are live, not cached).
- Memories panel: 2 sealed memories, epoch 0, ids `e2ce3093-7b39-4dbf-bf0e-b86cb5567a36` and `a5abad54-0192-4182-b96b-4694491504e7`; local sealed root `67929cc8…4a2092c` shown with an explicit "not yet checked on-chain" label until proof runs.
- Attribute table honestly reports "Not in birth instruction" for mood/life_stage/epoch and only the personality vector from the birth instruction; no inferred values.
- Footer keeps the honest-state rules: "Unavailable ≠ invalid · Local seal ≠ on-chain commitment"; explorer link to history PDA `BVF8KRRGK6CV55GaQd4KdJFhYtrKX1GekFdoVpn1AY6p`.

### Identity map (deployed runtime ↔ earlier chain work)

| Item | Value | Source |
| --- | --- | --- |
| Chain owner | `CdvYdEJUk4gxXhz53v7SAKggzfyKx5ho85uRhhvnMKs1` | devnet.md, deployed env (tx `0D94…738F`) |
| Character ID | `895354` (canonical decimal u64) | devnet.md, deployed env |
| Config PDA | `74dRYy2RARkhQs963QcGZdVXhfjABm2BGC7WFwSd7Ehc` | devnet.md (154 B, bound to owner+character) |
| History PDA | `BVF8KRRGK6CV55GaQd4KdJFhYtrKX1GekFdoVpn1AY6p` | devnet.md; holds epoch-0 root |
| Core asset | `8ra3ckcmgWRhFyWBiCz6KPLM76hugAYhjeEzZCxc8fHU` | devnet.md |
| Committed root (epoch 0) | `67929cc8390f37f570f24420c3c83c7e176afbdfd14b751e5b837d9704a2092c` | devnet.md + live page |
| Runtime signer | `2CU934FR5LwgnngkBYTH2yzYvJ7UeXvSNYUnaoZBd6HM` (Mac-local key) | devnet.md rotation receipt |
| Store namespace dir | keccak-derived from owner+character; genuine Mac store seeded into persistent `/data/memories` volume (SHA-256 verified) | docs/029-memory-identity-linkage.md |
| New voice-session memories | written under 895354; unsealed/local until seal+commit — page shows only sealed records | honest boundary, unchanged |

The earlier `warden-027-87c48999` friendly namespace could never satisfy `deriveIdentity` (canonical decimal u64, `agent/src/memory/committer.ts:15`); that gap was closed by the deployed-env update recorded in docs/029, and is now observed live. No signing keys were read or moved this session; no chain transactions were performed.

## 2. MMS TTS swap — implemented (code), deployment pending owner go-ahead

Owner decision (2026-11-01): swap character speech to self-hosted Meta MMS `facebook/mms-tts-eng` via the TTSProvider seam; VoxCPM2 must not run in the submitted demo.

### Implemented this session

- `agent/src/tts.ts`: shared `WavStreamProvider` base (Bearer + OpenAI-style `/v1/audio/speech` + 48 kHz mono s16le WAV-stream header validation/stripping). `MmsTtsProvider` (name `meta-mms-tts-eng`, ignores voice-description/seed — fixed single voice) and `VoxCpm2Provider` (now explicitly LOCAL-DEV ONLY) both extend it.
- `ttsProviderFromEnv()`: new `TTS_PROVIDER` switch — `mms` (submission), `voxcpm2` (legacy default for local dev), invalid values throw. Empty base+key still means text-only mode; no silent fallback (any provider failure throws and text continues — x402/voice rule preserved).
- `agent/.env.example`: TTS section documented (provider switch, mms default recommendation, Vox local-dev labeling).
- `akash/mms-tts/`: `server.py` (FastAPI + transformers VITS, CPU, Bearer auth, resamples MMS 16 kHz → 48 kHz linear interpolation, streams the exact WAV-stream contract, X-Synth-Ms header, logs no text/audio) + `Dockerfile` (CPU torch, persistent `/data/hf` model cache).
- Tests: 3 new MMS/env-switch tests; `node --test scripts/*.test.mjs` → **84 tests, 83 pass, 1 skipped (pre-existing), 0 fail**. `pnpm build` clean; `server.py` py_compile clean.

### Not yet done (needs owner decisions/actions)

1. **New Akash CPU lease** for the MMS container (image build + publish, SDL draft required). This is new spend: present exact SDL/spec/cost estimate before create. The Vox GPU lease (29328579, ~95% of compute cost) can then be left running until the swap passes rehearsal, then closed by the owner-extended cleanup or an explicit owner-approved early close.
2. Worker reconfiguration: set `TTS_PROVIDER=mms`, `TTS_BASE_URL`/`TTS_API_KEY` to the new lease; keep Vox env out of the submission runtime.
3. **Re-measure first-audio latency** after swap (MMS is one-shot VITS: first chunk ≈ synthesis completion; expected faster than Vox's 11.3 s cold first chunk, but that is an expectation, not a measurement — measure with the latency harness + live turn).
4. **Re-rehearse voice** with Tolu (speaker echo + subjective timbre — the MMS voice is different from the approved Vox persona; treat as a persona change).
5. Owner records the TTS decision in `SOULBOUND.md` §9; README model table finalized (docs/029 draft) with MMS as "self-hosted by us on decentralized compute".
6. Fallback (if MMS cannot be deployed before Nov 4): browser Web Speech — decision documented in docs/029; not preferred.

## 2. MMS TTS swap — implemented, deployed, MEASURED, rejected by owner

Owner decision history (2026-11-01): approve MMS swap → approve test spend → after live measurement, reject: "if this TTS does not meet my current metrics with Vox then forget it ... not every model has to be meta."

### Implemented and observed

- `agent/src/tts.ts`: shared `WavStreamProvider` base; `MmsTtsProvider` and `VoxCpm2Provider`; `TTS_PROVIDER` switch. Serving container `akash/mms-tts/` (FastAPI + transformers VITS, CPU, Bearer auth, 16→48 kHz linear resample, exact WAV-stream contract). Tests: 84 total, 83 pass, 1 pre-existing skip.
- Local amd64 smoke (emulated): 48 kHz mono s16le, non-silent, synth 7.3 s; real TS provider consumed the stream correctly (first chunk 5.2 s emulated).
- Image `ttl.sh/soulbound-mms-1026a@sha256:90aef479e94ace85b3730c97933c4a767a2d210e197bd951af0fbb46282b1f64`.
- Live lease 1 (dseq **29329896**, 2 CPU, Digital Frontier eu-se, 14.0 uact/block): health OK, synthesis **98.7 s** then **66.5 s** ("Quick test.") — unusable.
- Live lease 2 (dseq **29329965**, 4 CPU, quanglong.org, 10.72 uact/block): health OK, synthesis **9.4 s** for a ~3.5 s sentence (roundtrip 11.7 s), non-silent 48 kHz output.
- Bar: VoxCPM2 measured 11.3 s cold first chunk / 11.7 s total, but ~0.5 s TTFB / 1.3 s total warm (docs/003 runbook). MMS is one-shot — no warm streaming gain; 9.4 s best case fails the owner's bar, and voice quality is below the approved Vox persona.
- Owner decision: **reject MMS; keep VoxCPM2; the Meta-only rule no longer requires TTS to be Meta.**

### Closed and verified

- Both MMS test deployments closed on-chain (29329896, 29329965: state `closed`). Balances after: **5.360792 ACT / 9.516817 AKT** (was 5.362173/9.576817) — ~0.0014 ACT settled spend + ~0.06 AKT gas total. No other deployments touched; protected 28831027/29314839 untouched; a2dc4f scope unchanged.
- TTS key file `/tmp/soulbound-mms-tts-key.txt` (0600) can be deleted; nothing references it.
- Code state: MMS provider kept as an optional, clearly-labeled alternative (comments and `.env.example` updated to reflect rejection); default remains `voxcpm2`. No deployed worker env change was made — the live demo voice path is untouched and remains VoxCPM2.

### Superseded next-steps (recorded for history; voided by the owner's rejection)

The original deployment/rehearsal plan (new CPU lease, worker switch to `TTS_PROVIDER=mms`, latency re-measure, voice re-rehearsal, README MMS row, Web Speech fallback) is void — no step beyond the measurements above was taken.

## Honest boundaries


- MMS provider is unit-tested against a loopback stub only; no live MMS synthesis has run. Latency, quality and serving behavior are unverified until the lease is up.
- The deployed worker still runs VoxCPM2 until the swap is configured; the submitted runtime claim must wait for that configuration change.
- Vision fix (Phase 1 of docs/028) not started this session; voice path untouched and still owner-confirmed working.
- No commits made yet; changes are in the working tree pending the release-branch review flow.
