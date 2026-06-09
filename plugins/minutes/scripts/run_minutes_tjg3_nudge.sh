#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EPIC_ID="minutes-tjg3"
PROMPT_FILE="$ROOT_DIR/docs/plans/minutes-tjg3-nudge-prompt.md"

cd "$ROOT_DIR"

if [[ "${1:-}" == "--dry-run" ]]; then
  node scripts/codex_epic_runner.mjs "$EPIC_ID" --prompt-file "$PROMPT_FILE" --dry-run
  exit 0
fi

node scripts/codex_epic_runner.mjs "$EPIC_ID" --prompt-file "$PROMPT_FILE" -- --full-auto "$@"

bd epic close-eligible --json >/dev/null
