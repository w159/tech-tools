#!/usr/bin/env bash
# Locate a vendor connector .mcpb and extract it into the persistent plugin data
# dir, on demand. Atlas does NOT bundle the ~297MB of .mcpb archives, so this
# script finds each vendor bundle at runtime in a defined search order and
# unpacks it once into ${CLAUDE_PLUGIN_DATA}.
#
# Search order for <name>.mcpb (first hit wins):
#   (a) ${CLAUDE_PLUGIN_DATA}/mcp/<name>.mcpb   - operator dropped it here
#   (b) ${ATLAS_MCP_SOURCE_DIR}/<name>.mcpb     - env points at a bundle dir
#   (c) <repo>/mcp_servers/<name>/<name>.mcpb   - source checkout, reachable
#                                                 relative to this plugin
#
# Usage: extract.sh <name>
#   <name>  .mcpb basename / svc dir (e.g. "auvik-mcp", "vanta-mcp")
#
# Exit codes:
#   0  connector already extracted, or extracted successfully now
#   2  no bundle found in any search location (caller prints setup guidance)
#
# IMPORTANT: never write to stdout. A connector launched through launch.sh
# speaks JSON-RPC over stdout; stray output here would corrupt that stream.
set -euo pipefail

MCP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATA_ROOT="${CLAUDE_PLUGIN_DATA:-$MCP_DIR/.extracted}"
NAME="${1:?connector name required}"

DEST="$DATA_ROOT/$NAME"

# Already extracted and current: nothing to do.
if [ -f "$DEST/.extracted" ]; then
  exit 0
fi

# Resolve the repo root relative to this plugin, if the source tree is present.
# plugins/atlas/mcp -> plugins/atlas -> plugins -> <repo root>.
REPO_ROOT="$(cd "$MCP_DIR/../../.." 2>/dev/null && pwd || true)"

find_bundle() {
  local candidates=()
  candidates+=("$DATA_ROOT/mcp/$NAME.mcpb")
  if [ -n "${ATLAS_MCP_SOURCE_DIR:-}" ]; then
    candidates+=("$ATLAS_MCP_SOURCE_DIR/$NAME.mcpb")
  fi
  if [ -n "$REPO_ROOT" ]; then
    candidates+=("$REPO_ROOT/mcp_servers/$NAME/$NAME.mcpb")
  fi
  local c
  for c in "${candidates[@]}"; do
    if [ -f "$c" ]; then
      printf '%s' "$c"
      return 0
    fi
  done
  return 1
}

BUNDLE="$(find_bundle || true)"
if [ -z "$BUNDLE" ]; then
  exit 2
fi

# Re-extract if the bundle is newer than the last extraction marker.
if [ ! -f "$DEST/.extracted" ] || [ "$BUNDLE" -nt "$DEST/.extracted" ]; then
  rm -rf "$DEST"
  mkdir -p "$DEST"
  unzip -q -o "$BUNDLE" -d "$DEST" >&2
  touch "$DEST/.extracted"
fi

exit 0
