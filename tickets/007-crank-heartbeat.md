# Ticket 007: crank-heartbeat

**Intent:** The character has a heartbeat anyone can advance. Permissionless `crank_heartbeat` advances life stage when on-chain preconditions hold (memory epoch threshold + minimum elapsed time) and pays the crank caller a small reward from a vault PDA — the capstone's PDA-signed transfer pattern.

**Implements REQs:** REQ-30, REQ-31, REQ-32

**Files in scope:** `programs/soulbound/` (add crank_heartbeat + vault), `docs/devnet.md` (update)

**Non-goals:** fancy tokenomics; the reward is a fixed devnet-SPL amount, owner-funded.

**Constraints:**
- Load `solana-doer`. Preconditions evaluated on-chain only; early crank changes NO state (REQ-32: empty account diffs).
- Reward via PDA-signed `transfer_checked` (capstone pattern); vault funded by plain SPL transfer granting no authority.
- Keep it small — this is a half-day ticket at most. If it threatens the dream cycle's Day-4 slot, descope reward to zero and note it.

**Acceptance criteria (each observable):**
- [ ] LiteSVM: precondition-met crank advances stage + pays caller (REQ-30/31); early crank fails with zero state change (REQ-32)
- [ ] Live devnet crank by a THIRD-PARTY keypair (not owner, not runtime signer) succeeds; explorer link

**Verification:**
```bash
cd programs/soulbound && anchor test --skip-local-validator
```

**Evidence:** `audit/007-crank-heartbeat/`

---
*Refresh before execution.*
