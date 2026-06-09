#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EPIC_ID="minutes-7oha"
PROMPT_FILE="$ROOT_DIR/docs/plans/minutes-7oha-nudge-prompt.md"

cd "$ROOT_DIR"

if [[ "${1:-}" == "--dry-run" ]]; then
  node scripts/codex_epic_runner.mjs "$EPIC_ID" --prompt-file "$PROMPT_FILE" --dry-run
  exit 0
fi

node scripts/codex_epic_runner.mjs "$EPIC_ID" --prompt-file "$PROMPT_FILE" -- --full-auto "$@"

# If all actionable descendants are closed, bd will close the eligible epic.
bd epic close-eligible --json >/dev/null
