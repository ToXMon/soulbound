# Ticket S3: chainlink-data-purchase — STRETCH (gated; x402 core must be stable)

**Intent:** The character spends its own allowance on external knowledge: a real x402-paid call to Chainlink for Agents (verified Data Streams pricing) — "it buys knowledge with its own money." Pure composability flex, zero model-purity risk (it's a tool call, not inference).

**Implements REQs:** stretch (architecture.md §14); extends REQ-60..62 receipts to external purchases

**Files in scope:** `agent/economics/purchases.ts` (new), `app/` (life page purchase log)

**Non-goals:** trading, DeFi actions, anything financial beyond a read-only data purchase.

**Constraints:**
- Chainlink for Agents is Beta, real USDC on Base (not Sepolia) per LinkLab notes — SPEND CAP $1 hard-coded for this ticket; the purchase must be a cheap read-only data call.
- Receipt logs into the same life-page ledger as inference receipts.
- Guide: https://docs.chain.link/resources/chainlink-for-agents — read before coding.

**Acceptance criteria (each observable):**
- [ ] One real x402-paid data call completes; receipt + response on life page
- [ ] Spend cap enforced (second call beyond cap refused)

**Verification:**
```bash
node agent/economics/purchases.ts --demo --out audit/S3-chainlink-data-purchase/verify.txt
```

**Evidence:** `audit/S3-chainlink-data-purchase/`

---
*STRETCH — do not start before Ticket 010 is green and stable.*
