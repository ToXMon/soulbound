# Ticket NNN: <slug>

**Intent:** <one paragraph — what and why, in product terms>

**Implements REQs:** <ids from docs/architecture.md — human-authored, doer may not edit>

**Files in scope:** <paths the doer may touch>

**Non-goals:** <explicit out-of-scope>

**Constraints:**
- Ponytail ladder: reuse > stdlib > platform feature > dependency > minimal new code
- Never cut validation, error handling, security, accessibility
- Match existing repo style
- Do NOT edit REQs, this ticket, or anything outside "Files in scope"

**Acceptance criteria (each observable):**
- [ ] <criterion, mapped to REQ-xx>
- [ ] <criterion>

**Verification (exact commands AdaL will run):**
```bash
<commands>
```

**Evidence:** `audit/NNN-slug/` → `muse-session.log` (doer export) + `review.md` (AdaL verdict) + `verify.txt` (command output)

---
*Protocol: AdaL (thinker) writes this → Muse Code (doer) executes → AdaL verifies against REQs → Tolu merges. See SOULBOUND.md §2.*
