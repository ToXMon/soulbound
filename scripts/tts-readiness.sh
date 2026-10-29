#!/usr/bin/env bash
# Ticket 003 readiness: health + one warm-up synthesis + three consecutive
# clean probes against the deployed endpoint. Syntax checks do not count.
# Env: TTS_BASE_URL, TTS_API_KEY, TTS_VOICE_DESCRIPTION, TTS_SEED (optional).
set -euo pipefail
: "${TTS_BASE_URL:?TTS_BASE_URL is required (deployed provider URI)}"
: "${TTS_API_KEY:?TTS_API_KEY is required (runtime secret)}"

echo "health: GET ${TTS_BASE_URL}/health"
curl -sS -o /dev/null -w "health http=%{http_code}\n" "${TTS_BASE_URL}/health" \
  -H "Authorization: Bearer ${TTS_API_KEY}"

echo "warm-up: one declared synthesis (excluded from measurements)"
"$(dirname "$0")/tts-smoke.sh" "Hello, I am alive." /tmp/soulbound-003-warmup.wav >/dev/null
echo "warm-up ok"

for i in 1 2 3; do
  echo "probe ${i}/3"
  "$(dirname "$0")/tts-smoke.sh" "Hello, I am alive." "/tmp/soulbound-003-probe-${i}.wav" >/dev/null
  echo "probe ${i}/3 ok"
done
echo "READINESS OK: health + warm-up + 3 consecutive clean probes"
