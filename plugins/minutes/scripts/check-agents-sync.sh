#!/usr/bin/env bash
#
# check-agents-sync.sh — verify .agents/ tree stays in sync with .claude/plugins/minutes/
#
# Checks four categories:
#   1. Runtime hooks (must be byte-identical)
#   2. SKILL.md files (must be content-equivalent after normalizing known path/platform diffs)
#   3. Bundled scripts (byte-identical where mirrored)
#   4. Generated agent docs (llms.txt / llms-full.txt) must be current when agent surfaces change
#
# Exit 0 = in sync, Exit 1 = drift detected (with details on stderr)
#
# Usage:
#   ./scripts/check-agents-sync.sh          # check all
#   ./scripts/check-agents-sync.sh --staged # only check files in the git staging area

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PLUGIN_DIR="$REPO_ROOT/.claude/plugins/minutes"
AGENTS_DIR="$REPO_ROOT/.agents/skills/minutes"

staged_only=false
if [[ "${1:-}" == "--staged" ]]; then
  staged_only=true
fi

errors=0

# ── 1. Runtime hooks: must be byte-identical ──

check_runtime_file() {
  local name="$1"
  local plugin="$PLUGIN_DIR/hooks/lib/$name"
  local agent="$AGENTS_DIR/_runtime/hooks/lib/$name"

  if [[ ! -f "$plugin" ]]; then return; fi
  # Only check files that already exist in the agents tree.
  # Not all plugin hooks need mirroring — e.g., proactive-context.mjs is
  # SessionStart-only and has no agent-side consumer.
  if [[ ! -f "$agent" ]]; then return; fi

  if ! diff -q "$plugin" "$agent" >/dev/null 2>&1; then
    echo "DRIFT: hooks/lib/$name differs between plugin and agents tree" >&2
    echo "  Fix: cp -f '$plugin' '$agent'" >&2
    errors=$((errors + 1))
  fi
}

should_check_runtime() {
  if [[ "$staged_only" == "false" ]]; then return 0; fi
  # Check if any hooks/lib file is staged
  git diff --cached --name-only 2>/dev/null | grep -q 'plugins/minutes/hooks/lib/' && return 0
  git diff --cached --name-only 2>/dev/null | grep -q 'agents/skills/minutes/_runtime/hooks/lib/' && return 0
  return 1
}

if should_check_runtime; then
  for f in "$PLUGIN_DIR/hooks/lib/"*.mjs; do
    [[ -f "$f" ]] || continue
    check_runtime_file "$(basename "$f")"
  done
fi

# ── 2. SKILL.md files: content-equivalent after normalization ──

normalize_plugin_skill() {
  # Normalize a plugin SKILL.md to match agents conventions:
  # - Strip user_invocable frontmatter
  # - Strip allowed-tools block (plugin-only)
  # - Swap ${CLAUDE_PLUGIN_ROOT} -> $MINUTES_SKILLS_ROOT/_runtime
  # - Swap per-skill asset paths (scripts/, references/, etc.) to $MINUTES_SKILL_ROOT/
  # - Swap desktop app speaker references -> CLI equivalents
  local skill_name="$1"
  sed \
    -e '/^user_invocable:/d' \
    -e '/^allowed-tools:/,/^[^ ]/{ /^allowed-tools:/d; /^  - /d; }' \
    -e "s|\${CLAUDE_PLUGIN_ROOT}/skills/${skill_name}/|\$MINUTES_SKILL_ROOT/|g" \
    -e "s|\"\${CLAUDE_PLUGIN_ROOT}/skills/${skill_name}/|\"\$MINUTES_SKILL_ROOT/|g" \
    -e 's|\${CLAUDE_PLUGIN_ROOT}/skills/minutes-verify/scripts/|$MINUTES_SKILLS_ROOT/minutes-verify/scripts/|g' \
    -e 's|\${CLAUDE_PLUGIN_ROOT}/hooks/lib/|$MINUTES_SKILLS_ROOT/_runtime/hooks/lib/|g' \
    -e 's|"\${CLAUDE_PLUGIN_ROOT}/hooks/lib/|"$MINUTES_SKILLS_ROOT/_runtime/hooks/lib/|g' \
    -e 's|open the meeting in the Minutes desktop app and use the Confirm buttons in the Speakers section|run: `minutes confirm --meeting <path>`|g' \
    -e 's|open it in the Minutes desktop app and confirm the speakers there|run `minutes confirm --meeting <path>` to tag them|g' \
    -e 's|suggest confirming the names in the Minutes desktop speaker UI if needed|suggest `minutes confirm` to lock it in|g'
}

normalize_agents_skill() {
  # Normalize an agents SKILL.md by stripping the Skill Path header block
  # (everything from "## Skill Path" to the next "# " heading)
  sed '/^## Skill Path$/,/^# /{/^# /!d; /^## Skill Path$/d;}'
}

check_skill() {
  local name="$1"
  local plugin="$PLUGIN_DIR/skills/$name/SKILL.md"
  local agent="$AGENTS_DIR/$name/SKILL.md"

  if [[ ! -f "$plugin" ]]; then return; fi
  if [[ ! -f "$agent" ]]; then
    echo "DRIFT: $agent missing (exists in plugin)" >&2
    errors=$((errors + 1))
    return
  fi

  local diff_output
  diff_output=$(diff \
    <(normalize_plugin_skill "$name" < "$plugin") \
    <(normalize_agents_skill < "$agent") \
    2>/dev/null) || true

  # Filter out empty context lines that differ only in trailing whitespace
  local real_diffs
  real_diffs=$(echo "$diff_output" | { grep '^[<>]' || true; } | { grep -v '^[<>] $' || true; } | wc -l | tr -d ' ')

  if [[ "$real_diffs" -gt 0 ]]; then
    echo "DRIFT: skills/$name/SKILL.md has $real_diffs content-diff lines after normalization" >&2
    echo "$diff_output" | { grep '^[<>]' || true; } | { grep -v '^[<>] $' || true; } | head -5 >&2
    if [[ "$real_diffs" -gt 5 ]]; then
      echo "  ... and $((real_diffs - 5)) more" >&2
    fi
    errors=$((errors + 1))
  fi
}

should_check_skills() {
  if [[ "$staged_only" == "false" ]]; then return 0; fi
  git diff --cached --name-only 2>/dev/null | grep -q 'plugins/minutes/skills/' && return 0
  git diff --cached --name-only 2>/dev/null | grep -q 'agents/skills/minutes/' && return 0
  return 1
}

if should_check_skills; then
  for skill_dir in "$PLUGIN_DIR/skills/minutes-"*/; do
    [[ -d "$skill_dir" ]] || continue
    skill_name="$(basename "$skill_dir")"
    check_skill "$skill_name"
  done
fi

# ── 3. Bundled scripts: byte-identical where mirrored ──

should_check_scripts() {
  if [[ "$staged_only" == "false" ]]; then return 0; fi
  git diff --cached --name-only 2>/dev/null | grep -q 'plugins/minutes/skills/.*/scripts/' && return 0
  git diff --cached --name-only 2>/dev/null | grep -q 'agents/skills/minutes/.*/scripts/' && return 0
  return 1
}

if should_check_scripts; then
  for script in "$PLUGIN_DIR/skills/"*/scripts/*; do
    [[ -f "$script" ]] || continue
    skill_name=$(echo "$script" | sed "s|$PLUGIN_DIR/skills/||;s|/scripts/.*||")
    script_name=$(basename "$script")
    agent_script="$AGENTS_DIR/$skill_name/scripts/$script_name"

    if [[ -f "$agent_script" ]] && ! diff -q "$script" "$agent_script" >/dev/null 2>&1; then
      echo "DRIFT: skills/$skill_name/scripts/$script_name differs" >&2
      echo "  Fix: cp -f '$script' '$agent_script'" >&2
      errors=$((errors + 1))
    fi
  done
fi

# ── 4. Generated agent docs must be current ──

should_check_agent_docs() {
  if [[ "$staged_only" == "false" ]]; then return 0; fi
  git diff --cached --name-only 2>/dev/null | grep -qE \
    '(^|/)(tooling/skills/|\.claude/plugins/minutes/|\.agents/skills/minutes/|\.opencode/(skills|commands)/|site/lib/skills-catalog\.json|scripts/generate_llms_txt\.mjs)' \
    && return 0
  return 1
}

if should_check_agent_docs; then
  if ! node "$REPO_ROOT/scripts/generate_llms_txt.mjs" --check >/dev/null 2>&1; then
    echo "DRIFT: generated agent docs (llms.txt / llms-full.txt / related surfaces) are stale" >&2
    echo "  Fix: node scripts/generate_llms_txt.mjs" >&2
    errors=$((errors + 1))
  fi
fi

# ── Result ──

if [[ "$errors" -gt 0 ]]; then
  echo "" >&2
  echo "Found $errors agent-surface sync/doc issue(s)." >&2
  echo "Run: ./scripts/check-agents-sync.sh (without --staged) to see all drift" >&2
  exit 1
fi
