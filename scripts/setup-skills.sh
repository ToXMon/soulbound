#!/usr/bin/env bash
# Recreate the machine-local skill symlinks for SOULBOUND.
# Clones the two reference skill libraries and links them into .agents/skills/.
# Usage: ./scripts/setup-skills.sh   (run from the repo root)
set -euo pipefail

REF="${SOULBOUND_REF_DIR:-$HOME/ref}"
mkdir -p "$REF"

[ -d "$REF/solana-rust-dev-companion" ] || \
  gh repo clone ToXMon/solana-rust-dev-companion "$REF/solana-rust-dev-companion" -- --depth 1
[ -d "$REF/ethskills" ] || \
  gh repo clone austintgriffith/ethskills "$REF/ethskills" -- --depth 1

cd "$(dirname "$0")/.."
for s in safe-solana-builder solana-architect solana-audit-prep solana-build solana-nfts solana-production-readiness solana-security solana-test solana-tokens; do
  ln -sfn "$REF/solana-rust-dev-companion/skills/$s" ".agents/skills/$s"
done
for s in concepts frontend-ux gas security standards testing tools wallets; do
  ln -sfn "$REF/ethskills/$s" ".agents/skills/eth-$s"
done

echo "Skills linked. Verify: muse skills list --source project --trust-workspace"
