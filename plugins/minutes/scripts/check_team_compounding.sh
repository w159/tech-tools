#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

export CXXFLAGS="-I$(xcrun --show-sdk-path)/usr/include/c++/v1"

echo "[team] validate shared skill packs"
node scripts/validate_skill_pack.mjs \
  .claude/plugins/minutes/packs/founder-weekly.json \
  .claude/plugins/minutes/packs/relationship-intel.json

echo "[team] verify cowork extension proof-of-life bundle"
./scripts/check_cowork_extension.sh

echo "[team] run automation primitives"
cargo run -p minutes-cli -- automate weekly-summary --delivery-target slack-json --json >/tmp/minutes-automate-weekly.json
cargo run -p minutes-cli -- automate proactive-context --json >/tmp/minutes-automate-proactive.json

echo "[team] team-compounding checks passed"
