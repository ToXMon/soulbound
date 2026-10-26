# Ticket 001: voice-loop-skeleton

**Intent:** Establish the repo skeleton and prove the synchronous half of the live loop: a browser client joins a LiveKit room, speaks, Muse Voice Transcribe streams diarized text, Muse Spark answers, and the text reply renders in the UI. Voice-out is explicitly NOT in this ticket (Ticket 003). A static character placeholder occupies the UI. This is the Day-1 vertical-slice spine — everything later hangs off this loop working.

**Implements REQs:** REQ-40 (latency harness), REQ-42 (diarization graceful degradation)

**Files in scope:**
- `agent/` (new — LiveKit agent worker, TypeScript)
- `app/` (new — Next.js from `livekit-examples/agent-starter-react` pattern)
- `package.json`, `pnpm-workspace.yaml`, `.env.example`, `README.md` (root)
- `docs/built-vs-borrowed.md` (create; record LiveKit starter + akashvisionagent architectural reference w/ author clearance note)

**Non-goals:** TTS/audio-out, memory graph, anything on-chain, Muse Image, deployment. No character personality beyond a one-paragraph system prompt placeholder.

**Constraints:**
- Ponytail ladder: reuse the LiveKit starter pattern > minimal new code; no state management library; no CSS framework beyond what the starter ships.
- Muse Voice Transcribe is WebSocket-only (NOT an HTTP endpoint) — client streams mic audio over WS, receives diarized turns.
- Muse Spark via OpenAI SDK pointed at `https://api.meta.ai/v1` with `MODEL_API_KEY` env var; model id `muse-spark-1.3`. NEVER the contributor tier.
- No secrets in code or committed files; `.env.example` documents every var.
- Match the LiveKit starter's existing style.

**Acceptance criteria (each observable):**
- [ ] `pnpm dev` brings up the app; joining a room shows a connected state (REQ-40 setup)
- [ ] Speaking a sentence produces a diarized transcript line in the UI within the stream (Muse VT, not a mock)
- [ ] Spark's reply renders as text in the UI (real `api.meta.ai/v1` call visible in logs)
- [ ] Diarization-off or ambiguous attribution → UI greets as stranger, loop continues without error (REQ-42)
- [ ] `agent/` measures and logs per-turn STT→reply latency for a 20-turn scripted run (REQ-40 harness; numbers land in `audit/001-voice-loop-skeleton/verify.txt`)
- [ ] `docs/built-vs-borrowed.md` lists every borrowed component

**Verification (exact commands AdaL will run):**
```bash
pnpm install && pnpm build
# live smoke: scripted 20-turn WAV replay through the agent worker
node agent/scripts/latency-harness.ts --turns 20 --out audit/001-voice-loop-skeleton/verify.txt
grep -c "diarized" audit/001-voice-loop-skeleton/verify.txt
```

**Evidence:** `audit/001-voice-loop-skeleton/` → `muse-session.log` + `review.md` + `verify.txt`

---
*Protocol: AdaL (thinker) writes this → Muse Code (doer) executes → AdaL verifies against REQs → Tolu merges. See SOULBOUND.md §2.*
