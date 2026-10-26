# Ticket 012: demo-and-docs

**Intent:** The submission package. The 3-minute demo video (storyboard from SOULBOUND.md), the README with the claim→proof matrix (architecture.md §13) filled with real artifacts, the built-vs-borrowed table, and the sanitized `audit/` trail proving Muse Code built it.

**Implements REQs:** REQ-72, REQ-73

**Files in scope:** `README.md`, `docs/` (claim-proof fill-in), `audit/` (secrets scan + packaging), `site/` (optional final refresh)

**Non-goals:** code changes (docs-only ticket), new video effects work.

**Constraints:**
- Evidence honesty: every claim in README maps to tx link / log / video timestamp. Unverified = labeled unverified or removed.
- Secrets scan over `audit/` before commit (gitleaks or equivalent).
- Video: 15s hook → live unscripted conversation → explorer traits mutating → x402 receipt → non-claims closer. ≤ 3:00 hard.
- README built-vs-borrowed: LiveKit starter, akashvisionagent (author-cleared), VoxCPM2 (Apache-2.0), surp-router (reference), ethskills/Turbin3 packs.

**Acceptance criteria (each observable):**
- [ ] Video ≤ 180s, plays from the submission link, all 5 beats present (fallbacks allowed per beat, labeled)
- [ ] README claim→proof matrix complete; every link resolves
- [ ] `audit/` secrets scan clean; each task folder has spec/log/review/verify
- [ ] Built-vs-borrowed table complete

**Verification:**
```bash
npx gitleaks detect --source audit/ --no-git
```

**Evidence:** `audit/012-demo-and-docs/`

---
*Refresh before execution.*
