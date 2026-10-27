# Atlas optimization + marketplace hygiene (design spec)

> Note (2026-07-12): this spec is historical and pre-dates the v5.0.0 split.
> The Claude Code marketplace now lists 2 plugins (`atlas`, `armada`); the
> 12-plugin catalog is gone. See `docs/CHANGELOG.md` 2026-07-12 README rewrite
> follow-up entry for the current state.

Date: 2026-06-22
Owner: orchestrator session
Status: approved, in implementation

## Why

Cross-session activity (claude-mem) and a current-state audit surfaced concrete gaps. This
spec is the contract for the implementation fan-out. Every subagent reads this file and edits
only its assigned, disjoint file set.

Evidence base (claude-mem observation IDs):
- #14075 error telemetry: "No such file" 41,940 + "does not exist" 17,372 (~56% of all errors);
  timeouts 14,529; InputValidationError 6,792. Path fragility and tool-contract mismatches are
  the dominant real failure modes.
- #14140 / #14143: atlas hook wiring; the PreToolUse Bash guard altered approval and caused
  approval friction.
- #13987: .env.template missing 36 connector vars; README stale plugin names.
- #13947 / #13949: systemic frontmatter corruption (39/397 files) was fixed; needs re-verify.

## Hard contract for atlas hooks (new, non-negotiable)

Atlas hooks NEVER alter the approval policy. They never emit `permissionDecision` and never
`exit 2` to deny a tool. They influence the agent only through `additionalContext` (advisory,
factual phrasing per Claude Code hooks docs line 779) or a one-time fail-open `Stop` reminder.
Their only legitimate purposes:
1. Keep the active session behaving as an orchestrator that delegates to subagents.
2. Keep docs/ (CHANGELOG, ROADMAP, dynamic durable subfolders) the single source of truth.

Verified against docs/claude-code/features/hooks.md: PreToolUse supports
`hookSpecificOutput.additionalContext` (injected next to the tool result, line 767), distinct
from the `permissionDecision` decision channel (line 791).

## Global constraints (every chunk)

- ASCII only. No em dash, en dash, curly quotes, or ellipsis character. Straight quotes only.
- Minimal diffs. No opportunistic refactoring outside the assigned change.
- All hooks stdlib-only, fail-open (any error exits 0; a hook never wedges a session).
- Use `${CLAUDE_PLUGIN_ROOT}` for plugin-internal paths, never hardcoded absolute paths.
- Bump atlas version 1.0.1 -> 1.1.0 (chunk B owns the bump).
- After edits, the assigned chunk states exactly what it changed and how it verified.

## Chunk A - hooks (owns: plugins/atlas/hooks/**, plugins/atlas/scripts/install_hooks.py)

A1. Rename `bash_guard.py` -> `bash_advisor.py`. Rewrite to advisory-only:
    - Keep the catastrophic DENY-pattern detection (rm -rf of root/home, fork bomb, mkfs,
      dd to raw disk, redirect over disk device, chmod 0777 /).
    - On a catastrophic match, emit ONLY:
      `{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":"<factual warning>"}}`
      Phrase factually, e.g. "This command matches a catastrophic, near-irreversible pattern
      (<reason>). Confirm intent before running." NO permissionDecision field.
    - DELETE the entire ASK list (force push, curl|sh, sudo). Non-catastrophic commands ->
      exit 0, no output.
    - Update the module docstring to describe advisory-only behavior.
A2. `hooks.json`: update the PreToolUse/Bash command to `bash_advisor.py`. Keep all other wiring.
A3. `session_boot.py`: strengthen the orchestration line in additionalContext. Add a factual
    statement that this session is the atlas orchestrator and substantive implementation is
    routed to atlas:<role> subagents (explorer/implementer/verifier), keep it concise, keep the
    9000-char cap and crash-proof exit 0.
A4. `completion_gate.py`: reconcile docstring with reality. It IS wired in hooks.json on Stop and
    runs by default when a docs/ tree exists (disable with ATLAS_GATE=off). Fix the docstring
    that wrongly says "Off by default -- installed only via install_hooks.py". It is opt-OUT.
    Keep behavior (one-time fail-open Stop reminder); keep stop_hook_active loop guard.
A5. Rename user-visible tokens `[orchestrate guard]`, `[orchestrate]`, `[orchestrate - ...]` ->
    `[atlas ...]` in all hook output strings. Sweep `orchestrate` in install_hooks.py and any
    other hook comments/paths; keep only genuinely-intended uses (none expected in hooks).

## Chunk B - manifests + README (owns: plugins/atlas/.claude-plugin/plugin.json, .claude-plugin/marketplace.json, plugins/atlas/README.md)

B1. Recount agents from disk (currently 18 files in plugins/atlas/agents). Replace "14-agent
    subagent squad" with the accurate count in BOTH plugin.json description and the marketplace
    atlas entry description (they are duplicated verbatim - keep them identical).
B2. Fix the launcher enumeration in the description: it omits atlas-prompt and the new
    atlas-validate (chunk D). List all atlas-* launchers accurately.
B3. marketplace.json TOP-LEVEL description: replace "the orchestrate multi-agent coding
    meta-agent" with an atlas-accurate phrase (e.g. "the atlas multi-agent coding meta-agent").
B4. README.md: reconcile counts and the command table with on-disk reality.
B5. Bump version 1.0.1 -> 1.1.0 in plugin.json.

## Chunk C - skills, references, agents (owns: plugins/atlas/skills/**, plugins/atlas/agents/**)

C1. atlas-engine SKILL.md "Automation: hooks enforce the discipline": update the bash hook
    description to advisory-only (`bash_advisor.py`, no deny/ask, additionalContext warning on
    catastrophic only). Correct completion_gate description from "opt-in" to "opt-out (on by
    default when docs/ exists; disable with ATLAS_GATE=off)".
C2. references/hooks-automation.md: same corrections. The "guard" section currently lists a stale
    broad ASK list (force push, hard reset, recursive delete, curl|sh, sudo, recursive
    chmod/chown, dependency installs) - replace with the advisory-only catastrophic-detection
    description. Rename the section from "guard" to "advisor" if it keys off the file name.
C3. Reliability hardening (maps to #14075). Add concise guidance, in the most fitting existing
    location (atlas-engine token-discipline/loop or references/verification-and-grounding.md and
    references/subagent-kit.md), plus the explorer + implementer agent prompts:
    - Path safety: verify a path exists before acting on it; never assume a generated file is
      present; prefer repo-relative resolution and ${CLAUDE_PLUGIN_ROOT} for plugin paths.
    - Tool-contract safety: for deferred/MCP tools, confirm the schema (ToolSearch) before
      calling to avoid InputValidationError; pass arrays/objects as real JSON, not strings.
    - Timeout resilience: wrap external/MCP/network calls with sane timeouts and one retry on
      transient failure.
    Keep additions tight (a few bullets each); do not bloat.
C4. Sweep stale `orchestrate` references in skills/references that are NOT the intentional
    atlas-engine trigger word (the description deliberately triggers on "orchestrate" - keep
    that). Rename leftover old-name references to atlas.

## Chunk D - new launcher (owns: plugins/atlas/commands/atlas-validate.md)

D1. Create `/atlas-validate`: a verification-gated launcher that drives
    plugin-dev:plugin-validator and plugin-dev:skill-reviewer over a target plugin (default: the
    plugin in the current path; arg: plugin name/path). Match the structure, frontmatter, and
    operating-contract injection of the existing /atlas-* commands (model the file on
    atlas-readme.md / atlas-harden.md). It reports findings; it does not auto-fix.

## Verification (orchestrator, after fan-out)

- Re-grep for stale `orchestrate` (excluding the intentional atlas-engine trigger word and
  vendored docs/ trees).
- Confirm no atlas hook emits `permissionDecision` or `exit 2` (grep the hooks dir).
- Confirm `hooks.json` references `bash_advisor.py` and the file exists.
- Confirm plugin.json/marketplace.json agent count matches `ls plugins/atlas/agents | wc -l`.
- ASCII-only check across changed files.
- Dispatch an independent atlas:verifier pass on the hook-contract claim.

## Phase 2 (separate, after Phase 1 lands)

Marketplace-wide hygiene: fan out plugin-dev:plugin-validator across all 12 plugins, re-verify
frontmatter (the #13947 issue), backfill .env.template (36 connector vars), fix README stale
plugin names, reconcile marketplace.json against disk.
