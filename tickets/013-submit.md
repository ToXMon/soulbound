# Ticket 013: submit

**Intent:** Ship it. Public repo, working video link, every collaborator listed, submitted via the CV platform by NOON ET Nov 4 (deadline 9PM — we submit with margin).

**Implements REQs:** submission-completeness (rules compliance)

**Files in scope:** repo settings, submission form data

**Non-goals:** any code.

**Constraints:**
- Repo PUBLIC, default branch green, README renders.
- Video link accessible without login (test in incognito).
- Double-check: demo highlights ONLY what was built during the window (rules: disqualification risk otherwise).
- Everyone who worked on it listed (Tolu; tools noted honestly).

**Acceptance criteria (each observable):**
- [ ] Repo public + fresh-clone setup tested (`git clone` → README steps work on a clean machine)
- [ ] Video link loads in incognito
- [ ] Submission form saved with screenshot evidence
- [ ] Submission confirmed received (email/dashboard)

**Verification:**
```bash
git clone <repo> /tmp/soulbound-fresh && cd /tmp/soulbound-fresh && <README setup steps>
```

**Evidence:** `audit/013-submit/` (screenshots)

---
*Refresh before execution.*
