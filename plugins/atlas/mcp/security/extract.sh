#!/usr/bin/env bash
# Extract bundled .mcpb connector(s) into the persistent plugin data dir.
#
# Why: marketplace install copies only the plugin folder, so each connector
# ships as a self-contained .mcpb (dist + node_modules) alongside this script.
# We unpack it once into ${CLAUDE_PLUGIN_DATA} (writable, survives updates) and
# run node against the unpacked tree. Idempotent: re-extracts only when a
# bundle is missing or newer than the last extraction marker.
#
# Usage:
#   extract.sh            # ensure every *.mcpb beside this script is extracted
#   extract.sh <name>     # ensure only <name>.mcpb is extracted
#
# IMPORTANT: never write to stdout. A connector launched through launch.sh
# speaks JSON-RPC over stdout; stray output here would corrupt that stream.
set -euo pipefail

MCP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATA_ROOT="${CLAUDE_PLUGIN_DATA:-$MCP_DIR/.extracted}"

extract_one() {
  local mcpb="$1"
  [ -e "$mcpb" ] || { echo "missing bundle: $mcpb" >&2; return 1; }
  local name dest
  name="$(basename "$mcpb" .mcpb)"
  dest="$DATA_ROOT/$name"
  if [ ! -f "$dest/.extracted" ] || [ "$mcpb" -nt "$dest/.extracted" ]; then
    rm -rf "$dest"
    mkdir -p "$dest"
    unzip -q -o "$mcpb" -d "$dest" >&2
    touch "$dest/.extracted"
  fi
}

if [ "${1:-}" != "" ]; then
  extract_one "$MCP_DIR/$1.mcpb"
else
  for f in "$MCP_DIR"/*.mcpb; do
    [ -e "$f" ] || continue
    extract_one "$f"
  done
fi
