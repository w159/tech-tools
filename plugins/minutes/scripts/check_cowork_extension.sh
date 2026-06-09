#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

OUT_DIR="$ROOT_DIR/dist/claude-cowork-extension/minutes"

echo "[cowork] building extension bundle"
./scripts/build_cowork_extension.sh

echo "[cowork] verifying bundle contents"
test -f "$OUT_DIR/manifest.json"
test -f "$OUT_DIR/package.json"
test -f "$OUT_DIR/README.md"
test -f "$OUT_DIR/server/index.js"

echo "[cowork] verifying manifest and package json parse"
node -e "JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8')); JSON.parse(require('fs').readFileSync(process.argv[2], 'utf8')); console.log('manifest and package parsed');" \
  "$OUT_DIR/manifest.json" \
  "$OUT_DIR/package.json"

echo "[cowork] proof-of-life bundle built at $OUT_DIR"
