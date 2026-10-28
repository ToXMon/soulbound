# SOULBOUND

A persistent voice+vision AI character with verifiable on-chain continuity and its own wallet.
Meta Global AI Developer Hackathon (Indie track, solo), Oct 27 – Nov 4, 2026.

Master state: [SOULBOUND.md](SOULBOUND.md) · Architecture & REQs: [docs/architecture.md](docs/architecture.md) · Borrowed components: [docs/built-vs-borrowed.md](docs/built-vs-borrowed.md)

## Run (Ticket 001 voice-loop skeleton)

```bash
cp .env.example .env   # fill in real values; never commit .env
pnpm install
pnpm dev               # app on http://localhost:3000; run the agent worker separately below
pnpm --filter agent start
```

Open the app, join the LiveKit room, speak: Muse Voice Transcribe (WebSocket, diarized)
→ Muse Spark (`muse-spark-1.3` via `https://api.meta.ai/v1`) → text reply in the UI.
Voice-out/TTS is Ticket 003, not this skeleton.

Latency harness (REQ-40):

```bash
node agent/scripts/latency-harness.ts --turns 20 --out audit/001-voice-loop-skeleton/verify.txt
```
