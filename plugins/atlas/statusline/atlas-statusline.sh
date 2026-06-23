#!/usr/bin/env bash
#
# atlas-statusline.sh - compact, colored one-line status line for atlas sessions.
#
# Claude Code feeds session JSON on stdin and renders whatever this script prints
# (see https://docs.claude.com/en/docs/claude-code/statusline). This script emits:
#
#     atlas | <git-branch> | <output-style-or-model>
#
# It is OPT-IN: nothing wires it up automatically. To enable it, add the snippet
# from README.md to your settings.json statusLine field. This script never writes
# to disk and never mutates state; it only reads stdin and the current git branch.

set -u

# --- Read the session JSON from stdin (Claude Code always pipes it in) ----------
input="$(cat 2>/dev/null || true)"

# --- ANSI colors (atlas green + gold accents); disabled if output is not a TTY --
# Claude Code renders ANSI in the status row, so we always emit them.
ESC=$'\033'
RESET="${ESC}[0m"
GREEN="${ESC}[38;5;29m"    # atlas dark green
GOLD="${ESC}[38;5;179m"    # atlas gold
DIM="${ESC}[2m"

# --- Field extraction -----------------------------------------------------------
# Prefer jq when present; fall back to a minimal grep/sed parser so the line still
# renders on a box without jq installed.
json_field() {
    # $1 = jq filter, $2 = sed-style top-level key for the fallback path
    local jq_filter="$1" key="$2" value=""
    if command -v jq >/dev/null 2>&1; then
        value="$(printf '%s' "$input" | jq -r "$jq_filter // empty" 2>/dev/null)"
    else
        # Fallback: grab the first "key":"value" match. Nested keys are skipped,
        # which is acceptable for a degraded no-jq display.
        value="$(printf '%s' "$input" \
            | grep -o "\"${key}\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" \
            | head -n1 | sed 's/.*:[[:space:]]*"\([^"]*\)".*/\1/')"
    fi
    printf '%s' "$value"
}

STYLE="$(json_field '.output_style.name' 'name')"
MODEL="$(json_field '.model.display_name' 'display_name')"
WORKDIR="$(json_field '.workspace.current_dir' 'current_dir')"

# --- Mode: the output style if one is active, else the model name ---------------
MODE="${STYLE:-$MODEL}"
[ -z "$MODE" ] && MODE="session"

# --- Branch: resolve from the session's working dir when we have one -------------
BRANCH=""
if [ -n "$WORKDIR" ] && [ -d "$WORKDIR" ]; then
    BRANCH="$(git -C "$WORKDIR" rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
else
    BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
fi
[ -z "$BRANCH" ] && BRANCH="no-git"

# --- Render ---------------------------------------------------------------------
printf '%satlas%s %s|%s %s%s%s %s|%s %s%s%s\n' \
    "$GREEN" "$RESET" \
    "$DIM" "$RESET" \
    "$GOLD" "$BRANCH" "$RESET" \
    "$DIM" "$RESET" \
    "$GOLD" "$MODE" "$RESET"
