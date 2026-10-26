# Ticket 009: face-muse-image

**Intent:** The character gets a face that stays itself. Muse Image anchored generation: build the small reference set, generate the genesis portrait, wire portrait evolution renders (life stages) and "memory snapshot" paintings of shared moments. The portrait URI is referenced from the Core asset; the UI shows it.

**Implements REQs:** (D13) + supports REQ-22 provenance story

**Files in scope:** `agent/portrait/` (new), `app/` (portrait display), `docs/character-design.md` (new — reference set + prompt history)

**Non-goals:** animation/lip-sync, video generation, style transfer on user photos.

**Constraints:**
- Load `meta-model-api` (anchored generation recipe: `05_muse_image/03_anchored_generation`).
- The reference set is FIXED after genesis — every later render anchors to it (consistency is the product).
- Portrait evolution ties to life_stage (on-chain) — the render is derived FROM chain state, not free-running.
- Memory snapshot = async post-session render (D3), labeled "memory snapshot" in UI.

**Acceptance criteria (each observable):**
- [ ] Genesis portrait + 3 anchored variants are recognizably the same character (attach to evidence)
- [ ] Life-stage change (from 006/007) triggers a new anchored render, linked from the life page
- [ ] One memory snapshot produced from a real session summary
- [ ] `docs/character-design.md` contains the reference set + prompts used

**Verification:**
```bash
node agent/portrait/generate.ts --genesis --out audit/009-face-muse-image/verify.txt
```

**Evidence:** `audit/009-face-muse-image/` (incl. images)

---
*Refresh before execution.*
