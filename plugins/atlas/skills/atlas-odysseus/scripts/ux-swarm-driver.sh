#!/usr/bin/env bash
# UX Test Swarm driver - deterministic orchestration of ui-runtime-tester agents.
#
# This script is a thin orchestrator. It sets up the run directory, maps
# user-supplied env knobs, and emits the phase plan that the skill follows.
# It does NOT enter data, navigate the app, or edit app source. The skill's
# agents do the work; this script sequences them.
#
# Usage (invoked by the atlas-odysseus skill, not directly by the user):
#   COUNT=12 COVERAGE=standard PROFILE=mixed FAST=1 GEN_SEED=42 \
#     bash "${CLAUDE_SKILL_DIR}/scripts/ux-swarm-driver.sh" <RUN_DIR> <REPO_ROOT>
#
# Outputs:
#   <RUN_DIR>/notes/env-knobs.json   - resolved knob values
#   <RUN_DIR>/notes/phase-plan.json  - ordered phase list for the chosen tier
#   stdout                          - compact phase plan for the skill to read
#
# Read-only with respect to the app: writes only under RUN_DIR.

set -euo pipefail

RUN_DIR="${1:-}"
REPO_ROOT="${2:-.}"

if [[ -z "$RUN_DIR" ]]; then
  echo "usage: ux-swarm-driver.sh <RUN_DIR> <REPO_ROOT>" >&2
  exit 2
fi

# --- Resolve env knobs (defaults match SKILL.md) ---
COUNT="${COUNT:-12}"
COVERAGE="${COVERAGE:-standard}"
PROFILE="${PROFILE:-mixed}"
FAST="${FAST:-0}"
GEN_SEED="${GEN_SEED:-}"

# --- Tier caps (conflict rule: coverage cap wins for user count) ---
case "$COVERAGE" in
  smoke)
    if (( COUNT > 2 )); then
      echo "WARN: smoke caps users at 2 (requested $COUNT); using 2" >&2
      COUNT=2
    fi
    ;;
  standard|full) ;;
  *)
    echo "ERROR: unknown COVERAGE '$COVERAGE' (expected smoke|standard|full)" >&2
    exit 2
    ;;
esac

mkdir -p "$RUN_DIR"/{notes,coverage,harness,evidence,reports}

# --- Persist resolved knobs ---
cat > "$RUN_DIR/notes/env-knobs.json" <<EOF
{
  "count": $COUNT,
  "coverage": "$COVERAGE",
  "profile": "$PROFILE",
  "fast": $FAST,
  "gen_seed": "${GEN_SEED:-random}",
  "repo_root": "$REPO_ROOT"
}
EOF

# --- Emit phase plan for this tier ---
# Phase 0 (discover) + 1 (generate) + 2 (enter) + 5 (verify) + 6 (synthesize)
# always run. 3 (browser walk) runs for standard+full. 4 (fuzz) runs full only.
phases=("0:discover" "1:generate" "2:enter" "5:verify" "6:synthesize")
[[ "$COVERAGE" == "standard" || "$COVERAGE" == "full" ]] && phases+=("3:browser-walk")
[[ "$COVERAGE" == "full" ]] && phases+=("4:fuzz")

# Keep phases in numeric order for readability.
IFS=$'\n' phases=($(printf '%s\n' "${phases[@]}" | sort -t: -k1 -n)); unset IFS

python3 - <<PY >> "$RUN_DIR/notes/phase-plan.json"
import json
phases = $(printf '%s\n' "${phases[@]}" | python3 -c 'import sys,json; print(json.dumps([l.strip() for l in sys.stdin if l.strip()]))')
print(json.dumps({"coverage": "$COVERAGE", "phases": phases}, indent=2))
PY

# Echo the plan for the skill to consume.
cat "$RUN_DIR/notes/phase-plan.json"