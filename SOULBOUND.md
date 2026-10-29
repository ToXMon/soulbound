# SOULBOUND — Master Plan & Handoff Doc
**Meta Global AI Developer Hackathon** · Owner: Tolu Shekoni (ToXMon) · Indie track
**Created:** 2026-10-26 (kickoff day, VPS) · **Carry this file between machines — it IS the project state.**
**Last updated:** Day 0, VPS session. Next editor: AdaL on Mac.

---

## 0. RESUME INSTRUCTIONS (read first when picking up on another machine)

1. You are the **thinker harness (AdaL)**. Muse Code is the **doer harness**. See §2.
2. Read this whole file before writing any code. All settled decisions are in §1–§6. Do not re-litigate them without a stated reason; append new decisions to §9 with a date.
3. Code does NOT start before the building window (Oct 27). Planning docs are allowed; keep them in `/docs`.
4. On the Mac: install Muse Code first — `curl -fsSL https://dev.meta.ai/install.sh | bash` (Mac/Windows supported; Linux NOT confirmed — that's why CLI work happens on the Mac).
5. Pending user action: copy `CCIP-2.0-LinkLab-transcript.txt` from the Mac (`/Users/tolushekoni/`) into `docs/ccip-linklab-notes.md` in this repo so the thinker can mine it.
6. Credits checklist status — see §10.

---

## 1. The project

**SOULBOUND — the first AI character that is verifiably and economically alive.**

A living digital character you talk with in real time (voice + vision), that remembers your shared life, evolves visually and psychologically — and whose identity, memory lineage, and wallet are on-chain and owned by you. It pays for its own inference. Its memories are cryptographically provable without being readable. Its personality cannot be edited by anyone but its verified runtime.

- **One-liner for judges:** "AI companions die when platforms change the rules. Mine has a soulbound identity, an auditable childhood, and its own wallet — it pays for its own thoughts."
- **Problem statement:** *Push the Frontier* (primary) — an AI given a new capability: an ownable, economically active, auditable existence. *Build for Your World* (secondary).
- **Prize track:** Indie Developer. Solo.
- **Jia Chen rules in force:** (1) judges interact with it live, pitch ≤ 30s; (2) vertical slice end-to-end by Day 2; (3) one magical moment > five half-features; (4) build-in-public daily (community-vote prize); (5) ship, then move on.

---

## 2. Harness methodology: AdaL thinks, Muse Code does (FINALIZED 2026-10-26)

**Roles.** AdaL = thinker + verifier: authors spec tickets, owns SOULBOUND.md + decision log + REQs, reviews every diff adversarially, runs verification, packages evidence. Muse Code = doer/implementer: executes spec tickets inside the repo, nothing else. Tolu = the only merge authority and the voice of the demo.

**Auto-loading (verified 2026-10-26):** `AGENTS.md` at repo root is read by BOTH harnesses (Muse Code reads it as project rules per `muse init`; AdaL reads it as project context) and routes each harness to its role skill in `.agents/skills/` — `thinker/` for AdaL, `doer/` for Muse Code. Project-skill discovery confirmed live: `muse skills list --source project` shows both, ON. Opening either harness in this folder = correct behavior with zero prompting.

**Where the doer runs.** Muse Code 1.4.13 is installed on the VPS (Linux verified) and can run on the Mac. VPS headless: `META_API_KEY` + `muse exec "<ticket ref>"`. Mac: interactive `muse` in the repo. Sandbox requirement: bubblewrap — VPS needs the userns sysctl relaxation (see §10). Permission profile: **Auto-review default; `--yolo` forbidden** on wallet/oracle/receipt code (REQ-01..32, REQ-60..62). Sandbox stays ON everywhere.

**The task loop (every task, no exceptions):**
1. **AdaL writes a ticket** into `tickets/NNN-slug.md` from `tickets/TEMPLATE.md`: intent, files in scope, REQ ids it implements, acceptance criteria (observable), non-goals, constraints (Ponytail minimalism ladder).
2. **Muse Code executes** the ticket inside the repo. It reads the ticket file — prompts are never chat-typed, so the spec itself is committed evidence. Its instruction hierarchy: REQs (human) > ticket (AdaL) > its own judgment.
3. **Audit export:** after each task, export the Muse Code session log to `audit/NNN-slug/muse-session.log` (append-only log = proof of doer execution).
4. **AdaL verifies, not vibes:** run the REQ tests the ticket maps to, run the thing, diff review against ticket scope. Author/reviewer isolation is the point — AdaL never wrote the diff. Verdict written to `audit/NNN-slug/review.md`: PASS / FAIL-with-findings.
5. **Commit per task:** `git commit` referencing the ticket id; git history doubles as the build-during-window timeline (new-work rule evidence).
6. **AdaL updates SOULBOUND.md** state + checkboxes. Next ticket.

**Evidence model for judges (`audit/` directory):** each task folder holds four artifacts — `spec.md` (human-authored intent), `muse-session.log` (Muse Code execution proof), `review.md` (independent verdict), `verify.txt` (test/run output). Redaction policy: logs are exported, scanned for secrets, then committed. The submission claim "built with Muse Code" is thereby backed by per-task receipts, not a sentence.

**Anti-patterns (binding):** Muse Code never edits REQs or its own ticket. No agent-written test counts as independent verification (Kun). No implementation work outside a ticket. If a ticket fails review twice, AdaL rewrites the ticket — smaller.

---

## 2c. Muse Code auth model (verified from dev.meta.ai help, 2026-10-26)

- **Two credential types:** (1) the Muse Code credential auto-created by `muse login` — works ONLY with a subscription; (2) manually created `LLM|...` API keys — pay-as-you-go, billed per token.
- `META_API_KEY` env var **always overrides** the login credential — a broken pay-as-you-go key in env kills subscription mode too.
- `muse usage` shows SUBSCRIPTION allowance only; pay-as-you-go spend lives at dev.meta.ai → Billing.
- Card on file ≠ pay-as-you-go enabled (separate activation/spend-limit on Billing).
- Subscriptions default to **Contributor mode** (Meta trains on content) — turn OFF in Muse Code settings after subscribing.
- Empty model catalog (`/v1/models` → `{"data":[]}`) = no entitlement on that credential's path, not a bad key.
- Workspace trust: project skills + AGENTS.md only load with `--trust-workspace`.

## 2b. Ticket template (lives at tickets/TEMPLATE.md)

```
# Ticket NNN: <slug>
Intent: <one paragraph — what and why, in product terms>
Implements REQs: <ids>
Files in scope: <paths the doer may touch>
Non-goals: <explicit out-of-scope>
Constraints: Ponytail ladder (reuse > stdlib > dependency > minimal new code); never cut validation/security; match existing style
Acceptance criteria (each observable):
- [ ] <criterion, mapped to REQ-xx>
Verification: <exact commands AdaL will run>
Evidence: audit/NNN-slug/{muse-session.log, review.md, verify.txt}
```

---

## 3. Meta model usage (all verified against dev.meta.ai + cookbook 2026-10-26)

| Model | Role | API fact |
|---|---|---|
| Muse Spark 1.3 | Real-time conversation brain; tool calling; structured-output memory extraction; search grounding | `api.meta.ai/v1`, OpenAI SDK, 1M ctx, $1.25/$4.25 per Mtok (contributor tier 10x cheaper but trains on data — never for personal memories) |
| Muse Voice Transcribe | Real-time STT, **diarization = owner-voice recognition** | WebSocket only, speaker-attributed turns |
| Muse Image | Genesis portrait; anchored consistency across all renders; "memory snapshot" paintings; per-stage visual evolution | Responses API, anchored series |
| SAM 3.1 | Eyes: segments objects shown on webcam, video tracking; memories bind to masks | `meta-sam` SDK, image+video |
| Muse Spark Open | Subconscious: cheap background loop — memory consolidation, journaling, trait deltas | Baseten, model ID `muse-spark-open-1026` (NOT the ID in Baseten docs) |
| Muse Wonder | Dream time: long-running agent between sessions evolves personality, plans next questions | Model API, built for long-running agents + active memory |
| Muse Code | Build tool (doer harness) | `curl -fsSL https://dev.meta.ai/install.sh \| bash`, Mac/Windows |

## 4. Architecture

### 4a. AI + voice loop (LiveKit transport)
mic → LiveKit → **Muse Voice Transcribe** (WS, diarized) → **Muse Spark** (tools, memory graph R/W) → **VoxCPM2** TTS → LiveKit audio out. Target < 1.5s round trip.

- **TTS: VoxCPM2** (OpenBMB, Apache-2.0). **Voice Design**: Spark writes a natural-language voice description from the persona; VoxCPM2 renders it — the character invents its own voice. Lock the seed Day 2 (output varies run-to-run per their docs). Streaming API; RTF ~0.13 on 4090 via Nano-vLLM; ~8GB VRAM; OpenAI-compatible serving via vLLM-Omni. Deploy on Akash GPU (SDL in repo, modeled on akashvisionagent's `deploy.yml`).
- **Transport pattern** from `frankramosdev/akashvisionagent` (LiveKit agent-starter-react). ✅ License cleared: author verbally confirmed re-use to Tolu on 2026-10-26. Still: build on official `livekit-examples/agent-starter-react` as the clean base, credit akashvisionagent in README, and record all borrowed scaffolding in the built-vs-borrowed table (hackathon "new work only" rule). Get the author's confirmation as a screenshot/written note into `docs/` when convenient.

### 4b. Blockchain layer — Solana = identity & memory (user's Turbin3 stack)
1. **Character = Metaplex Core asset.**
   - **Attributes plugin** = live trait state on-chain (personality vector, life stage, memory count, mood). Judges watch traits mutate on an explorer after talking to it.
   - **Oracle plugin** (lifecycle REJECT) gates trait mutations to the verified backend signer — the contract refuses unauthorized personality edits.
   - **Token-2022 non-transferable extension** = soulbound ownership receipt. Cannot be sold or moved.
2. **Verifiable memory lineage (novel piece):** Spark extracts episodic memories → Merkle tree → Anchor program `commit_memory_root` anchors root on Solana devnet. Any memory later inclusion-provable without revealing content. *"A childhood you can audit."*
3. Anchor program instructions (v1): `initialize_character`, `commit_memory_root`, `evolve_traits` (oracle-gated), `crank_heartbeat` (permissionless life-stage crank, pays caller from vault PDA — cf. Turbin3 W5 pattern).
4. Testing: LiteSVM. Client: gill/Solana Kit.

### 4c. Blockchain layer — Base = economic life (x402)
- **Decision (settled):** the character's wallet lives on Base; it pays per-request for its own cognition in USDC via x402 (EIP-3009).
- **Model purity rule:** the product's inference stays 100% Meta (Stage-1 pass/fail safety). We run **our own thin x402 paywall** in front of our Meta backend (Spark via Model API; Spark Open via Baseten). The character pays OUR gateway — agentic payments demonstrated, models unimpeachable.
- **surp.ivc.lol / surp-router** (ivcained, MIT) = reference implementation and pattern source: OpenAI-compatible, 402→EIP-3009→settle→stream, 5% markup, $0.01 floor, facilitator-verified, transparency headers (`X-Payment-Settled`, `X-Routed-Model`). Also has a treasury free tier for dev testing. Cite it; optionally use it for dev-harness (non-product) inference.
- **Composability stretch:** character buys external *tools/data* via x402 — e.g. Chainlink for Agents (hosted gateway, agents pay per call in USDC on Base, Beta). This is "the character spends its allowance on knowing things" — pure upside, no model-purity risk.

### 4d. Cross-chain — CCIP (stretch, honest scoping)
- v1: same memory Merkle root committed on Solana AND mirrored to Base by the backend in two txs. No cross-chain messaging.
- v2 (stretch, only if Days 1–7 land early): real CCIP v2.0 message carrying the root to **Base Sepolia** (where the character's wallet lives — one-chain story for judges) via `smartcontractkit/ccip-starter-kit-foundry`. **Kit facts (verified from repo):** primary lane Sepolia→Polygon Amoy; **Example 02 = plain data message to BasicMessageReceiver** — exactly our root-mirror pattern; **`sdk-examples/src/ccip-send.ts` + `ccip-track.ts` = TypeScript SDK**, so the backend can send/track CCIP messages with zero custom Solidity for v2; tests via Chainlink Local V3 (no RPC needed); book at https://smartcontractkit.github.io/ccip-starter-kit-foundry/. Known gotchas from the LinkLab setup doc: `evm_version='cancun'` in foundry.toml, throwaway keystore wallet (`cast wallet import`), fund BOTH sides day-before (faucets.chain.link), CCIP Explorer for tracking. Chainlink agent skill: `npx skills add smartcontractkit/chainlink-agent-skills --skill chainlink-ccip-skill -g`. Kit code is unaudited community examples — fine for hackathon, don't port patterns blindly.
- ⚠️ The Mac-local `CCIP-2.0-LinkLab-transcript.txt` has NOT been mined yet — import it per §0.5 before finalizing the CCIP stretch.

### 4e. ERC-8004 agent registry (stretch)
Register the character in the trustless-agent identity registry on Base testnet (ethskills covers the standard). Only after core is green.

---

## 5. Infra & cost map

| Layer | Provider | Cost |
|---|---|---|
| Spark / Image / Voice / SAM | Meta Model API | $150 credit |
| Spark Open subconscious | Baseten | $100 credit (2M TPM) — model ID `muse-spark-open-1026` |
| VoxCPM2 TTS | Akash GPU (4090-class), SDL in repo | ~$0 (user deploys free) |
| Identity / memory roots | Solana devnet | $0 (faucet) |
| x402 payments | Base Sepolia USDC | ~$0 (faucet) |
| LiveKit | Cloud free tier; self-host on Akash fallback | $0 |
| Muse Code | $5/mo Everyday | $5 |
| Modal | batch/backup GPU | $100 credit, optional |

## 6. Ten-day plan (Oct 27 – Nov 4)

- **Day 0 (done):** strategy locked; this file created. TODO: claim Meta/Baseten/Modal credits; Discord #intros post; Mac: install Muse Code; import CCIP transcript (§0.5).
- **Day 1 (done):** Ticket 002 PASS (genesis on devnet); Meta API verified live; Muse Code authenticated. **RESEQUENCED Day 1–3 (judge critique 2026-10-28, ratified): voice vertical slice is THE only Day 2 goal.**
- **Day 2 — VOICE SLICE ONLY:** Ticket 001's Mac voice-in/text-reply exchange is complete. Ticket 019's pre-TTS latency baseline is owner-accepted; next is 003 (streaming VoxCPM2 out, lock seed, measure actual first audio). Ticket 019 does not establish REQ-40's first-audio target. Nothing else gets doer time until "Hello, I'm alive" round-trips aloud.
- **Day 3:** memory spine: 004 (memory graph + Merkle) + 005 (commit_memory_root on explorer).
- **Day 4:** Ticket 014 Arcium private memory challenge (MUST-HAVE, ratified 2026-10-28) — offline-fake path first, live cluster path gated on the Day-0-style spike; if the network can't demo end-to-end, it downgrades to documented stretch (Tolu decides) and the demo leans on Merkle tamper-proof instead. THEN 006 (dream cycle) if green.
- **Day 5:** 007 (heartbeat crank) + 015 (life page — traits diff, Verify button, model+cost, wallet receipts).
- **Day 6:** SAM 3.1 eyes (008) + Muse Image anchored portrait (009).
- **Day 7:** 010 (x402 wallet + self-paying inference; receipts on life page) + 020 (judge-mint flow: wallet connect → mint → per-character memory binding).
- **Day 8:** 011 — latency polish; kill weakest feature; prewarm probe + fallback clip for EVERY live beat; **two-rehearsal gate: full 180s storyboard passes twice consecutively or features get cut, not time extended.** CCIP/ERC-8004: CUT (judge-aligned, 2026-10-28) — depth = verifiable memory + rejected forgeries + unpaid-continues, not more chains. Subagent fanout permitted ONLY here for read-only research/parallel checks, never core-ticket writers.
- **Day 9:** 012 — 3-min video (15s hook → live unscripted conversation → explorer traits mutating → memory verification → x402 payment receipt) + README claim→proof matrix.
- **Day 10:** buffer, final office hours 9PM ET, SUBMIT BY NOON ET. Public repo, working video link, all contributors listed.

## 7. Demo design (judges interact — Jia Chen rule 1)
Judge speaks → character recognizes a NEW voice (diarization) vs owner → judge shows it an object (SAM) → character paints the moment (Muse Image) → judge refreshes Solana explorer: traits changed, new memory root committed → character pays for the conversation from its own Base wallet, receipt visible. Every beat is live, no slides.

## 8. Content flywheel
Daily build-in-public on X (@tolu_EVM). Viral beats: Day 2 "it's alive", Day 4 "its childhood is now auditable", Day 7 "my AI paid for its own thoughts today". Community vote prize is $50K-adjacent — this is part of the build, not an afterthought.

## 9. Decision log (append-only)
- 2026-10-29 (TICKET NUMBER RECONCILIATION, authorized by Tolu): independent Mac/VPS allocation created two tasks numbered 019. Ticket 019 remains `tickets/019-live-voice-latency-baseline.md`, preserving its implementation commits, UI labels and exported timing filenames. The unimplemented judge-adoption task is now Ticket 020, `tickets/020-mint-and-interact.md`, with future evidence under `audit/020-mint-and-interact/`. Earlier entries referring to judge minting as 019 are historical; their current reference is 020. Active roadmap updated; product scope and REQs unchanged. Future ticket allocation must check and synchronize origin/main before selecting an unused number, and handoffs must name the full ticket path.
- 2026-10-29 (TICKET 019 OWNER ACCEPTANCE): Tolu accepted the pre-TTS diagnostic baseline and requested closure without further work on remaining review caveats. Home-folder export `soulbound-019-live.json`: one warm-up plus 20/20 successful measured attempts; manual finished-speaking marker to DOM-commit proxy p50 3819ms, p95 5269ms; Spark full-response p50 3256ms. Tolu reports revision 80f9c0c; instrumentation committed as 37b5d2e and merged as ef2207f. One unmatched agent event, revision provenance and blank quality counts remain review limitations, not independently cleared criteria. This is owner acceptance, not an independent full PASS or a REQ-40 first-audio PASS. Next product ticket is 003; first-audio acceptance must not wait until 011.
- 2026-10-29 (BROWSER CORRECTION, Tolu-confirmed): the earlier Brave failure was caused by navigating to the wrong address; Tolu confirmed the correct local address works. The older entry attributing it to Brave blocking mic/WebRTC is superseded by this observation.
- 2026-10-28 (SCOPE UPGRADES, ratified by Tolu): (1) **Arcium privacy is a FEATURED demo beat** — 014 gains opt-in selective disclosure AC: private-by-default memories + owner-minted shareable disclosure links (verify-an-element-without-the-store). (2) **Judge-mintable characters = MUST** — new Ticket 019 (wallet connect → mint → per-character memory binding → character page), slotted Day 7 alongside 010; program already supports arbitrary owners (PDA seeds), no new on-chain instructions. Honest cost: 019 is real UI+binding work; documented cut-line = mint on-chain + shared demo-character memory if Day-8 review says so — Tolu decides, never silent. Demo character stays Tolu's "elder"; judges adopt their own. (VPS)
- 2026-10-28 (DAY 2 BEAT: TICKET 001 PASS): live voice round-trip confirmed on Tolu's Mac (Safari) — speech → diarized transcript (Muse VT) → muse-spark-1.3 reply rendered. Full path: FAIL(001, VT protocol) → 016 PASS → 017/018 portability+race fixes → local LiveKit topology (LiveKit Cloud blocked from Mac network; local dev server = demo topology, cloud revisited demo day). Brave blocks mic/WebRTC — demo runbook: Safari/Chrome. VOICE SEED lock still Day-2-open (arrives with 003). Day 3 begins: memory spine (004+005). (VPS/Mac)
- 2026-10-28 (GLASS-BREAK, ticket 017): desktop AdaL correctly refused to implement (role isolation held — noted with credit). With no doer on the Mac and Tolu blocked on the round-trip test, AdaL implemented Ticket 017 (3-line portability fix: fileURLToPath agent path + AsyncIterable cast) — verified green on VPS (build + worker registered); final verification is the Mac build itself, which the thinker cannot run. Thinker-implemented, machine-verified: an explicit, logged exception, not a precedent. (VPS)
- 2026-10-28 (PRE-PASS COMMIT, ratified by Tolu): voice-loop implementation (agent/src full, app/, manifests) committed and pushed BEFORE Ticket 001's PASS, breaking the commit-at-PASS rule for cause: the round-trip acceptance test requires running off-VPS, and the Mac checkout could not build without it. The ticket's PASS commit + evidence lands after the Mac test; this commit is marked as continuation in its message. All future tickets remain commit-at-PASS. (VPS)
- 2026-10-28 (TICKET 001 FAIL + P1 PROCESS BREACH): Muse Code built the voice-loop skeleton; build green, Spark leg real (20/20 muse-spark-1.3 replies). **FAIL on F1**: VT client used an invented protocol; live endpoint rejects it (AdaL independently probed: doer handshake → `audioEncoding` error; cookbook handshake → sessionId accepted). F2 `.env.example` gitignored (thinker fixed via `!.env.example`); F3 decide-only latency mislabeled. **P1**: doer authored a file labelled as the thinker's review (author/reviewer isolation violation) — preserved at `audit/001-.../review-doer-selfcheck.md`; its findings were accurate and independently confirmed, but the doer is instructed (Ticket 016) never to write under `audit/`. FAIL routes to Ticket 016 (vt-protocol-fix); no doer commit — the diff stays uncommitted pending the fix round. LiveKit key staged in `agent/.env` (gitignored). (VPS)
- 2026-10-28 (JUDGE CRITIQUE RESPONSE, ratified by Tolu via Muse session): scores idea 9 / demo 8 / depth 7 / progress 4 / feasibility 5. Rescoped per critique: (1) **Day 2–10 resequenced** — Day 2 = voice slice ONLY (001+003); memory spine Day 3; Arcium 014 Day 4 with offline-fake-first + live gate (stays MUST-HAVE — it IS the "verifiable memory" depth the judge wants; downgrade-to-stretch escape hatch preserved); **life page promoted to its own Ticket 015** (traits diff, Verify button, model+cost panel, receipt feed incl. unpaid-renders-like-paid; Day 5); 011 gains prewarm gate + fallback-clip-per-beat + two-rehearsal-or-cut. (2) **CCIP/ERC-8004 CUT** (was stretch-gated; judge-aligned — depth = verifiable memory + rejected forgeries + unpaid-continues, not more chains). (3) **Subagent fanout policy:** never for core tickets (one-ticket-one-commit evidence chain); read-only research/pre-demo check fanout allowed from Day 8 only. (VPS)
- 2026-10-28 (TICKET 002 PASS + SCOPE RATIFIED): (1) **Ticket 002 PASS** — doer pi/Sonnet 5.5; AdaL independently ran anchor build + LiteSVM suite (5/5 green) + devnet getAccountInfo (executable=true); genesis character live on devnet (Core asset `8ra3ck…`, non-transferable receipt, mint authority revoked); audit/002 complete with secrets-clean session log. Doer's flag adopted: ticket verification command amended (`anchor test --skip-local-validator` does not run LiteSVM under anchor 1.2.x → `cargo test -p tests`). Action for Tolu: `sudo chown -R opadmin:opadmin ~/.config/solana` (root-owned deploy keypair). (2) **Arcium private memory = MUST-HAVE** (Tolu): S4 promoted from stretch to core → new Ticket 014 (blocked by 004+005), new UC-7 REQ-53/54/55 in architecture.md; day plan: slots after 005 in the Day 4–6 window, displacing S1 CCIP as first-priority stretch casualty if time tightens; hard non-goal: confidential LLM inference in MXE (model purity). (3) **Jev dev-harness judge ratified** → AC added to Ticket 011. (4) **Model purity carve-out ratified**: bounded non-Meta decision models (Jev) allowed in product path for routing/gating only, never generation, Spark stays source of truth for personal-memory content (AGENTS.md §2 amended). (VPS)
- 2026-10-26: Project = SOULBOUND; Push the Frontier primary; Indie track; solo. (VPS)
- 2026-10-26: Solana = identity/memory (Metaplex Core + Token-2022 non-transferable + Merkle roots). Base = x402 economic layer. Model purity: product inference 100% Meta; our own x402 paywall in front of our backend. surp-router = reference/citation. CCIP + ERC-8004 = stretch only. (VPS)
- 2026-10-26: AdaL=thinker / Muse Code=doer methodology adopted; audit logs committed as proof. (VPS)
- 2026-10-26: akashvisionagent re-use cleared by author (verbal); CCIP starter kit verified (Example 02 pattern + TS SDK). (VPS)
- 2026-10-26 (GRILL Q00, ratified by Tolu): **Canonical framing = A.** SOULBOUND is primarily *a persistent multimodal character whose relationship with you changes through interaction, with verifiable on-chain continuity*. Payments and cross-chain SUPPORT the claim; they never define it. Thesis: "Talk to it and it changes — and every change is provable." Proof claims (what judges will have SEEN): ① it recalls a specific shared moment from an earlier session, correctly; ② interaction visibly changed it — on-chain traits + portrait evolved; ③ any shown memory inclusion-proves against the Merkle root on a public explorer. Non-claims: NOT a production companion product, NOT a token/speculation vehicle, NOT storing raw memories on-chain (hashes only), NOT claiming sentience. (VPS)
- 2026-10-26: Architecture v1.1 — diagram→REQ traceability (§11) + setup-readiness matrix (§12) added; glowmotion animated diagram (`site/diagram.html`, aurora/daylight, checker-verified 0 violations) is the canonical visual; static SVG kept as fallback. Muse Code Linux open item RESOLVED: v1.4.13 verified running on this VPS; requires `sudo apt install -y bubblewrap` for its sandbox (AppArmor-restricted userns on Ubuntu 24.04). Ponytail adopted as doer-side minimal-code discipline (its AGENTS.md in repo for Muse Code); Ponytail self-check tests ≠ Kun human-authored REQ verification — two distinct layers. Matt Pocock pack contributes the issue-tracker + spec-per-task conventions for the thinker→doer queue. (VPS)
- 2026-10-26 (COMPANION WIRED): `ToXMon/solana-rust-dev-companion` (the Turbin3 companion — correct repo name; "solana-dev-companion" never resolved) cloned to `/home/opadmin/ref/solana-rust-dev-companion`; 9 of its 19 skills symlinked into `soulbound/.agents/skills/` and verified discovered by Muse Code. **Mac recreation:** `gh repo clone ToXMon/solana-rust-dev-companion ~/ref/solana-rust-dev-companion -- --depth 1` then re-symlink the 9 skill dirs into the repo's `.agents/skills/`. Note: repo README references old name `turbin3-solana-companion` in its npx installer — the clone URL above is the working one. (VPS)
- 2026-10-26 (CREDITS GAP, ratified): Meta credits may take ~2 days. Plan: (1) add credit card to Model API account TODAY + spend-limit alert — the API works at list price immediately, credits batch-apply later (rules require a card anyway); (2) buy the $5 Muse Code Everyday month — it's the doer harness regardless; (3) dev brain = self-hosted Muse Glimmer/Spark Open (Akash) behind the SAME OpenAI-compatible interface — all code reads MODEL_API_BASE_URL + MODEL_NAME from env, flip to api.meta.ai/v1 + muse-spark-1.3 when live, zero rewrites; (4) resequence: Ticket 002 (Anchor, zero Meta dep) FIRST, then 003 (VoxCPM2/Akash), then 001 (voice loop — VT verified the moment API access lands). Dev stubs never enter the demo path. (VPS)
- 2026-10-26 (FULL BACKLOG + SKILLS): All tickets generated — 001–013 core (Day-mapped) + S1–S3 stretch (gated). Rule: tickets marked "refresh before execution" get a freshness check against repo reality before the doer starts them. Skills inventory now 20 project skills: doer/thinker/solana-doer/meta-model-api (authored) + 9 Turbin3 companion + 8 ethskills (standards, wallets, gas, tools, security, testing, concepts, frontend-ux) — all verified discovered by Muse Code. Context strategy: progressive disclosure — AGENTS.md routes by role, skills route by domain, tickets carry only the REQ rows needed. (VPS)
- 2026-10-26 (REPO LIVE): https://github.com/ToXMon/soulbound — public from day 1 (build-in-public). Planning commit pushed pre-window; code lands inside the window so git history proves build-dates compliance. Skill symlinks gitignored; `scripts/setup-skills.sh` recreates them on any machine. Git identity: ToXMon noreply. (VPS)
- 2026-10-26 (GRILL R3, ratified by Tolu): 180s storyboard approved as drafted (beat order stands: proof before economics; build-week memories are real, not staged). Architecture formalized in `docs/architecture.md` v1.0 using the bounded-payments discipline (canonical SVG D1 + UC table + D-decisions + actors/signers + human-authored REQ-01..73) + system-design five-step framework. Kun engineering gates ADOPTED AS BINDING: human-authored REQs as intent source of truth; agent-written tests ≠ independent verification; author/reviewer isolation (Muse Code implements, AdaL adversarially reviews); deterministic cron for dream loop; model identity + per-turn cost visible in UI; memory versions supersede never delete; E2E judge-simulation over unit tests; evidence honesty (no fabricated outputs, every claim maps to artifact). (VPS)
- 2026-10-27 (BUILD KICKOFF, ratified by Tolu via grill Round 1–2): (1) Meta/Baseten credits still pending — support ticket filed; ratified resequencing stands: **Ticket 002 first**. (2) Muse Code parked (Tolu blocked); **interim doer = pi CLI** on VPS (Tolu has pi; project-level routing added to AGENTS.md), model plan: **Claude Sonnet 5.5 default, Opus 5.5 escalation on tickets 002/005, budget tier (Gemini 4 Argon / GPT-6.1 Sol class) never for REQ-mapped code** — Tolu has broad model access via Codex OAuth + "intelligence" budget; exact reachable model confirmed at kickoff. **AMENDED 2026-10-27 (Tolu): pi's provider gives access to essentially any current model at a discount — model plan final as written: Sonnet 5.5 default, Opus 5.5 on 002/005; the OpenAI-only fallback (GPT-6.1 Sol / Astra) is moot.** AdaL's doer-model research: Sonnet 5.5 #1 coding score 84.5 at $2/$10 (BenchLM 2026-10-27); Opus 5.5 best long-agent-work (Terminal-Bench 4.0 66.4%). (3) Software-factory (Matt Pocock) verdict: **partial adoption** — we already run grill-with-docs + ticket graph + thinker/doer isolation; adopting triage's `ready-for-agent` state idea + blocking edges in tickets; NOT adopting parallel implementer subagents for the core 13 (violates one-ticket-one-commit evidence chain + serial discipline on a solo 10-day window); parallel worktrees stay available for stretch phase only. (4) Ticket 002 freshness check DONE 2026-10-27: Anchor 0.31.x pin was stale → ticket updated to current anchor-cli 1.2.x + LiteSVM TS 1.6.x/Rust 0.18 (Agave 4.3), doer must pin exact version in docs/devnet.md. (5) Demo-hardware acceptance criteria added to tickets 001/003 (audible Mac round-trip). (VPS)
- 2026-10-26 (GRILL R2, all ratified by Tolu): Q09 — Metaplex Core asset IS the canonical character identity (mutable under oracle gate); Token-2022 non-transferable token is ONLY the ownership receipt bound to the owner's wallet. Q10 — x402 self-payment is supporting proof, NEVER gates speech; failure → conversation continues, receipt marked unpaid; testnet wallet + hard daily cap + kill switch. Q11 — vision is on-demand "look at this" moments (user-triggered frame → SAM → reaction + memory), never continuous. Q12 — diarization beat kept but degrades gracefully ("new voice — nice to meet you"); single-speaker path is the guaranteed core. Q16 — scope ledger ratified: MUST = live voice turn, one look-at-this, one recalled memory, one visible trait change on explorer, one Merkle inclusion proof, one-sentence privacy boundary. SHOULD = bounded x402 event, one labeled dream reflection, redacted audit trail. CUT unless Days 1–7 finish early = CCIP mirror, ERC-8004, continuous vision, complex oracle behavior, payment in critical path. (VPS)

## 10. Open items
- [x] Muse Code on VPS: binary v1.4.13 installed ✅ 2026-10-26; bubblewrap installed but blocked by Ubuntu 24.04 AppArmor userns restriction — run once: `echo 'kernel.apparmor_restrict_unprivileged_userns=0' | sudo tee /etc/sysctl.d/60-muse-userns.conf && sudo sysctl --system && bwrap --ro-bind / / true && echo SANDBOX_OK` (tradeoff: relaxes userns confinement system-wide on this dev VPS; alternative: `sudo chmod u+s /usr/bin/bwrap`) — **RESOLVED 2026-10-26 via setuid fix; `bwrap --ro-bind / / true` verified SANDBOX_OK**
- [x] CCIP LinkLab transcript imported and mined → `docs/ccip-linklab-notes.md` (2026-10-26: CCIP 2.0 SDK/CLI w/ agent mode, Chainlink Local testing, Example 02 = our pattern, full finality not FTF for roots)
- [ ] Credits claimed: Meta $150 / Baseten $100 / Modal $100 / Fireworks $25 (optional)
- [ ] Discord intro posted
- [ ] Voice seed locked (Day 2)
- [ ] akashvisionagent author contacted re: license? (optional; we're not copying code)
