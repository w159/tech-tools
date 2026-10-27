#!/bin/bash
# usage: run_session.sh <config_dir> <out_prefix>
export CLAUDE_CONFIG_DIR="$1"; out="$2"
proj=$(mktemp -d); cd "$proj"
unset CLAUDE_CODE_SESSION_ID CLAUDE_PID
timeout 240 claude -p "Reply with the single word OK." --output-format stream-json --verbose --include-hook-events --max-turns 1 --debug-file "$out.debug.log" > "$out.stream.jsonl" 2> "$out.stderr.txt"
echo "exit=$?"
rm -rf "$proj"
