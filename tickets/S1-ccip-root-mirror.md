# Ticket S1: ccip-root-mirror — STRETCH (gated by Ticket 011 go decision)

**Intent:** The character's memory lineage becomes chain-agnostic. Each committed Solana root is mirrored to Base Sepolia via a real CCIP v2.0 data message — the same root, provable on two chains.

**Implements REQs:** stretch (architecture.md §14)

**Files in scope:** `paywall/ccip/` (new), `docs/ccip.md` (new)

**Non-goals:** Solana↔EVM CCIP lanes (out of window), custom Solidity receivers beyond the starter kit's BasicMessageReceiver, FTF tuning (full finality is fine for roots).

**Constraints:**
- Load `docs/ccip-linklab-notes.md` FIRST (mined LinkLab): Example 02 pattern, Chainlink Local for tests (no RPC), `evm_version='cancun'`, throwaway keystore, fund both sides day-before, CLI pre-flight (`get fee`, lane latency).
- Chainlink agent skill available: `npx skills add smartcontractkit/chainlink-agent-skills --skill chainlink-ccip-skill -g`.
- Message = `(characterId, epoch, merkleRoot)`. v1 sender = backend (two plain txs is the fallback if CCIP fights us — that's still a shipped mirror).

**Acceptance criteria (each observable):**
- [ ] Chainlink Local test passes: message sent + received with matching root (fork sim)
- [ ] One REAL CCIP message lands on Base Sepolia; CCIP Explorer link + Solana commit link side by side
- [ ] Life page shows both proofs for one epoch

**Verification:**
```bash
cd paywall/ccip && forge test
npx @chainlink/ccip-cli message status <messageId>
```

**Evidence:** `audit/S1-ccip-root-mirror/`

---
*STRETCH — do not start before Ticket 011 go decision.*
