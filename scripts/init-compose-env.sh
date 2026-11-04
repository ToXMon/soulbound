#!/bin/sh
# Create .env for `docker compose` from .env.example with freshly generated
# LiveKit and operator-access secrets. Never overwrites an existing .env and
# never prints the secrets. You still add MODEL_API_KEY (and TTS_* for voice).
set -eu
cd "$(dirname "$0")/.."
if [ -e .env ]; then
  echo ".env already exists; leaving it untouched." >&2
  exit 1
fi
rand() { LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c "$1"; }
key="sb$(rand 12)"
secret="$(rand 40)"
password="$(rand 32)"
umask 077
awk -v key="$key" -v secret="$secret" -v password="$password" '
  /^LIVEKIT_API_KEY=/      { print "LIVEKIT_API_KEY=" key; next }
  /^LIVEKIT_API_SECRET=/   { print "LIVEKIT_API_SECRET=" secret; next }
  /^DEMO_ACCESS_PASSWORD=/ { print "DEMO_ACCESS_PASSWORD=" password; next }
  { print }
' .env.example > .env
echo "Wrote .env (mode 0600) with generated LiveKit keys and operator password."
echo "Next: set MODEL_API_KEY in .env, then run: docker compose up --build"
echo "Operator login: user 'operator', password is DEMO_ACCESS_PASSWORD in .env."
