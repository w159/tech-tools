#!/bin/bash
set -euo pipefail

APP_PATH="${1:-/Applications/Minutes Dev.app}"
KEYCODE="${2:-57}"
OUTPUT_PATH="${3:-/tmp/minutes-hotkey-diagnostic.json}"

if [[ ! -d "$APP_PATH" ]]; then
  echo "App not found: $APP_PATH" >&2
  echo "Usage: ./scripts/diagnose-desktop-hotkey.sh [/path/to/App.app] [keycode] [output_path]" >&2
  exit 1
fi

rm -f "$OUTPUT_PATH"

open -n -a "$APP_PATH" --args \
  --diagnose-hotkey \
  --diagnose-hotkey-keycode "$KEYCODE" \
  --diagnose-hotkey-output "$OUTPUT_PATH"

for _ in 1 2 3 4 5 6 7 8 9 10; do
  if [[ -f "$OUTPUT_PATH" ]]; then
    cat "$OUTPUT_PATH"
    STATUS="$(python3 - <<'PY' "$OUTPUT_PATH"
import json, sys
from pathlib import Path
path = Path(sys.argv[1])
payload = json.loads(path.read_text())
print(payload.get("probe", {}).get("status", "unknown"))
PY
)"
    if [[ "$STATUS" == "active" ]]; then
      exit 0
    fi
    exit 2
  fi
  sleep 1
done

echo "Timed out waiting for LaunchServices diagnostic output: $OUTPUT_PATH" >&2
exit 1
