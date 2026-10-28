# Ticket 001 Review — AdaL (thinker/verifier)

**Verdict: FAIL**

Review run 2026-10-28 on the VPS. The doer's report was treated as unverified claims; everything below was re-run or probed independently.

## Findings

### F1 (blocking) — Muse Voice Transcribe client speaks an invented protocol; the real endpoint rejects it

`agent/src/observe.ts` connects with an `Authorization` header and sends
`{type:"session.config", diarization:true, format:"pcm_s16le", sample_rate_hz:16000}`,
then sends audio as base64 JSON frames. None of that matches Meta's published
cookbook (`meta-model-cookbook/06_muse_voice/01_voice_api_fundamentals/utils.py`):

- Real endpoint: `wss://api.meta.ai/v1/asr/realtime` (the doer leaves the URL as an env placeholder).
- Auth rides **inside the handshake JSON** (`authorization:{accessToken}`); the header is ignored.
- Handshake: `{mode:"DIARIZATION", audioEncoding:"PCM_16KHZ"|"PCM_24KHZ", model:"muse-voice-transcribe-1.0", partialMode:"CUMULATIVE"}`.
- Audio is **binary PCM frames**, ended with `{"type":"endStream"}` — not base64 JSON.
- Speaker labels are bare letters (`"A"`, `"B"`); turn lifecycle is `speechStart → partials → speaker → speechEnd → speechComplete`, correlated by `turnId`. The doer's parser expects `speaker_0`-style labels plus `text/confidence/is_final` fields, and `OWNER_SPEAKER_LABEL=speaker_0` in `.env.example` encodes the same wrong assumption.

Empirical probe against the live endpoint (2026-10-28, reviewer's own script):

- Doer protocol → `{"type":"error","message":"You must specify the 'audioEncoding' attribute", ...}`
- Cookbook protocol → `{"sessionId":"voyager/duplex/..."}` (handshake accepted)

So acceptance criterion 2 cannot pass with this code, even with credentials.
The harness's "diarized" turns are scripted in the invented label format, which
hid this. This is the load-bearing failure.

### F2 — `.env.example` is git-ignored and would be silently dropped from the commit

`.gitignore` line 10 (`.env.*`) matches `.env.example` (`git check-ignore -v` confirms).
The ticket requires `.env.example` to document every var; as-is it would never reach the repo.
Fix needs a `!.env.example` exception (`.gitignore` is outside Ticket 001's files-in-scope — Tolu/AdaL call) or a force-add decision recorded here.

### F3 — Latency numbers are decide-only; REQ-40 not demonstrated

`verify.txt` p50 3989ms (doer run) / 3651ms (reviewer re-run) measures Spark
decide latency only, `sttMs=0`. The file labels this honestly. REQ-40 (first
audio p50 < 2.5s warm) also involves TTS (Ticket 003), so it is not this
ticket's pass bar — but no criterion should quote these numbers as turn latency.

## Acceptance criteria — observed vs unverified

| Criterion | State | Evidence |
| --- | --- | --- |
| `pnpm dev` brings up app; joining a room shows connected state | Unverified | Build passes; page smokes HTTP 200; no LiveKit server/credentials on this VPS, no room join observed. |
| Speaking produces a diarized transcript line (Muse VT, not a mock) | **FAIL** | F1: real endpoint rejects the doer's handshake (probed live). Not a mock — a wrong protocol. |
| Spark's reply renders as text in UI (real api.meta.ai call in logs) | Partially observed | Real Spark replies observed in harness logs (20/20, `muse-spark-1.3`); UI render path is code-reviewed only, never observed in a browser. |
| Diarization ambiguous → stranger greeting, loop continues (REQ-42) | Observed (scripted) | Harness turns 3/8/13/18 (`speaker:null` → stranger greeting, no error). Not observed from a real VT stream. |
| 20-turn latency harness logs per-turn STT→reply; numbers in verify.txt | Partially observed | Reviewer re-ran: 20/20, `grep -c diarized` = 21, exit 0. But STT leg absent (F3). |
| `docs/built-vs-borrowed.md` lists every borrowed component | Observed | Complete for starter/LiveKit/SDKs; must gain the cookbook VT protocol as borrowed reference after the F1 fix. |
| Owner round-trip on Tolu's Mac mic/headset | Unverified | Cannot be run from this VPS; Tolu-only criterion. |

## Verification commands run by the reviewer

```bash
pnpm install && pnpm build        # PASS (agent tsc, app next build)
MODEL_API_KEY=<runtime-only> node agent/scripts/latency-harness.ts --turns 20 --out /tmp/review-verify.txt
grep -c diarized /tmp/review-verify.txt   # 21
node /tmp/vt-probe.mjs            # doer handshake rejected; cookbook handshake accepted (live api.meta.ai)
```

The doer's `audit/001-voice-loop-skeleton/verify.txt` and `muse-session.log`
were preserved as submitted and are consistent with the reviewer's re-runs.

## Route back

FAIL routes to a smaller follow-up, per protocol — the reviewer does not patch
implementation. Smallest fix ticket for the doer:

1. Rewrite `agent/src/observe.ts` to the cookbook protocol (endpoint default
   `wss://api.meta.ai/v1/asr/realtime`, handshake JSON above, binary PCM,
   `endStream`, event lifecycle correlated by `turnId`, speaker letters).
2. Map owner = first diarized speaker letter (configurable), stranger otherwise (REQ-42 unchanged in spirit).
3. Point the harness at a real WAV replay through VT so "diarized" lines are VT output, not script labels.
4. Resolve F2 (`.gitignore` exception or recorded force-add).

No commit and no push were made: one ticket = one commit happens only after a
PASS (SOULBOUND.md §2). This diff stays uncommitted on the VPS for the fix round.
