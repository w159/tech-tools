#!/usr/bin/env bash
# validate_gitignore.sh - structural validator for a zero-trust .gitignore.
#
# Checks the load-bearing invariants of the deny-all-then-allowlist
# methodology:
#   1. Section 1 (deny-all) precedes every '!' allow rule.
#   2. Every '!path/' has a paired '!path/**'.
#   3. No '!*.env' or '!**/.env' rule exists anywhere (secret leak).
#   4. Banned Unicode absent (plain ASCII only).
#
# Exits 0 if valid, 1 with a reason if not.
#
# Usage:
#   bash "${CLAUDE_SKILL_DIR}/scripts/validate_gitignore.sh" <gitignore-path>
#
# Why a script: the ordering and pairing rules are deterministic and
# load-bearing. A missing pair silently lets a tracked folder appear
# ignored; a misplaced '!*.env' silently leaks secrets. Checking by
# hand is how that slips through.

set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "FAIL: usage: $0 <gitignore-path>" >&2
  exit 1
fi

target="$1"
if [[ ! -f "$target" ]]; then
  echo "FAIL: file not found: $target" >&2
  exit 1
fi

# 4. Banned Unicode - check first so we do not parse bad bytes.
# Banned codepoints: U+2013, U+2014, U+2018, U+2019, U+201C, U+201D, U+2026.
# Use perl for portability across BSD and GNU grep (BSD grep lacks -P).
if perl -CSD -ne 'exit 1 if /[\x{2013}\x{2014}\x{2018}\x{2019}\x{201C}\x{201D}\x{2026}]/' "$target"; then
  : # no banned chars (perl exits 0 when the line condition is never met)
else
  echo "FAIL: banned Unicode (em/en dash, curly quotes, or ellipsis) present" >&2
  exit 1
fi

# 1. Deny-all must precede every '!' allow rule.
# Find the line number of the deny-all rule (a line that is exactly '*'
# possibly with trailing whitespace).
deny_line=$(grep -nE '^\*\s*$' "$target" | head -1 | cut -d: -f1 || true)
if [[ -z "$deny_line" ]]; then
  echo "FAIL: deny-all rule (a line containing only '*') is missing" >&2
  exit 1
fi

# Find the first '!' allow rule.
first_allow_line=$(grep -nE '^\s*!' "$target" | head -1 | cut -d: -f1 || true)
if [[ -z "$first_allow_line" ]]; then
  echo "FAIL: no allow rules ('!...') found; nothing is tracked" >&2
  exit 1
fi

if [[ "$first_allow_line" -le "$deny_line" ]]; then
  echo "FAIL: allow rule at line $first_allow_line precedes deny-all at line $deny_line" >&2
  exit 1
fi

# 2. Every '!path/' must have a paired '!path/**'.
# Collect every directory allow rule of the form '!<name>/' (no trailing
# glob) and confirm a matching '!<name>/**' exists.
errors=0
while IFS= read -r line; do
  # Strip leading whitespace and the leading '!'.
  rule="${line#"!"}"
  rule="${rule#"!"}"
  # Only check rules ending in '/' that are directory includes.
  if [[ "$rule" == */ ]]; then
    pair="!${rule}**"
    if ! grep -qxF "$pair" "$target"; then
      echo "FAIL: '$line' lacks paired '$pair'" >&2
      errors=1
    fi
  fi
done < <(grep -E '^\s*!.*' "$target")

if [[ $errors -ne 0 ]]; then
  exit 1
fi

# 3. No '!*.env' or '!**/.env' rule anywhere (secret leak).
if grep -nE '^\s*!\*\.env' "$target" || grep -nE '^\s*!\*\*/\.env' "$target"; then
  echo "FAIL: found a '!*.env' or '!**/.env' rule that would leak secrets" >&2
  exit 1
fi

echo "OK: zero-trust .gitignore structure is valid."
exit 0