#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

export CXXFLAGS="-I$(xcrun --show-sdk-path)/usr/include/c++/v1"

echo "[activation] minutes-learn recommendation tests"
node .claude/plugins/minutes/hooks/test/minutes-learn.test.mjs

echo "[activation] generated docs drift check"
node scripts/generate_llms_txt.mjs --check

echo "[activation] public docs build"
npm --prefix site run build

echo "[activation] desktop activation/artifact tests"
cargo test -p minutes-app

echo "[activation] all checks passed"
