#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEMPLATE_DIR="$ROOT/integrations/claude-cowork-extension"
OUT_DIR="$ROOT/dist/claude-cowork-extension/minutes"

echo "Building Minutes Cowork extension bundle..."

npm --prefix "$ROOT/crates/mcp" run build

rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR/server"

cp -f "$TEMPLATE_DIR/manifest.json" "$OUT_DIR/manifest.json"
cp -f "$TEMPLATE_DIR/package.json" "$OUT_DIR/package.json"
cp -f "$TEMPLATE_DIR/README.md" "$OUT_DIR/README.md"
cp -f "$ROOT/crates/mcp/dist/index.js" "$OUT_DIR/server/index.js"

npm install --omit=dev --prefix "$OUT_DIR"

echo
echo "Done."
echo "Bundle: $OUT_DIR"
