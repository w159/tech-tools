#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

export CXXFLAGS="-I$(xcrun --show-sdk-path)/usr/include/c++/v1"

echo "[recall] minutes-app workspace test suite"
cargo test -p minutes-app

echo "[recall] workspace checks passed"
