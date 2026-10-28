# Ticket 015: life-page

**Intent:** The judge's second tab. A single public page that makes the character's aliveness visible at a glance: its current traits (with a visible diff from genesis), a Verify button that proves any shown memory against the on-chain Merkle root, the model identity + per-turn cost of the last turns, and the wallet receipt feed from its self-paying life. Ratified as a judge-critique fix 2026-10-28: this is the "depth" artifact — everything claimed in the pitch is *on* this page, live.

**Implements REQs:** REQ-71 (model identity + turn cost visible), REQ-62 (receipt log renders), REQ-51 (inclusion proof on demand), REQ-30/32 read-only views (life stage), REQ-73 spirit (claim → proof on one page)

**Depends on:** 005 (root history exists), 007 (life stage), 010 (receipts) — ships incrementally; each section renders whatever exists with an honest "not yet" placeholder, never a fake.

**Files in scope:** `app/` (life page route + components), `agent/` (proof + receipts read endpoints only)

**Non-goals:** no editing of traits from the page (read-only), no auth/login, no new on-chain instructions, no memory content rendering (hashes + proofs only, REQ-70).

**Constraints:** Ponytail — one page, server components where possible, no new heavy deps; every number shown must come from a live read (RPC/RPC-equivalent), never hardcoded; "unpaid" receipts render identically to paid ones (honesty rule).

**Acceptance criteria (each observable):**
- [ ] **Traits diff view:** genesis trait vector vs current on-chain Attributes side by side; any change since genesis is highlighted (REQ-30 view; reads live)
- [ ] **Verify button:** click → runs an inclusion proof for a listed memory against the committed root and shows VALID (or FAILS LOUDLY on the tampered demo memory) in <2s (REQ-51)
- [ ] **Model + cost panel:** last N turns show model id + per-turn cost (REQ-71; matches what the latency harness logs)
- [ ] **Receipt feed:** wallet receipts append-only list; killing the facilitator mid-demo yields an `unpaid` receipt that renders exactly like a paid one (REQ-62 + x402 never-gates-speech proof)
- [ ] **Life stage badge:** current stage from on-chain state (REQ-30 view)
- [ ] Page renders with zero JS errors and works on a projector at 1080p (demo-hardware criterion)

**Verification (exact commands AdaL will run):**
```bash
curl -s localhost:3000/life | grep -c "data-req-71"        # model+cost rendered
cd agent && node agent/scripts/latency-harness.ts --turns 3 && diff <(harness log) <(page cost panel)  # numbers match
# Verify button: click in browser; tampered memory → loud FAIL visible
```

**Evidence:** `audit/015-life-page/{muse-session.log, review.md, verify.txt}`
