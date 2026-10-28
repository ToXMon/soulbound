# Research — Arcium privacy primitives & Jev decision model for SOULBOUND

**Date:** 2026-10-28 (Day 1, pre-kickoff) · Author: AdaL (thinker) · Status: PROPOSAL — nothing here is scope until Tolu ratifies (REQs and tickets change only by his word).
**Sources:** docs.arcium.com (overview, MXE overview, basic-concepts, fetched 2026-10-28); LangChain blog "Building a harness with Jev" + LangSmith decision-model docs; RouteLLM paper (arXiv 2406.18665).

## Part 1 — Arcium (docs.arcium.com)

**What it is:** a blockchain-based encrypted-computation network using MPC. Arx nodes hold secret shares (no single node sees inputs); computations run offchain in Cerberus inside an **MXE** (MPC eXecution Environment = one Solana program + its computation definitions + key material + one Cluster); the cluster signs the outcome and invokes an on-chain **callback**. **Arcis** is the Rust/Anchor-compatible framework for writing encrypted computations. Solana handles orchestration, finalization, and application integration. Fault behavior: aborts on detected protocol faults (never returns corrupted results) — lifecycle must handle retries/queue expiry. Status/pricing not stated on the pages fetched (verify at activation).

### Candidate enhancements (mapped to REQs)

| # | Enhancement | What it adds | REQs touched |
|---|---|---|---|
| A1 | **Private memory challenge** ("audit the childhood without reading the diary") | Judge poses a yes/no memory question; an MXE computes over the *encrypted* memories and the signed boolean lands via callback on Solana. Stronger than Merkle inclusion proof: proves a *property* of memory content, not just inclusion. Best demo beat of the three. | REQ-50..52 adjacent (new capability, no conflict) |
| A2 | **Encrypted owner voiceprint** | Diarization speaker embeddings are biometric data. Store/compute the owner-voice verification in an MXE so the plaintext embedding never exists post-enrollment. Privacy story: "your voiceprint is split across nodes, not sitting in a database." | REQ-42 adjacent |
| A3 | **Private dream-cycle aggregation** | The trait-delta *aggregation* (weighted post-processing after Spark's journaling) runs in an MXE over encrypted journals; only the delta + journal hash post on-chain. NOTE: the journaling itself stays Spark Open (Meta) — Arcium wraps deterministic post-processing only. | REQ-20..22 adjacent |

### Hard non-goal
**Confidential LLM inference inside MXE is OFF the table.** It would put a non-Meta model into the product inference path — violates model purity (non-negotiable 2). Arcium wraps *data privacy around* Meta-model outputs; it never replaces Meta inference.

### Verdict
Strong **stretch-tier** material (S4 candidate). Arcium is real Solana-native privacy with the exact "verifiable without readable" story SOULBOUND already tells — A1 especially compounds the thesis. But it adds an MPC dependency, latency, and an immature-status network to a solo 10-day build: **Day 8 go/no-go material, same gate as CCIP.** Zero work before then beyond this note.

## Part 2 — Jev (TypeSafe decision model, LangChain ecosystem)

**What it is:** a decision model that takes state + typed questions and returns probabilities/choices/scores (not prose). LangChain positions it as a complement to the main LLM: bounded decisions, parallel questions. Evidence: LangChain's judge experiment reported ~$0.00035/call at 0.44s vs Claude at $28.17 total for the same battery — with explicit caveats that the eval was narrow; TypeSafe's "200× faster / 400× cheaper" are vendor claims. RouteLLM research confirms the general router quality/cost trade-off.

### Candidate roles (mapped to our build)

| # | Role | Fit | Purity check |
|---|---|---|---|
| J1 | **Memory-write gate** (durable? sensitive? duplicative? → write/skip/flag) | Cheap pre-filter before Spark Open consolidation | ⚠️ Product path + personal data → **violates model purity as written**. Needs explicit Tolu amendment, or keep the gate inside Spark structured output (current plan) |
| J2 | **Turn router** (Spark vs Spark Open by complexity/stakes) | Cuts cost on the real-time loop | Same purity concern, weaker (routing ≠ personal-data inference) — still needs ratification |
| J3 | **Spend/safety gate** (REQ-61 daily cap, action risk scoring) | Bounded allow/block decisions | Same concern; mostly deterministic anyway — low value |
| J4 | **Dev-harness judge** (regression: is the character's reply in-persona across sessions? score traces nightly) | **Clean fit** — dev harness, not product path; non-Meta models are explicitly allowed there | ✅ Allowed today |

### Verdict
**Adopt J4 now** (character-consistency judge in the nightly dev harness — it strengthens my verification loop and the evidence trail at ~zero cost). **J1/J2 are a Tolu decision**: they're genuinely useful but sit in the product path; adopting them means amending non-negotiable 2 with a carve-out like "tiny non-Meta decision models permitted for bounded routing/gating, never for personal-memory content or generation." If he says no, the current design (Spark structured output does its own memory gating) stands unchanged.

## Decision requests for Tolu
1. Ratify **S4 (Arcium private memory challenge)** as a stretch ticket behind the Day 8 gate? (A1 recommended; A2 optional; A3 cut as complexity creep.)
2. Ratify **J4** (dev-harness Jev judge) — no purity conflict?
3. Decide **J1/J2**: amend model purity with the bounded-decision carve-out, or keep memory gating inside Spark? (My recommendation: keep purity intact for the hackathon; revisit post-submission.)
