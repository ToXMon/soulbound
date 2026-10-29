# Ticket 003 deployment runbook (Akash, self-custody)

Status: **LIVE — Gate B passed on dseq 29283087 (see Live record below).
Spending was approved in stages by Tolu (10 ACT escrow, raised ceiling,
then max-bid widening). The Spending plan section below is the historical
Gate A proposal; actuals are in the Live record.**

Official tenant skill: `akash-network/akash-skill` @
`7bc7e5aa11edccbe285a95bab2dd5dbb5f6cccac` (`skills/akash/SKILL.md` +
pricing / compute-resources / deployment-lifecycle / wallet-setup /
common-commands / gpu-models guides). Stay on the self-custody
`provider-services` path. AKT (`uakt`) pays gas; ACT (`uact`) pays escrow.

## Verified readiness snapshot (rechecked 2026-10-29, read-only)

- Wallet (existing, reuse — do not create another): key name `burner`,
  keyring-test, public address `akash1d92ua8cqelkky67566htu8nymc2zktwh0kvl7k`.
- Balances requeried: **25.883282 ACT, 9.949934 AKT**. Balance is not budget.
- Certificates: 2 on-chain certs, state `valid` (contents never printed here).
- **Protected: dseq `28831027` ACTIVE (CPU-only). Do not close, update, fund,
  restart, or reuse it.** Its escrow is not touched by this ticket.
- Prior dseq `28789899` is closed; it is not reused.
- Chain `akashnet-2`, RPC `https://rpc-akash.ecostake.com:443`.
- CLI: `akash` 2.1.2. `provider-services version` panics inside the Muse
  sandbox (bind restriction); run provider-services with escalated sandbox.
- Docker client 29.1.3 present; daemon not running (only relevant for a local
  image build — none is needed; the pinned upstream image is used directly).

## Pinned deployment contract (Gate A)

| Item | Value |
| --- | --- |
| SDL | [deploy.yml](/Users/tolushekoni/Desktop/soulbound/akash/deploy.yml) |
| Image | `vllm/vllm-omni:v0.32.0@sha256:6b44ee504a0dc3a21eacf72e7dc5da318b7bcc8ed0e349dc928e67278414430c` (amd64) |
| Model | `openbmb/VoxCPM2` revision `32279effe8c19989596f05d353d1447f51d9e915` |
| Command | `vllm serve openbmb/VoxCPM2 --revision <pin> --omni --host 0.0.0.0 --port 8000 --api-key <runtime secret> --stage-init-timeout 900` |
| GPU | 1× 24 GB: `rtx3090` / `rtx4090` / `l4` (cheapest that passes readiness+latency wins; no A100/H100 by default) |
| CPU/RAM/storage | 4 CPU (amd64), 16 GiB RAM, 20 GiB default + 30 GiB ephemeral `/models`. Justified by upstream peak ~13 GiB VRAM-side runtime, ~10 GiB image, ~8 GiB weights/cache. |
| Replicas | 1 |
| Max price in SDL | **8000 uact/block** (tenant maximum; actual cost is the accepted bid) |
| Model cache | `HF_HOME=/models/hf` on the 30 GiB volume: survives container restart on the same lease only. It does **not** survive lease close/redeploy — never claim otherwise. |

Cost math (from actual bid, ~6 s blocks ≈ 600 blocks/hour, 14,400/day):
`ACT/hour = bid_uact_per_block × 600 / 1,000,000`. At the 8000 max:
4.8 ACT/hour, 115.2 ACT/day — the max is a ceiling, not an expectation.

## Spending plan (requires Tolu's explicit numeric approval)

No budget is authorized yet. Proposed bounded test, to be approved as exact
numbers before any signing/broadcasting:

- Action 1: `tx deployment create` with `--deposit 5000000uact` (5 ACT escrow).
- Gas: paid in AKT at `0.025uakt` gas price; reserve AKT, never convert all.
- Lease: accept the cheapest 24 GB bid ≤ 8000 uact/block that then passes
  readiness; record actual bid before estimating hourly/daily cost.
- Maximum test duration: 2 hours from lease creation, then close.
- Total authorized loss ceiling: 5 ACT escrow drawdown + <0.1 AKT gas.
- Cleanup: `tx deployment close --dseq <NEW>` (exact close also needs the
  approved cleanup step). A local timer is not a guaranteed stop if the Mac
  disconnects; no automatic top-ups. Escrow is monitored manually.
- Existing dseq `28831027` is never a cleanup/close target in this ticket.

## Procedure (only after numeric approval)

All commands read `akash/deploy.yml` via a local secret-substituted copy:

```bash
export AKASH_NODE=https://rpc-akash.ecostake.com:443
export AKASH_CHAIN_ID=akashnet-2
export AKASH_KEYRING_BACKEND=test
export AKASH_GAS_PRICES=0.025uakt
ADDR=akash1d92ua8cqelkky67566htu8nymc2zktwh0kvl7k

# local-only copy with the runtime secret substituted (never commit it)
cp akash/deploy.yml /tmp/soulbound-003-deploy.local.yml
# replace REPLACE_WITH_RUNTIME_SECRET in the /tmp copy with a fresh secret

provider-services sdl-to-manifest /tmp/soulbound-003-deploy.local.yml
provider-services tx deployment create /tmp/soulbound-003-deploy.local.yml \
  --deposit 5000000uact --from burner
provider-services query market bid list --owner $ADDR --dseq <NEW_DSEQ>
provider-services tx market lease create --dseq <NEW_DSEQ> --gseq 1 --oseq 1 \
  --provider <CHEAPEST_24GB_PROVIDER> --from burner
provider-services send-manifest /tmp/soulbound-003-deploy.local.yml \
  --dseq <NEW_DSEQ> --gseq 1 --oseq 1 --provider <PROVIDER> --from burner
provider-services lease-status --dseq <NEW_DSEQ> --gseq 1 --oseq 1 \
  --provider <PROVIDER> --from burner   # provider URI lives here
```

Then Gate B: set `TTS_BASE_URL` to the actual provider URI and
`TTS_API_KEY` to the runtime secret (agent env only), run
`scripts/tts-readiness.sh`, then the three `tts-smoke.sh` samples. Streaming
must be proven through the provider URI itself (proxy buffering flags prove
nothing). On failure: capture lease logs, stop, report exact evidence.

Cleanup (approved step, new dseq only):

```bash
provider-services tx deployment close --dseq <NEW_DSEQ> --from burner
provider-services query deployment get --owner $ADDR --dseq <NEW_DSEQ>
```

## Attempt 1 record (2026-10-29, dseq 29277211) — lease closed by provider

- Create tx `CBF6B940…298AAD8` (10 ACT escrow, approved by Tolu), lease tx
  `36805DF6…352AA8C` (Overclock, 265.75 uact/block ≈ 0.16 ACT/h), manifest PASS.
- Provider closed the lease (unspecified reason); withdrew 0.988338 ACT.
  No container logs retrievable after close. Deployment closed by Tolu's
  option: close tx `ACDBB160…D7D05E`, **9.011662 ACT refunded**.
- Total attempt-1 loss: **0.988338 ACT + ~0.013 AKT gas**. Protected
  `28831027` untouched throughout.
- Serve command re-verified against v0.32.0 source afterwards: `--omni` and
  `--stage-init-timeout` in `vllm_omni/entrypoints/cli/serve.py`; `--api-key`,
  `--host`, `--port` in vLLM `entrypoints/launchers/cli_args.py`; `--revision`
  is a `ModelConfig` field (auto-exposed). The command is valid; failure cause
  remains unproven (GPU allocation / image pull / provider-side are candidates).
- No custom Docker image exists or is needed: providers pull the public
  `vllm/vllm-omni:v0.32.0` digest from Docker Hub directly.

## Attempts 2–4 record (2026-10-29) — bid race, then no bids

- Attempt 2 (`29281453`, approved 10 ACT, 8000 ceiling): Overclock bid
  265.75 uact/block, **closed by provider before acceptance** (`bid not open`).
  Closed by us; full 10 ACT refunded.
- Ceiling test (`29281856`, Tolu-approved 50000 max; price cannot be updated
  in place — `groups are different` — so close+recreate): same 265.75 bid,
  lease accepted (tx `DED2BA96…DF57C`), manifest PASS, then **kube lease
  never appeared in 16 min** of status polls. Closed; provider withdrew
  0.064578 ACT during the active lease.
- Minimal-SDL test (`29282193`: single `rtx3090` without ram pin, no arch,
  single 50 GiB storage): official matcher says exactly **1** live provider
  fits (Overclock). Its bid again closed within seconds; a 20-poll
  race-accept loop then saw **zero open bids**.
- Diagnosis (live `match_providers.py` + console-api): 1871 registered →
  59 online → 31 audited → 3 fit the full SDL. Price is not the filter
  (identical 265.75 bid at 8000 and 50000 ceilings). The binding constraint
  is live GPU inventory/bid churn on essentially one provider.
- State after attempt 4: `29282193` ACTIVE with 10 ACT escrow intact
  (recoverable by close), balances 14.830366 ACT / 9.904020 AKT,
  protected `28831027` active and untouched. No endpoint exists; Gate B
  smoke/readiness cannot run. Do not claim endpoint proof.

## Live record (2026-10-29) — Gate B endpoint proven, dseq 29283087

Diagnosis that unlocked bids: audited-only `signedBy` + narrow GPU list gave
a 3-provider live funnel and one flaky bidder. Removing the restriction and
broadening GPUs (Tolu: "max out my ACT", 500000 uact ceiling, 23–24 ACT
escrow) produced **4 bids within seconds**; cheapest accepted was still
Overclock at 265.75 uact/block (~0.16 ACT/h). Manifest must be sent within
seconds of the lease or the provider closes it (one lease died that way).

Two serving bugs found in logs and fixed:
1. Official image lacks the `voxcpm` package → `ImportError: No module named
   'voxcpm'`. Launch now runs `pip install -q voxcpm==2.0.3` first.
2. Shared-HTTP ingress on this provider returned nginx 404 while the app was
   healthy inside. Switched to a forwarded TCP port (also avoids proxy
   buffering of streams).

Live contract (verified through the actual provider address):
`http://provider.ahn3-na.akash.pub:30670` (forwarded port, provider
`akash1p5qkxeu3hcxzx9nvfvva93pyvxcyqduly9udz9`), Bearer auth enforced
(`/v1/models` 401 without key). Model id must be `openbmb/VoxCPM2`.
`response_format="pcm"` streams are dropped by the server; **`"wav"` +
`stream=true` + `stream_format="audio"` streams** (44-byte header, then raw
48 kHz mono s16 PCM). Observed: health 200; readiness warm-up + 3 probes OK;
smoke TTFB ~0.5s vs total ~1.3s; 48 kHz WAVs 1.6–2.7s, non-silent.
Note: POST streams must not go through the local Muse sandbox proxy (it
resets them); run smoke/readiness with escalated network.

Escrow/burn: 23 ACT deposited on 29283087 at 265.75 uact/block ≈ 0.159
ACT/hour (runway ~144 h). Cumulative Ticket 003 losses across all attempts:
~1.07 ACT withdrawn + ~0.06 AKT gas. Protected `28831027` untouched.
Cleanup (when approved): close 29283087 only.

## Handoff brief for AdaL (2026-10-29) — browser test diagnosis wanted

**Where everything lives**
- Implementation: staged in this repo's git index (19 files, `git diff --cached`).
  Nothing committed — ticket incomplete. Unrelated `docs/gtm/`, `.atskills/`,
  and Tolu's uncommitted ticket edit are deliberately untouched.
- Doer session log (full chat + tool evidence):
  `/Users/tolushekoni/.local/share/muse/sessions/2026/10/29/01a18606-7cce-7413-bda9-361a13229d0b/session.jsonl`
  (local Mac file — read it there; it is not redacted for sharing beyond Tolu/AdaL).
- Live endpoint: dseq `29283087`, `http://provider.ahn3-na.akash.pub:30670`,
  lease ACTIVE at 265.75 uact/block (~0.16 ACT/h, 23 ACT escrow). TTS key is
  only in gitignored `agent/.env` and `/tmp/soulbound-003-tts-key.txt`.
- Voice samples for Gate D: `/tmp/soulbound-003-voice-{a,b,c}.wav`,
  `/tmp/soulbound-003-voice-desc{B,C}.wav`. Tolu has not yet picked A/B/C.

**Current blocker (Tolu, live test)**
All three services running (LiveKit `--dev`, `pnpm dev`, agent worker from
`agent/` with `--env-file=.env`), browser hard-refreshed, headphones advised.
Symptom: **no transcription and no voice reply at all** in the UI.

**Doer has verified (read-only)**
- `agent/.env` names present: LIVEKIT_API_KEY/SECRET/URL, META_API_KEY
  (Spark fallback path), TTS_BASE_URL/API_KEY/MODEL/SEED/DESCRIPTION.
  `app/.env.local` names present incl. NEXT_PUBLIC_LIVEKIT_URL.
- Endpoint proven independently of the browser (readiness + 3 smokes OK).

**AdaL — please diagnose from evidence, likely first checks**
1. Agent terminal output after Join (worker registered? `[agent] participant
   in room`? VT WebSocket error? The worker joins, then `vt.connect()` — a VT
   failure would kill transcription while the room looks fine).
2. Browser status line + button state (connected vs token fetch failure).
3. LiveKit server log on join (participant + agent job dispatch).
4. Whether browser/agent/LiveKit all agree on `ws://localhost:7880` + same
   dev key/secret printed by `livekit-server --dev`.

Doer did not edit `audit/` per ticket instruction; packaging
`audit/003-voxcpm2-voice-out/` remains AdaL's step.

**Resolution since that brief (doer, later 2026-10-29)**
- Tolu confirms multi-turn spoken conversation + visible transcripts, one
  agent, one audio track, single-agent leave/rejoin passed.
- Voice shift reproduced (`/tmp/soulbound-003-sent-{concat,combined}.wav`);
  Tolu chose the combined sample → pipeline now synthesizes ONE request per
  reply (`pipeline.ts` + `pipeline-tts.test.mjs`). Consistency across turns
  and after restart still needs Tolu's confirmation (REQ-41 open).
- 20-turn export analyzed (`run-b4888cd9`, 20/20 clean): REQ-40 FAIL on
  Spark TTFT (p50 4962 ms). Fix shipped and agent-path-verified:
  `reasoning_effort=minimal` (default ~700 hidden tokens → ~75; first token
  755–930 ms). REQ-40 remains UNVERIFIED pending a fresh post-fix 20-turn
  run — numbers and probe tables in `docs/live-voice-latency.md`.
- Browser `markerToAudioPlaying` was unavailable 20/20 (`pending` gate);
  fixed in `page.tsx`.
- Still open for verification: interruption/cancellation live test,
  deliberate TTS-failure live test, post-fix 20-turn rerun, Gate D
  description pick (A/B/C), controlled restart re-readiness.

**AdaL — independent verification requested**
Re-run build + 26 deterministic tests; review the committed diff; verify
the endpoint contract claims against the Live record above; package
`audit/003-voxcpm2-voice-out/`. Do not mark REQ-40/41 PASS without the
post-fix live evidence listed here.

## Failure behavior

TTS errors never block text conversation (agent logs `[tts] FAILED`, UI shows
the failure, text reply is preserved). No fallback provider, no Console or
managed-inference switch without a new approved decision.
