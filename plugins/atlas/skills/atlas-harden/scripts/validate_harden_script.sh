#!/usr/bin/env bash
# validate_harden_script.sh - structural check for an atlas-harden script.
#
# Confirms a PowerShell or shell hardening script has the CHECK / SET /
# VERIFY structure atlas-harden requires. Purely structural; it does not
# execute the target script. Exits 0 if the structure is present, 1 with
# a reason if not.
#
# Usage:
#   bash "${CLAUDE_SKILL_DIR}/scripts/validate_harden_script.sh" <script-path>
#
# Why a script: the CHECK/SET/VERIFY contract is deterministic. Checking
# it by hand is how a section gets silently dropped.

set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "FAIL: usage: $0 <script-path>" >&2
  exit 1
fi

target="$1"
if [[ ! -f "$target" ]]; then
  echo "FAIL: file not found: $target" >&2
  exit 1
fi

# Read case-insensitively so 'CHECK' / 'Check' / 'check' all match.
content_lower="$(tr '[:upper:]' '[:lower:]' < "$target")"

fail=0
missing=()

# Each section is detected by a comment or banner containing its name.
# We require all three; order is checked separately.
for section in check set verify; do
  if ! grep -q "$section" <<< "$content_lower"; then
    missing+=("$section")
    fail=1
  fi
done

if [[ $fail -ne 0 ]]; then
  joined="$(IFS=', '; echo "${missing[*]}")"
  echo "FAIL: missing required section(s): $joined" >&2
  exit 1
fi

# Order check: the first occurrence of CHECK must precede the first
# occurrence of SET, which must precede the first occurrence of VERIFY.
line_check=$(grep -in -m1 'check' "$target" | cut -d: -f1)
line_set=$(grep -in -m1 'set' "$target" | cut -d: -f1)
line_verify=$(grep -in -m1 'verify' "$target" | cut -d: -f1)

if [[ -z "$line_check" || -z "$line_set" || -z "$line_verify" ]]; then
  echo "FAIL: could not locate line numbers for all three sections" >&2
  exit 1
fi

if [[ "$line_check" -ge "$line_set" || "$line_set" -ge "$line_verify" ]]; then
  echo "FAIL: sections out of order; expected CHECK < SET < VERIFY" >&2
  echo "  CHECK at line $line_check, SET at line $line_set, VERIFY at line $line_verify" >&2
  exit 1
fi

echo "OK: CHECK/SET/VERIFY structure present and ordered."
exit 0