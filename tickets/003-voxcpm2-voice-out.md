# Ticket 003: voxcpm2-voice-out

**Intent:** The character speaks. Stand up VoxCPM2 behind an OpenAI-compatible `/v1/audio/speech` endpoint (vLLM-Omni or Nano-vLLM serving) with an Akash SDL for the GPU deployment, generate the character's voice via Voice Design from a Spark-written persona description, LOCK the seed, and wire streaming TTS into the Ticket-001 loop so replies are spoken. The character inventing its own voice is a demo beat — the persona description Spark writes must be committed to `docs/voice.md`.

**Implements REQs:** REQ-40 (full speech-to-speech p50 < 2.5s warm), REQ-41 (locked voice seed), plus D13/D15 (TTS behind a replaceable interface)

**Files in scope:**
- `akash/deploy.yml` (new — SDL, 4090-class GPU)
- `agent/tts/` (new — TTS client behind a `TTSProvider` interface; VoxCPM2 implementation + interface docs)
- `agent/` (wire TTS into the existing worker only)
- `docs/voice.md` (new — persona description, locked seed, endpoint)
- `scripts/tts-smoke.sh` (new)

**Non-goals:** lip-sync, avatar animation, voice cloning of real people (forbidden — Voice Design only), multi-voice, production hardening of the Akash deployment.

**Constraints:**
- VoxCPM2 weights are Apache-2.0 — record in `docs/built-vs-borrowed.md`.
- Voice Design prompt format: `"(<description>)<text>"`; run up to 3 generations, pick once, then **freeze seed + description in `docs/voice.md`** (vendor docs: output varies run-to-run).
- `TTSProvider` interface: `synthesizeStream(text) -> audio chunks`. VoxCPM2 is one impl; the interface documents what a fallback must satisfy (D15).
- Sentence-level pipelining: TTS starts on Spark's first complete sentence, not the full reply (latency).
- Prewarm: SDL includes a startup probe; `scripts/tts-smoke.sh` must pass before the ticket closes.

**Acceptance criteria (each observable):**
- [ ] `scripts/tts-smoke.sh` produces audible 48kHz WAV from the deployed endpoint
- [ ] Same text + locked seed twice → same voice timbre (REQ-41; attach both WAVs to evidence)
- [ ] Full loop: speak → character answers ALOUD in its locked voice (REQ-40: latency harness re-run, p50 < 2.5s warm, logged to verify.txt)
- [ ] Akash `deploy.yml` validates (`akash` CLI dry-run / provider attr check) and the endpoint survives a restart (prewarm probe)
- [ ] `docs/voice.md` contains the Spark-written persona description + seed + endpoint

**Verification (exact commands AdaL will run):**
```bash
scripts/tts-smoke.sh "Hello, I am alive." /tmp/t1.wav
scripts/tts-smoke.sh "I remember everything we build together." /tmp/t2.wav
node agent/scripts/latency-harness.ts --turns 20 --speech --out audit/003-voxcpm2-voice-out/verify.txt
```

**Evidence:** `audit/003-voxcpm2-voice-out/` → `muse-session.log` + `review.md` + `verify.txt` + the two WAVs

---
*Protocol: AdaL (thinker) writes this → Muse Code (doer) executes → AdaL verifies against REQs → Tolu merges. See SOULBOUND.md §2.*
