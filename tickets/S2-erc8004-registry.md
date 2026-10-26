# Ticket S2: erc8004-registry — STRETCH (gated; only after S1 ships)

**Intent:** The character registers itself in the ERC-8004 trustless-agent identity registry on Base Sepolia — discoverable as an autonomous agent in the open agent economy.

**Implements REQs:** stretch (architecture.md §14)

**Files in scope:** `paywall/registry/` (new), `docs/registry.md` (new)

**Non-goals:** reputation/validation registry depth — identity registration only.

**Constraints:**
- Load `eth-standards` skill (ERC-8004 section) — do NOT guess the registry interface or addresses; the skill has the verified-onchain addresses.
- Registration metadata points at the life page URL.
- Cost: testnet only.

**Acceptance criteria (each observable):**
- [ ] Character registered with agent identity; registry read-back returns our metadata
- [ ] Life page links the registry entry

**Verification:**
```bash
node paywall/registry/verify.ts --character genesis
```

**Evidence:** `audit/S2-erc8004-registry/`

---
*STRETCH — do not start before S1 ships.*
