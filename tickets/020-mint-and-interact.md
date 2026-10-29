# Ticket 020: mint-and-interact

**Intent:** Judges don't watch a character — they *adopt* one. Connect a Solana wallet in the app, click mint, and `initialize_character` gives them their own personal character (their own Core asset + non-transferable receipt, seeded `["character", ownerWallet, characterId]`). Their character answers in the same voice but keeps ITS OWN memory space, keyed by their wallet. Ratified MUST by Tolu 2026-10-28 ("full functionality in the product UI so judges can mint and interact").

**Implements REQs:** REQ-01..07 (executed on behalf of arbitrary judge wallets), REQ-71 (their character's model+cost visible), REQ-42 unchanged; privacy: each character's memories isolated by owner key (REQ-70 spirit).

**Depends on:** 004/005 (memory+roots — per-character keying), program from 002. Blocked by 004.

**Files in scope:** `app/` (wallet connect via Solana wallet-adapter, mint flow, character page), `agent/` (session binds to owner wallet from the join token's identity metadata; memory store keyed `character/<owner>/<cid>/`), `docs/` (judge runbook)

**Non-goals:** no new on-chain instructions (002's program already supports arbitrary owners); no character *transfer*; no multi-character per wallet in UI (one per judge); no avatar customization at mint.

**Constraints:** Ponytail — wallet-adapter React package, devnet only, judge pays nothing (our faucet-funded tx or we airdrop instructions); the demo character (`8ra3ck…`) remains Tolu's and stays the "elder" character judges can visit; if per-character memory isolation risks the timeline, the documented cut-line is: mint works on-chain + shared-memory demo character, with isolation landing post-submission — Tolu decides at Day 8 review, never silently.

**Acceptance criteria (each observable):**
- [ ] Judge connects wallet (Phantom/Solflare devnet) in the app UI
- [ ] One click → `initialize_character` executes → explorer link shows THEIR Core asset with genesis traits + non-transferable receipt in THEIR wallet (REQ-01..05,07 live)
- [ ] Second mint attempt with same character_id rejected (REQ-06 surfaced gracefully in UI)
- [ ] Judge talks: transcript + reply render; memory writes land under THEIR character's key, not the demo character's
- [ ] Their character page shows their traits + their memory-root history (life page, per-character)
- [ ] Judge runbook in `docs/` — 5 steps, screenshots, <2 min from scan-to-speaking

**Verification (exact commands AdaL will run):**
```bash
# with a second devnet wallet: mint via UI, then
curl getAccountInfo <judge-character-asset>       # exists, owned by judge
grep "<judge-wallet>" agent/memory index          # memory keyed to judge, not Tolu
cd agent && pnpm build && pnpm test 2>/dev/null || echo n/a
```

**Evidence:** `audit/020-mint-and-interact/{muse-session.log, review.md, verify.txt}`
