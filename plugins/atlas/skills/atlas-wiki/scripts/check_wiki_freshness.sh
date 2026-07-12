#!/usr/bin/env bash
#
# check_wiki_freshness.sh - compare newest mtime under
# .atlas/docs/architecture/ against newest mtime under
# .atlas/docs/wiki/diagrams/. Emits FRESH, MISSING, or STALE.
#
# Verdicts:
#   FRESH   exit 0  wiki/diagrams/ is newer than architecture/, or
#                    architecture/ is absent/empty (nothing to render).
#   MISSING exit 0  wiki/diagrams/ does not exist or is empty, while
#                    architecture/ is non-empty.
#   STALE   exit 1  some architecture file is newer than the newest
#                    wiki diagram.
#
# Usage:
#   bash "${CLAUDE_SKILL_DIR}/scripts/check_wiki_freshness.sh" <repo-root>
#
# Defaults to the current working directory when no repo-root is given.
# Plain ASCII only. No banned Unicode.

set -u

# Resolve repo root: first arg, or cwd. Strip any trailing slash.
repo_root="${1:-$(pwd)}"
repo_root="${repo_root%/}"

# Paths this script compares.
arch_dir="${repo_root}/.atlas/docs/architecture"
wiki_dir="${repo_root}/.atlas/docs/wiki/diagrams"

# Helper: print a verdict and exit with the right code.
emit() {
  printf '%s\n' "$1"
  exit "$2"
}

# If architecture/ does not exist or contains no files, there is nothing
# to render. Treat as FRESH (the wiring doc calls this N/A; the task spec
# folds N/A into FRESH exit 0).
if [ ! -d "$arch_dir" ]; then
  emit "FRESH" 0
fi
arch_first=$(find -L "$arch_dir" -type f 2>/dev/null | head -1)
if [ -z "$arch_first" ]; then
  emit "FRESH" 0
fi

# If wiki/diagrams/ does not exist or is empty, the wiki has never been
# rendered. Report MISSING (exit 0, per task spec).
if [ ! -d "$wiki_dir" ]; then
  emit "MISSING" 0
fi
wiki_first=$(find -L "$wiki_dir" -type f 2>/dev/null | head -1)
if [ -z "$wiki_first" ]; then
  emit "MISSING" 0
fi

# Detect stat flavor: BSD (macOS) uses -f %m, GNU uses -c %Y. Both emit
# epoch seconds. Pick whichever works on this machine.
stat_epoch() {
  if stat -f %m "$1" >/dev/null 2>&1; then
    stat -f %m "$1"
  else
    stat -c %Y "$1"
  fi 2>/dev/null
}

# Walk architecture files, track the newest mtime.
newest_arch=0
while IFS= read -r f; do
  m=$(stat_epoch "$f")
  if [ -n "$m" ] && [ "$m" -gt "$newest_arch" ] 2>/dev/null; then
    newest_arch="$m"
  fi
done <<EOF
$(find -L "$arch_dir" -type f 2>/dev/null)
EOF

# Walk wiki files, track the newest mtime.
newest_wiki=0
while IFS= read -r f; do
  m=$(stat_epoch "$f")
  if [ -n "$m" ] && [ "$m" -gt "$newest_wiki" ] 2>/dev/null; then
    newest_wiki="$m"
  fi
done <<EOF
$(find -L "$wiki_dir" -type f 2>/dev/null)
EOF

# Compare: if any architecture file is newer than the newest wiki
# diagram, the wiki is stale.
if [ "$newest_arch" -gt "$newest_wiki" ] 2>/dev/null; then
  emit "STALE" 1
fi

emit "FRESH" 0