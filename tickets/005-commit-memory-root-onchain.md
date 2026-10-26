# Ticket 005: commit-memory-root-onchain

**Intent:** "A childhood you can audit" goes live. Add `commit_memory_root` to the Anchor program (append-only root history PDA, runtime-signer gated, event emitted), deploy to devnet, and wire the Ticket-004 batcher to commit per session/epoch. The life page (even as a bare endpoint) can show the root history.

**Implements REQs:** REQ-10, REQ-11, REQ-12, REQ-13

**Files in scope:** `programs/soulbound/` (extend), `agent/memory/committer.ts` (new), `docs/devnet.md` (update pins)

**Non-goals:** evolve_traits, crank_heartbeat, indexer/UI polish.

**Constraints:**
- Load `solana-doer` + Turbin3 `solana-build`/`solana-test` skills. Capstone patterns: guards first, checked math, typed errors, REQ-named tests.
- Root history account: append-only, sized for the demo horizon (e.g., 128 epochs); document the sizing choice.
- Committer: async, retries with backoff, never in the voice-turn path (D3).
- gill/Solana Kit client; pin new program version in `docs/devnet.md` after real redeploy.

**Acceptance criteria (each observable):**
- [ ] LiteSVM: valid commit appends (REQ-10); wrong signer fails (REQ-11); duplicate/regressed epoch fails (REQ-12); event parseable (REQ-13)
- [ ] Redeployed on devnet; `solana program show` executable; a REAL root from a real Ticket-004 session committed; explorer link in verify.txt
- [ ] A committed root recomputes from off-chain leaves — deterministic match (bridges 004↔005)

**Verification:**
```bash
cd programs/soulbound && anchor build && anchor test --skip-local-validator
node agent/memory/committer.ts --epoch 1 --dry-run && node agent/memory/committer.ts --epoch 1
```

**Evidence:** `audit/005-commit-memory-root-onchain/` (incl. commit tx signature)

---
*Refresh before execution.*
