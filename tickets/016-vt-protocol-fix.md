# Ticket 016: vt-protocol-fix

**Intent:** Repair Ticket 001's blocking failure (audit/001-voice-loop-skeleton/review.md F1): the Muse Voice Transcribe client speaks an invented protocol the live endpoint rejects. Rewrite `agent/src/observe.ts` to the published cookbook protocol, verified live by the thinker 2026-10-28: endpoint `wss://api.meta.ai/v1/asr/realtime`; auth rides inside the handshake JSON as `authorization:{accessToken}` (header ignored); handshake `{mode:"DIARIZATION", audioEncoding:"PCM_16KHZ"|"PCM_24KHZ", model:"muse-voice-transcribe-1.0", partialMode:"CUMULATIVE"}`; audio as binary PCM frames ended by `{"type":"endStream"}`; events `speechStart → partials → speaker → speechEnd → speechComplete` correlated by `turnId`; speaker labels are bare letters ("A","B").

**Implements REQs:** REQ-42 (owner vs stranger attribution from real VT stream), REQ-40 harness integrity (STT leg exercised)

**Files in scope:** `agent/src/observe.ts`, `agent/scripts/latency-harness.ts`, `agent/.env.example`, `docs/built-vs-borrowed.md` (add cookbook VT reference). `.gitignore` exception handled by thinker separately — do NOT touch it.

**Non-goals:** no TTS, no on-chain, no new deps beyond existing; do not alter `decide.ts`/Spark leg (passed).

**Constraints:**
- Owner = first diarized speaker letter observed in a session (configurable via env); every other letter or absence = stranger → stranger greeting, loop continues (REQ-42 spirit unchanged).
- Harness must drive a real WAV replay through the VT websocket so "diarized" lines are VT output, not script labels. Decide-only runs must be labeled `decide-only` in output.
- Do NOT write any file under `audit/` — that is thinker-only territory (review protocol P1). Self-observations go in your printed output.

**Acceptance criteria (each observable):**
- [ ] Live probe: handshake with the new code returns `sessionId` (no `invalid_request` error)
- [ ] WAV replay through VT yields ≥2 distinct speaker labels for a 2-speaker sample; harness prints per-turn `sttMs` > 0 (REQ-40 integrity)
- [ ] Ambiguity (single/unknown speaker) → stranger greeting path, no error (REQ-42)
- [ ] `agent/.env.example` documents every var; `git status` shows it tracked (thinker's gitignore exception lands first)
- [ ] `pnpm build` green; `pnpm dev` joins a room (Tolu Mac run for the audible criterion — still owned by the original ticket)

**Verification (exact commands AdaL will run):**
```bash
cd agent && node scripts/vt-probe.mjs                    # sessionId accepted
node scripts/latency-harness.ts --turns 5 --wav fixtures/hello-two-speaker.wav  # sttMs>0, labels A/B
git check-ignore agent/.env.example || echo TRACKED
pnpm build
```

**Evidence:** `audit/016-vt-protocol-fix/{muse-session.log, review.md, verify.txt}`
