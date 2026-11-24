#!/usr/bin/env bash
# Local test gate.
#   scripts/gate.sh commit  the fast set the staged files can affect (hook, under 30 s)
#   scripts/gate.sh push    the whole fast set (hook, under 30 s)
#   scripts/gate.sh full    everything: the slow list (scripts/gate-slow.txt), herdr and the live mod gate included;
#                           run it by hand before a release, no hook calls it
# commit and push run independent steps concurrently: one line per step with its seconds, a failing step's output,
# then `total <n>s`. full runs sequentially and stops at the first failing step.
# Enable with: git config core.hooksPath .githooks
set -u

mode="${1:-}"
case "$mode" in commit | push | full) ;; *)
  echo "usage: scripts/gate.sh commit|push|full" >&2
  exit 2
  ;;
esac

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)" || exit 2
cd "$root" || exit 2

# pre-push hands ref lines on stdin; read them before anything else can consume it.
ranges=()
if [ "$mode" != commit ]; then
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
# Hooks export git's repo vars; tests that build fixture repos must not inherit them (commit mode unsets after reading the index).
[ "$mode" = commit ] || unset GIT_INDEX_FILE GIT_DIR GIT_WORK_TREE GIT_PREFIX GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES

if [ -x .venv/bin/python ]; then PY=.venv/bin/python; else PY=python3; fi
if [ "$PY" = python3 ]; then PYABS="$(command -v python3 || echo python3)"; else PYABS="$root/$PY"; fi
ATLAS=plugins/atlas
JOBS=8
START=$SECONDS
OUT="$(mktemp -d)"
LOG="$OUT/full.log"
trap 'rm -rf "$OUT"' EXIT

# the slow list: comments and blank lines dropped
grep -v '^[[:space:]]*\(#\|$\)' scripts/gate-slow.txt > "$OUT/slow" 2> /dev/null || : > "$OUT/slow"

need() { # need <tool>: fail the step with one line naming a missing tool
  command -v "$1" > /dev/null 2>&1 || {
    echo "missing tool on PATH: $1"
    return 1
  }
}

in_dir() { # in_dir <dir> <cmd...>
  local d="$1"
  shift
  (cd "$d" && "$@")
}

# ---- sequential runner (full) ----
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

# ---- concurrent runner (commit, push) ----
order=()
bg() { # bg <name> <function-or-command...>: start a step in the background
  local name="$1"
  shift
  order+=("$name")
  (
    t0=$SECONDS
    "$@" > "$OUT/$name.log" 2>&1
    echo "$? $((SECONDS - t0))" > "$OUT/$name.rc"
  ) &
}

finish() { # wait for every bg step, print results in start order, exit non-zero if any failed
  local name rc secs bad=0
  wait
  for name in ${order[@]+"${order[@]}"}; do
    read -r rc secs < "$OUT/$name.rc" 2> /dev/null || {
      rc=1
      secs=0
    }
    printf '%-28s %4ss\n' "$name" "$secs"
    if [ "$rc" -ne 0 ]; then
      bad=1
      cat "$OUT/$name.log"
      echo "gate: step '$name' failed (exit $rc)" >&2
    fi
  done
  echo "total $((SECONDS - START))s"
  exit "$bad"
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

# Fast Python files (repo-relative, one per line) from stdin -> one pytest process per file, $JOBS at a time,
# run in the file's own directory like atlas_test.py does. Prints the failures' output.
py_fast() {
  local f="$OUT/pyfast" files
  files=$(grep -vxFf "$OUT/slow")
  [ -n "$files" ] || {
    echo "no Python test files to run"
    return 0
  }
  mkdir -p "$f"
  printf '%s\n' "$files" | PYABS="$PYABS" F="$f" xargs -P "$JOBS" -n 1 bash -c '
    d=$(dirname "$1"); n=$(basename "$1")
    (cd "$d" && "$PYABS" -m pytest -q -p no:cacheprovider "$n") > "$F/$n.log" 2>&1 || echo "$1" >> "$F/failed"
  ' _
  if [ -s "$f/failed" ]; then
    local t
    while IFS= read -r t; do
      echo "--- $t (last 30 lines) ---"
      tail -n 30 "$f/$(basename "$t").log"
    done < "$f/failed"
    return 1
  fi
  echo "PASS $(printf '%s\n' "$files" | wc -l | tr -d ' ') Python files"
}

py_all_fast() { # every fast Python test file under the two atlas dirs
  find "$ATLAS/hooks" "$ATLAS/scripts" -maxdepth 1 -name 'test_*.py' | sort | py_fast
}

# bun_fast <dir>...: every bun test file under the dirs (relative to plugins/atlas) that is not on the slow list.
bun_fast() {
  need bun || return 1
  local files
  files=$(cd "$ATLAS" && find "$@" -type f \( -name '*.test.*' -o -name '*_test.*' -o -name '*.spec.*' \) \
    -not -path '*/node_modules/*' -not -path '*herdr-web-ui*' 2> /dev/null | sort |
    sed "s|^|$ATLAS/|" | grep -vxFf "$OUT/slow" | sed "s|^$ATLAS/|./|")
  [ -n "$files" ] || {
    echo "no bun test files to run"
    return 0
  }
  # shellcheck disable=SC2086
  in_dir "$ATLAS" bun test $files
}

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

# Python test files (repo-relative) the given staged paths select, via atlas_test.select.
selected_py() {
  python3 -c '
import sys
sys.path.insert(0, "plugins/atlas/scripts")
import atlas_test as a
for suite, names in a.select(sys.argv[1:]).files.items():
    for n in names:
        print(f"{a.SUITES[suite]}/{n}")
' "$@"
}

if [ "$mode" = commit ]; then
  bg versions versions
  staged=()
  while IFS= read -r f; do [ -n "$f" ] && staged+=("$f"); done < <(git diff --cached --name-only --diff-filter=ACMR)
  # git exports GIT_INDEX_FILE (a temp index on partial commits) to hooks; the staged list is read above, so drop it
  # before the tests run fixture repos.
  unset GIT_INDEX_FILE GIT_DIR GIT_WORK_TREE GIT_PREFIX GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES
  [ "${#staged[@]}" -gt 0 ] || finish

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
  if [ "${#atlas_paths[@]}" -gt 0 ]; then
    selected_py "${atlas_paths[@]}" > "$OUT/sel" 2> /dev/null || : > "$OUT/sel"
    bg atlas-py py_fast < "$OUT/sel"
  fi
  [ "$root_hit" -eq 0 ] || bg root-pytest root_pytest
  [ "$omp" -eq 0 ] || bg bun-omp bun_fast omp
  [ "$mod" -eq 0 ] || bg bun-mod bun_fast mod
  [ "$colony" -eq 0 ] || bg bun-colony bun_fast colony
  [ "$bscripts" -eq 0 ] || bg bun-scripts bun_fast scripts
  [ "$telemetry" -eq 0 ] || bg telemetry-node node_test
  finish
fi

if [ "$mode" = push ]; then
  # longest first so they overlap with everything else
  bg tsc-relative-imports tsc_imports
  bg atlas-py-fast py_all_fast
  bg bun-omp bun_fast omp
  bg bun-mod bun_fast mod
  bg bun-scripts-colony bun_fast scripts colony
  bg root-pytest root_pytest
  bg leftover-pytest leftover_pytest
  bg versions versions
  bg attribution attribution
  bg telemetry-node node_test
  bg mod-gate-live mod_gate
  finish
fi

# full: cheapest first, every file, nothing skipped
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
echo "total $((SECONDS - START))s"
exit 0
