# CCIP 2.0 LinkLab — mined notes for SOULBOUND

Source: "Build Faster, More Secure Cross-Chain Applications with CCIP 2.0" — Chainlink LinkLab livestream, recorded 2026-10-22 (Dave + Julian/ETH Labs). Transcript: YouTube ASR (expect recognition errors). Mined 2026-10-26 for the CCIP stretch goal (architecture.md §14). **CCIP remains CUT unless Days 1–7 finish early — this file is preparation, not scope.**
**Verified 2026-10-27:** original transcript file (`/tmp/38D26D97-BA7F-4236-9FD5-128209EBE013.txt`, 713 lines) re-read in full; every fact below checked against it. Live numbers from the demo: full finality Sepolia→Fuji estimated 16m27s, completed 14m39s; FTF (5 confirmations) estimated 1m07s, completed 1m19s; Chainlink Local ~3s.

## What matters for us

1. **CCIP 2.0 has an SDK, CLI, and API** — the CLI is `npx`-runnable with a **non-interactive mode for agents**. `get fee`, lane latency estimates, message history, manual execute for failed/pending messages. Our backend can send/track without custom Solidity (confirms the starter kit's `sdk-examples/ccip-send.ts` path).
2. **Finality is a knob, not a wait.** `blockConfirmations` in extraArgsV3: `0` = full finality (~14–16 min Sepolia), `5` = FTF (~1 min, demoed live at 1m19s). All parties must agree (token pool, verifier/CCV, executor). **For memory-root mirrors, use full finality — roots are async and 15 minutes changes nothing.** FTF is a demo gimmick we don't need.
3. **Chainlink Local** (Oct 5, 2026 version onward supports CCIP 2.0) — in-memory fork simulation of the full router/DON path, ~3 seconds, no RPC, no gas. This is how we test the stretch without touching a testnet. Foundry: install + remap + import the CCIPLocalSimulatorFork (their example: `SeolaToFujiFork.sol`, assert mint on destination). Also demoed: an ACE policy (reject list) attached to a pool via advanced pool hooks, tested locally.
4. **CCIP 2.0 architecture:** per-lane routers; committing DON + executing DON + RMN (risk management network); nothing moves until source-chain consensus; additive verification via **CCVs** (cross-chain verifiers — self-run or third-party, marketplace model); **ACE** = automated compliance engine (pre/post-flight policy hooks; managed beta by request, but available inside Chainlink Local).
5. **CCT** = an ERC-20 that transfers cross-chain via CCIP with zero extra code; FTF = CCT + per-party confirmation thresholds.
6. **Gas lesson (his live failure story):** messages that get "blessed" then fail = insufficient destination-chain gas. Fund BOTH sides the day before (already in our runbook).
7. **Ethereum FCR (fast confirmation rule):** consensus-layer rule dropping bridging to 12–24s, not yet live at recording; CCIP will support it with zero code change. Watch `fastconfirm.it` — irrelevant to our timeline but worth knowing.
8. **Agent skills:** `npx skills add smartcontractkit/chainlink-agent-skills` (`--skill chainlink-ccip-skill -g` for CCIP only). Skills are trained on official docs/samples — use them when the CCIP stretch activates. (Also confirms our own pattern: skills as project-local agent knowledge, same as our `.agents/skills/` setup.)
9. **Signal from chat:** someone literally commented "do x402 and make agents pay for it" during the stream. The agentic-payments thesis has live community pull.

## If the stretch activates (Day 8 go/no-go)

- Base the mirror on the starter kit's **Example 02** (arbitrary data message → `BasicMessageReceiver`): message = `(characterId, epoch, merkleRoot)`.
- Test entirely in **Chainlink Local** first; only then Sepolia → Base Sepolia with both sides pre-funded.
- Sender on Solana side stays v1-simple: same root committed by backend in a plain Solana tx; CCIP carries the EVM mirror. Do NOT attempt Solana↔EVM CCIP lanes in the hackathon window.
- Gotchas (from the setup guide): `evm_version='cancun'`, throwaway keystore wallet via `cast wallet import`, never paste keys into prompts/env files, pre-flight with the CLI's `get fee` + lane latency before sending.
