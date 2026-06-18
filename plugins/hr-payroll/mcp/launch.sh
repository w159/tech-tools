#!/usr/bin/env bash
# Launch a bundled MCP connector over stdio.
#
# Ensures the connector's .mcpb is extracted (race-free: extraction is part of
# startup, so it does not depend on SessionStart hook timing), then execs node
# on the connector's entry point. node resolves the co-located node_modules by
# walking up from the entry file.
#
# Usage: launch.sh <name> <entry-relative-path>
#   <name>   basename of the bundle (e.g. "auvik" for auvik.mcpb)
#   <entry>  path inside the bundle to the server entry (e.g. "dist/index.js")
set -euo pipefail

MCP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATA_ROOT="${CLAUDE_PLUGIN_DATA:-$MCP_DIR/.extracted}"
NAME="${1:?connector name required}"
ENTRY="${2:?entry path required}"

# Extract on first use (stderr only); then hand the process to node.
bash "$MCP_DIR/extract.sh" "$NAME" >&2

exec node "$DATA_ROOT/$NAME/$ENTRY"
