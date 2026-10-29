#!/usr/bin/env bash
# Ticket 003 Gate B smoke: synthesize one sentence from the DEPLOYED endpoint
# through its actual provider URI and write a validated 48kHz mono WAV.
# Usage: scripts/tts-smoke.sh "Hello, I am alive." /tmp/soulbound-003-voice-a.wav
# Env: TTS_BASE_URL (provider URI, no trailing slash), TTS_API_KEY (runtime
# secret, never printed), TTS_VOICE_DESCRIPTION, TTS_SEED (optional).
# Proves incremental arrival: records time-to-first-byte vs total time.
set -euo pipefail

TEXT="${1:?usage: tts-smoke.sh <text> <out.wav>}"
OUT="${2:?usage: tts-smoke.sh <text> <out.wav>}"
: "${TTS_BASE_URL:?TTS_BASE_URL is required (deployed provider URI)}"
: "${TTS_API_KEY:?TTS_API_KEY is required (runtime secret)}"
DESC="${TTS_VOICE_DESCRIPTION:-a warm, youthful voice, gentle and curious, speaking clearly at a natural pace}"
SEED_JSON="null"
if [[ -n "${TTS_SEED:-}" ]]; then SEED_JSON="${TTS_SEED}"; fi

PCM="$(mktemp /tmp/soulbound-003-smoke.XXXXXX.wav)"
trap 'rm -f "${PCM}"' EXIT

TTS_MODEL="${TTS_MODEL:-openbmb/VoxCPM2}" python3 - "${TEXT}" "${DESC}" "${SEED_JSON}" > /tmp/soulbound-003-request.json <<'PY'
import json, sys
text, desc, seed = sys.argv[1], sys.argv[2], sys.argv[3]
payload = {
    "model": __import__("os").environ.get("TTS_MODEL", "openbmb/VoxCPM2"),
    "input": f"({desc}){text}",
    "voice": "default",
    # Live-verified: "pcm" streams are dropped by the pinned server; "wav"
    # streams a header + raw 48kHz PCM with first byte before synthesis ends.
    "response_format": "wav",
    "stream": True,
    "stream_format": "audio",
}
if seed != "null":
    payload["seed"] = int(seed)
print(json.dumps(payload))
PY

echo "POST ${TTS_BASE_URL}/v1/audio/speech (streaming wav, seed=${SEED_JSON})"
# -N disables curl buffering; --fail-with-body makes HTTP errors fatal so an
# error page can never be mistaken for PCM audio.
curl -sS -N --fail-with-body -X POST "${TTS_BASE_URL}/v1/audio/speech" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${TTS_API_KEY}" \
  --data @/tmp/soulbound-003-request.json \
  -o "${PCM}" \
  -w "http=%{http_code} content_type=%{content_type} ttfb_s=%{time_starttransfer} total_s=%{time_total} bytes=%{size_download}\n"

cp "${PCM}" "${OUT}"
python3 - "${OUT}" <<'PY'
import struct, sys, wave
out_path = sys.argv[1]
raw = open(out_path, "rb").read()
with wave.open(out_path, "rb") as w:
    rate, ch, width = w.getframerate(), w.getnchannels(), w.getsampwidth()
assert (rate, ch, width) == (48000, 1, 2), f"FAIL: expected 48kHz mono s16, got {rate}Hz {ch}ch {width*8}bit"
# Streaming WAV headers carry a placeholder data size; derive frames from bytes.
data_at = raw.find(b"data")
if data_at < 0:
    raise SystemExit("FAIL: no data chunk in WAV")
pcm = raw[data_at + 8:]
if len(pcm) % 2 != 0:
    raise SystemExit(f"FAIL: odd PCM byte count {len(pcm)}")
frames = len(pcm) // 2
peak = max(struct.unpack(f"<{frames}h", pcm)) if pcm else 0
print(f"OK: {out_path} rate={rate} channels={ch} bits={width*8} frames={frames} duration_s={frames/rate:.2f} peak={peak}")
if frames == 0 or peak == 0:
    raise SystemExit("FAIL: WAV is silent/empty — do not claim audible success")
PY
echo "Listen with headphones before claiming the voice works: ${OUT}"
