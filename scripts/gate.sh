#!/usr/bin/env bash
# Local test gate. `scripts/gate.sh commit` (scoped to staged files) and `scripts/gate.sh push` (everything the
# old CI jobs ran). One line per step: name and seconds. Stops at the first failing step and prints its output.
# Enable with: git config core.hooksPath .githooks
set -u

mode="${1:-}"
case "$mode" in commit | push) ;; *)
  echo "usage: scripts/gate.sh commit|push" >&2
  exit 2
  ;;
esac

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)" || exit 2
cd "$root" || exit 2

# pre-push hands ref lines on stdin; read them before anything else can consume it.
ranges=()
if [ "$mode" = push ]; then
  zero=0000000000000000000000000000000000000000
  while read -r _lref lsha _rref rsha; do
    [ -n "${lsha:-}" ] || continue
    case "$lsha" in "$zero"*) continue ;; esac # branch deletion
    case "${rsha:-$zero}" in
      "$zero"*) ranges+=("origin/main..$lsha") ;;
      *) ranges+=("$rsha..$lsha") ;;
    esac
  done
fi

if [ -x .venv/bin/python ]; then PY=.venv/bin/python; else PY=python3; fi
ATLAS=plugins/atlas
LOG="$(mktemp)"
trap 'rm -f "$LOG"' EXIT

need() { # need <tool>: fail the step with one line naming a missing tool
  command -v "$1" > /dev/null 2>&1 || {
    echo "missing tool on PATH: $1"
    return 1
  }
}

step() { # step <name> <function-or-command...>
  local name="$1" t0 rc
  shift
  t0=$SECONDS
  "$@" > "$LOG" 2>&1
  rc=$?
  printf '%-28s %4ss\n' "$name" "$((SECONDS - t0))"
  if [ "$rc" -ne 0 ]; then
    cat "$LOG"
    echo "gate: step '$name' failed (exit $rc)" >&2
    exit "$rc"
  fi
}

in_dir() { # in_dir <dir> <cmd...>
  local d="$1"
  shift
  (cd "$d" && "$@")
}

versions() { "$PY" scripts/check_versions.py; }
root_pytest() { "$PY" -m pytest -q -p no:cacheprovider scripts plugins/armada/tests plugins/programmer/tests; }
atlas_run() { python3 "$ATLAS/scripts/atlas_test.py" run "$@"; }
leftover_pytest() {
  "$PY" -m pytest -q -p no:cacheprovider --ignore="$ATLAS/hooks" --ignore="$ATLAS/scripts" --ignore=scripts \
    --ignore=plugins/armada/tests --ignore=plugins/programmer/tests
}
bun_test() { need bun && in_dir "$ATLAS" bun test "$@"; }
node_test() { need node && in_dir telemetry/server node --test; }

tsc_imports() {
  need bun || return 1
  local rc=0 out bad
  out=$(cd "$ATLAS" && bunx --package typescript@5 tsc --noEmit -p tsconfig.json) || rc=$?
  if [ "$rc" -gt 2 ]; then
    echo "tsc did not run (exit $rc)"
    printf '%s\n' "$out"
    return 1
  fi
  bad=$(printf '%s\n' "$out" | grep 'TS2307' | grep -E "module '\.\.?/" || true)
  if [ -n "$bad" ]; then
    printf '%s\n' "$bad"
    echo "unresolved relative import(s)"
    return 1
  fi
}

herdr_ui() {
  need bun && need herdr && need tmux || return 1
  local tmp rc=0 ui="$root/$ATLAS/colony/herdr-web-ui"
  tmp="$(mktemp -d /tmp/hg.XXXXXX)" # short paths: unix socket sun_path limit (~104 bytes on macOS)
  export HERDR_TEST_SESSION="g$$"
  export XDG_CONFIG_HOME="$tmp/config" HERDR_WEB_STATE_DIR="$tmp/state" HERDR_TEST_SHARDS=1
  export GIT_AUTHOR_NAME=CI GIT_AUTHOR_EMAIL=ci@example.invalid GIT_COMMITTER_NAME=CI GIT_COMMITTER_EMAIL=ci@example.invalid
  mkdir -p "$XDG_CONFIG_HOME" "$HERDR_WEB_STATE_DIR"
  (
    cd "$ui" || exit 1
    bun install --frozen-lockfile &&
      bun run build &&
      bun run test:unit &&
      bun run test:integration
  ) || rc=$?
  herdr --session "$HERDR_TEST_SESSION" server stop || true
  rm -rf "$tmp"
  return "$rc"
}

mod_gate() { need bun && need claude && python3 "$ATLAS/scripts/atlas_mod_gate.py" --live --require-live; }

attribution() {
  local r
  if [ "${#ranges[@]}" -eq 0 ]; then
    echo "no refs to push"
    return 0
  fi
  for r in "${ranges[@]}"; do
    echo "checking $r"
    python3 scripts/check_attribution.py "$r" || return 1
  done
}

if [ "$mode" = commit ]; then
  step versions versions
  staged=()
  while IFS= read -r f; do [ -n "$f" ] && staged+=("$f"); done < <(git diff --cached --name-only --diff-filter=ACMR)
  [ "${#staged[@]}" -gt 0 ] || exit 0

  atlas_paths=() root_hit=0 omp=0 mod=0 colony=0 bscripts=0 telemetry=0
  for f in "${staged[@]}"; do
    case "$f" in
      "$ATLAS"/*) atlas_paths+=("$f") ;;
    esac
    case "$f" in
      scripts/* | plugins/armada/* | plugins/programmer/*) root_hit=1 ;;
    esac
    case "$f" in
      "$ATLAS"/omp/*) omp=1 ;;
      "$ATLAS"/mod/*) mod=1 ;;
      "$ATLAS"/colony/*) colony=1 ;;
      "$ATLAS"/scripts/*) bscripts=1 ;;
      telemetry/server/*) telemetry=1 ;;
    esac
  done
  [ "${#atlas_paths[@]}" -eq 0 ] || step atlas-py atlas_run "${atlas_paths[@]}"
  [ "$root_hit" -eq 0 ] || step root-pytest root_pytest
  [ "$omp" -eq 0 ] || step bun-omp bun_test omp
  [ "$mod" -eq 0 ] || step bun-mod bun_test mod
  [ "$colony" -eq 0 ] || step bun-colony bun_test ./colony
  [ "$bscripts" -eq 0 ] || step bun-scripts bun_test ./scripts
  [ "$telemetry" -eq 0 ] || step telemetry-node node_test
  exit 0
fi

# push: cheapest first
step versions versions
step attribution attribution
step root-pytest root_pytest
step telemetry-node node_test
step bun-omp-mod bun_test omp mod
step tsc-relative-imports tsc_imports
step bun-colony-scripts bun_test ./colony ./scripts
step leftover-pytest leftover_pytest
step atlas-py atlas_run
step herdr-web-ui herdr_ui
step mod-gate-live mod_gate
exit 0
