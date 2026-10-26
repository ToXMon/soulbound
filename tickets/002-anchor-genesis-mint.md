# Ticket 002: anchor-genesis-mint

**Intent:** The character's on-chain birth. An Anchor program on Solana devnet with `initialize_character`, which mints the Metaplex Core asset (the canonical character, with the genesis Attributes trait vector) and the Token-2022 non-transferable ownership receipt to the owner. Deployed to devnet with the program ID pinned in the README — same evidence discipline as bounded-payments.

**Implements REQs:** REQ-01, REQ-02, REQ-03, REQ-05, REQ-06, REQ-07 (REQ-04 oracle plugin is Ticket 005)

**Files in scope:**
- `programs/soulbound/` (new — Anchor workspace, program + tests)
- `docs/devnet.md` (new — pinned program ID, mint addresses, verification commands)

**Non-goals:** `commit_memory_root`, `evolve_traits`, `crank_heartbeat` (later tickets), client SDK, any frontend. No mainnet anything.

**Constraints:**
- Anchor 0.31.x; LiteSVM for the local test suite (per Turbin3 stack).
- Token-2022 receipt uses the **non-transferable extension** — verify a transfer attempt fails.
- Metaplex Core via its official SDK/CPI; genesis Attributes = `{ life_stage: "born", mood: "curious", memory_epoch: 0, trait_vector: <genesis> }`.
- Checked math everywhere; failed instruction changes no state.
- Program ID pinned in `docs/devnet.md` only AFTER a real deploy; never fabricate an address (bounded-payments evidence rule).

**Acceptance criteria (each observable):**
- [ ] `anchor build` clean; `target/idl/soulbound.json` exists
- [ ] LiteSVM suite green: PDA seeds `["character", owner, character_id]` derive canonically (REQ-01); Core asset minted to owner (REQ-02); Attributes readable (REQ-03); receipt transfer attempt FAILS (REQ-05); duplicate `character_id` rejected (REQ-06); config reads `life_stage=born, memory_epoch=0` (REQ-07)
- [ ] Program deployed to devnet; `solana program show <ID> --url devnet` reports it executable; ID pinned in `docs/devnet.md`
- [ ] A real genesis character minted on devnet; explorer link in `docs/devnet.md`

**Verification (exact commands AdaL will run):**
```bash
cd programs/soulbound && anchor build && anchor test --skip-local-validator  # LiteSVM suite
solana program show $(grep PROGRAM_ID docs/devnet.md | cut -d= -f2) --url devnet
```

**Evidence:** `audit/002-anchor-genesis-mint/` → `muse-session.log` + `review.md` + `verify.txt` (incl. deploy tx signature)

---
*Protocol: AdaL (thinker) writes this → Muse Code (doer) executes → AdaL verifies against REQs → Tolu merges. See SOULBOUND.md §2.*
