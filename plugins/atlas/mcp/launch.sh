#!/usr/bin/env bash
# Launch an atlas vendor connector over stdio, extracting its bundle on demand.
#
# Atlas ships these connectors INERT: every userConfig key defaults to empty, so
# with no credentials the server fails its own credential check and does not run.
# Atlas also does NOT bundle the vendor .mcpb archives. This script asks
# extract.sh to find and unpack the vendor bundle the first time a connector is
# actually used, then execs node on the connector's entry point.
#
# If no bundle can be found, the connector is "declared but not set up": this
# script exits with a clear, single-line message pointing at /atlas-connectors,
# and never crashes with a stack trace.
#
# Usage: launch.sh <name> <entry-relative-path>
#   <name>   .mcpb basename / svc dir (e.g. "auvik-mcp", "vanta-mcp")
#   <entry>  path inside the extracted bundle to the server entry
#            (e.g. "dist/index.js")
set -euo pipefail

MCP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATA_ROOT="${CLAUDE_PLUGIN_DATA:-$MCP_DIR/.extracted}"
NAME="${1:?connector name required}"
ENTRY="${2:?entry path required}"

# Ensure the bundle is extracted (stderr only). extract.sh exits 2 when no
# bundle is found anywhere in its search order.
if ! bash "$MCP_DIR/extract.sh" "$NAME" >&2; then
  echo "Connector $NAME is declared but not set up. Run /atlas-connectors and complete setup for $NAME." >&2
  exit 1
fi

TARGET="$DATA_ROOT/$NAME/$ENTRY"
if [ ! -f "$TARGET" ]; then
  echo "Connector $NAME is declared but not set up (entry $ENTRY missing after extract). Run /atlas-connectors and complete setup for $NAME." >&2
  exit 1
fi

exec node "$TARGET"
