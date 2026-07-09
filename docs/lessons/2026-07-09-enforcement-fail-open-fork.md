# Lessons from the atlas 3.1.0 overhaul (2026-07-09)

Source: orchestration run 215, session 1b3bbf4e. Evidence:
`docs/.run/findings.json`, `docs/evidence/2026-07-09-observer-purge.md`,
`docs/evidence/2026-07-09-codex-backfill.md`.

## 1. Advisory-only enforcement gets ignored

Twenty runs of observability data showed the dispatch discipline being violated
at will: inline-op spikes of 126 and 50 against an advisory threshold of 4, and
verifier coverage NULL for every run after 197. The advisory tripwire injected
STOP messages that the model read and rationalized past. What changed behavior
was structural: an arm-early signal at UserPromptSubmit (the flag can no longer
depend on the first dispatch that never comes) plus a PreToolUse deny tier with
an explicit escape hatch (`ATLAS_TRIPWIRE_HARD=off`). Rule of thumb: if a
discipline matters, wire it to an event that can block, arm it before the first
violation is possible, and keep advisory text only as the early warning.

## 2. Fail-open cascades can neuter a whole gate

The stage 6 verifier proved that pointing ATLAS_DB at an unusable path silently
no-ops the ENTIRE completion gate, not just the new condition (g): the
orchestration check itself fails open to False before any condition is
evaluated (`plugins/atlas/hooks/completion_gate.py`). Fail-open is the right
default for hooks (never crash a session), but its scope should be
per-condition, not per-gate - one shared dependency failing should degrade the
gate, not delete it. Carried as a design note for the next gate revision.

## 3. Fork for context-heavy roles, never for judges

`subagent_type: "fork"` (full conversation inheritance + prompt-cache reuse)
was exercised live twice this run: the completeness critic produced a
prioritized gap list with a single tool call because it already held the whole
session, and this docs reconciliation ran the same way. The token math is
decisive for critic/curator/planner-type roles that would otherwise need a long
re-briefing. The hard boundary: verifiers and anything requiring independent
judgment must stay fresh-context - a fork inherits the orchestrator's
assumptions, which is precisely what a verifier exists to escape (Law 5,
`plugins/atlas/skills/atlas-engine/references/subagent-kit.md:60-82`). The same
run also showed why the boundary matters: fresh verifiers refuted or refined
author claims three times (classifier false positives, codex token mechanism,
trigger regressions) - a fork would likely have inherited those blind spots.
