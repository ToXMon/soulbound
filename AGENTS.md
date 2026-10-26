# AGENTS.md — SOULBOUND project constitution

Every agent that opens this repo reads this file first. Role assignment is by harness identity — find your section and follow it. This file is the authority on *how we work*; `docs/architecture.md` is the authority on *what we build* (its REQ tables are human-authored intent and may not be edited by any agent).

## Project

- **Name:** SOULBOUND — a persistent voice+vision AI character with verifiable on-chain continuity and its own wallet. Meta Global AI Developer Hackathon (Indie track, solo), build window Oct 27 – Nov 4, 2026.
- **Master state:** `SOULBOUND.md` (decision log §9 is append-only).
- **Architecture & REQs:** `docs/architecture.md`. Canonical diagram: `docs/architecture-overview.svg`, animated `site/diagram.html`.
- **Tickets:** `tickets/` (template: `tickets/TEMPLATE.md`). **Evidence:** `audit/<ticket>/`.

## Role routing

- **If you are AdaL:** you are the **thinker + verifier**. Load and follow `.agents/skills/thinker/SKILL.md`.
- **If you are Muse Code (muse CLI):** you are the **doer**. Load and follow `.agents/skills/doer/SKILL.md`. When a ticket touches `programs/` or anything Solana/Anchor, ALSO load `.agents/skills/solana-doer/SKILL.md` first. Nine Turbin3 companion skills are also project-linked (`safe-solana-builder`, `solana-architect`, `solana-build`, `solana-test`, `solana-tokens`, `solana-nfts`, `solana-security`, `solana-production-readiness`, `solana-audit-prep`) — load whichever matches the ticket's domain.
- **Any other agent:** read both skills, ask the human which role you play, and do not write code until answered.

## Non-negotiables (both roles)

1. **Authority order:** REQs in `docs/architecture.md` > ticket > your judgment. Agents never edit REQs, tickets, `SOULBOUND.md` §9, or `audit/`.
2. **Model purity:** all product inference is Meta models (Spark 1.3, Voice Transcribe, Image, SAM 3.1, Wonder; Spark Open via Baseten `muse-spark-open-1026`). Never the contributor tier for personal data. Non-Meta models only in dev harnesses, never in the product path.
3. **No secrets in the repo.** `.env.example` documents variables; real values never commit.
4. **Evidence honesty:** never fabricate outputs, tx hashes, addresses, or test results. Unverified claims are labeled unverified (bounded-payments rule).
5. **Ponytail discipline:** reuse > stdlib > platform feature > dependency > minimal new code. Never cut validation, security, or accessibility. Small diffs win.
6. **One ticket = one commit** referencing the ticket id. Work happens only under a ticket.
7. **x402 never gates speech.** Payment failure → conversation continues, receipt `unpaid`.

## Common Commands

```bash
# Day-1+ (once code exists):
pnpm install && pnpm build          # app + agent
pnpm dev                            # local LiveKit room + app
node agent/scripts/latency-harness.ts --turns 20   # voice-turn latency harness
cd programs/soulbound && anchor build && anchor test --skip-local-validator   # LiteSVM suite
solana program show $(grep PROGRAM_ID docs/devnet.md | cut -d= -f2) --url devnet
```

## Project Layout

- `app/` — browser client (LiveKit starter pattern)
- `agent/` — agent worker: Muse Voice Transcribe → Spark → VoxCPM2
- `programs/soulbound/` — Anchor program (character birth, memory roots, trait evolution, heartbeat)
- `paywall/` — x402 gateway (Base)
- `akash/` — GPU deployment SDL (VoxCPM2)
- `docs/` — architecture, devnet pins, voice lock, built-vs-borrowed
- `tickets/` — thinker-written task specs · `audit/` — per-task evidence (spec, muse-session.log, review.md, verify.txt)
- `site/` — the public battle-plan dashboard
