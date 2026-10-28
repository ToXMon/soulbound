# Ticket 018: livekit-audio-track-discovery

**Intent:** Eliminate the audio-track race that blocked Ticket 001's live path: the worker registered `TrackSubscribed` only after the VT handshake completed, so a mic track published during that window was never fed to VT, and already-subscribed audio was never discovered. Diagnosis credited to desktop-AdaL's live-room investigation (mic frames verified at LiveKit, VT verified via frame replay, Spark verified via harness — race was the only unverified link).

**Implements REQs:** REQ-42 (owner/stranger attribution from real streams), REQ-40 harness integrity

**Files in scope:** `agent/src/index.ts`

**Acceptance criteria — IMPLEMENTED (fix commit fd40dab, verified):**
- [x] TrackSubscribed handler registered before `ctx.connect()`
- [x] Post-connect late-discovery scan feeds already-subscribed audio tracks to VT
- [x] Frame typing loosened then double-cast through unknown (with 017) so tsc passes on VPS and Mac
- [x] VPS: `pnpm build` green; worker `registered`
- [x] Live: owner mic → VT → Spark → reply in UI (Tolu's Mac, Safari — closes parent Ticket 001)

**Verification run:** `cd agent && pnpm build && echo BUILD_OK; timeout 10 node --import ./polyfill-error-event.mjs dist/index.js dev 2>&1 | grep -m1 registered`

**Evidence:** `audit/016-vt-protocol-fix/` (protocol), chat/session logs of 2026-10-28, parent PASS: `audit/001-voice-loop-skeleton/review-final.md`
