# Memory ↔ chain identity linkage (Ticket 015/005/021 follow-up)

Date: 2026-11-01
POC: Tolu Shekoni
TL;DR: The deployed demo now reads the REAL devnet character 895354: the Life & proof page shows the live chain panel, the two sealed epoch-0 memories, a VALID inclusion proof against the committed root, and INVALID on a tampered copy — all observed in a browser. Cleanup a2dc4f extended to Nov 2 00:00 local by owner instruction. Owner authorized devnet spend for the epoch-1 growth commit (pending voice session + exact-tx presentation).

## What changed

- Deployment 29328587 (app) manifest updated in place (tx `0D94170194D12369495D0212AF3FB96958BEDD2D0FA5ADFB641ACBFE7F6F738F`, fee 10000uakt): `MEMORY_OWNER_ID=demo-rehearsal→CdvYdEJUk4gxXhz53v7SAKggzfyKx5ho85uRhhvnMKs1`, `MEMORY_CHARACTER_ID=warden-027-87c48999→895354`. Everything else (image digest, LiveKit/TTS creds, worker) unchanged; transport 29328467 and Vox 29328579 untouched.
- The genuine Mac-local 895354 store (epoch 0, 2 records, root `67929cc8…4a2092c`) was seeded into the persistent `/data/memories/<keccak ns>` volume via lease-shell; bytes verified identical by SHA-256; ownership corrected to uid 1000 (first attempt failed as root-owned 0600 — EACCES for the read service; that was the only fault).
- App tunnel recreated inside the container after restart. NEW demo URL: https://bold-exhibition-parliamentary-composite.trycloudflare.com (old relatives-wonderful… URL is dead — expected for temporary tunnels).

## Observed live (browser, 2026-11-01 ~19:14–19:18 UTC)

- Life & proof: `Life stage · born`, `Confirmed slot 517596141`, genesis trait vector `genesis:calm,curious,bold`, mood `curious`, epoch `0`, explorer links for asset/config/history.
- Memories panel: 2 sealed memories (epoch 0), ids `e2ce3093…`, `a5abad54…` (ids only; no private content in public page).
- Proof: "VALID — inclusion verified against the committed Solana root" (1566 ms). Tampered copy: "INVALID — proof does not match the committed root."
- Worker re-registered to the room after restart ("registered worker", LiveKit 1.13.11). Voice path configuration unchanged.

## Epoch-1 growth commit — DONE (2026-11-01 ~20:05 UTC)

- Owner voice session produced 3 extracted memories (turn 5: name, project, voice preference). Container store: 5 records (2 epoch-0 sealed, 3 epoch-1 unsealed).
- Container store synced to the Mac staging store (lineage verified by content hashes), sealed with `commit-memory-root.mjs --seal --session-settled`: **epoch 1, root `f400a2c158778917dc1292ec8070e0ab2d69a5aa22ffd1ba4132ddcc40a409a3`**.
- Unsigned dry-run passed; private approval JSON created (approvedBy Tolu, per owner's explicit devnet-spend authorization in chat; CLI-conservative cap 32100360 lamports, actual cost **10000 lamports fee** — history rent already paid).
- Commit tx: `4hYrLRj2Ezu6ygV5zk8n5pCmJ5PomibiTKBADLB9PkicWPDhogaYR5wUJiz7rNwDi1AG1ugq135ig4sCD2X78Nev`. First reported `pending`; dry-run re-run reconciled: **`confirmed`, `reconciled: true`**. Chain readback: history PDA now holds 2 entries — epoch 0 `67929cc8…`, epoch 1 `f400a2c1…`.
- Sealed store re-seeded into the container (atomic tmp+rename, uid 1000), container restarted, tunnel recreated. **New demo URL: https://approved-coins-electronics-uncle.trycloudflare.com**
- Observed in browser on /life: memories dropdown shows epoch 1 (3 records) and epoch 0 (2 records); epoch-1 proof **"VALID — inclusion verified against the committed Solana root"** (1567 ms, confirmed slot 517610501); tampered copy **"INVALID"** (1476 ms, slot 517610561).
- Spoken recall note: recall only draws on sealed records (ticket 021), so before this commit Warden said "I don't know your name"; after the rejoin on the new URL it should answer from the sealed epoch-1 records. A client-side artifact was diagnosed during verification: a page URL containing embedded Basic-auth credentials makes in-page fetch() throw instantly ("Request cannot be constructed from a URL that includes credentials") — always navigate to the clean origin before testing proofs.

## Honest boundaries

- The demo conversation now writes NEW memories under identity 895354 (worker env). Until they are sealed and committed they are local-only and the page will not claim otherwise (unsealed records never appear; proofs for them would say not-committed).
- Trait/attribute growth on-chain (life_stage etc.) still requires the separately gated heartbeat path; the growth demonstrated by the epoch-1 commit is memory history, not trait mutation.
- The container store and the Mac store are the same lineage; the Mac copy remains the sealing/committing authority (signing keys stay Mac-local).

## Next (authorized by owner, exact tx to be presented at execution)

1. Owner voice session on the new URL: speak memorable facts.
2. Sync container store → Mac staging, `commit-memory-root.mjs --seal --session-settled` for epoch 1.
3. Dry-run, then `--send` with a private approval JSON (approvedBy Tolu, lamport cap, expiry). Runtime signer `2CU934…`, payer/owner `CdvY…`, history PDA `BVF8K…` already holds epoch 0; epoch-1 commit needs only the tx fee (~0.00001 SOL).
4. Restart app container, re-seed sealed store before any voice turn, recreate tunnel, verify epoch-1 memory shows with VALID proof.
