# Ticket 010: x402-economics

**Intent:** The character pays for its own thoughts. Its own spending-capped Base Sepolia wallet; our thin x402 paywall in front of OUR Meta backend; every inference call settles USDC via EIP-3009 with a facilitator; receipts logged and shown on the life page. Payment NEVER gates speech.

**Implements REQs:** REQ-60, REQ-61, REQ-62

**Files in scope:** `paywall/` (new — x402 gateway), `agent/economics/` (new — character wallet client), `app/` (life page wallet section)

**Non-goals:** Chainlink-for-Agents purchases (stretch S3), mainnet, real USDC value beyond faucet dust.

**Constraints:**
- Load `eth-standards` (x402/EIP-3009), `eth-wallets`, `eth-gas`, `eth-security` skills. Reference impl: github.com/ivcained/surp-router (MIT) — pattern source, not a dependency.
- Base Sepolia + faucet USDC only. Character key: daily cap enforced in BOTH the wallet client and the paywall (defense in depth, REQ-61); kill switch file the owner can touch.
- Failure at any payment step → speech continues, receipt `unpaid` (REQ-60 — the test kills the facilitator mid-run).
- Receipts append to a public log the life page renders (REQ-62); per-turn cost visible (REQ-71).

**Acceptance criteria (each observable):**
- [ ] Full loop: 402 → EIP-3009 sign → facilitator settle → inference streams → receipt on life page (Base Sepolia tx link)
- [ ] Facilitator killed mid-conversation → speech continues, `unpaid` receipt logged (REQ-60)
- [ ] Cap+1 request refused by BOTH client and paywall (REQ-61)
- [ ] Kill switch engaged → payments stop, conversation continues

**Verification:**
```bash
node paywall/test/e2e.ts --scenario happy --out audit/010-x402-economics/verify.txt
node paywall/test/e2e.ts --scenario facilitator-down
node paywall/test/e2e.ts --scenario over-cap
```

**Evidence:** `audit/010-x402-economics/`

---
*Refresh before execution.*
