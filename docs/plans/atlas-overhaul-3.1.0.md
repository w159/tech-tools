# Atlas 3.0.2 -> 3.1.0 overhaul - stage map (living)

> Note (2026-07-12): this plan is historical and pre-dates the v5.0.0 split.
> The Claude Code marketplace now lists 2 plugins (`atlas`, `armada`); the
> 12-plugin catalog is gone. See `docs/CHANGELOG.md` 2026-07-12 README rewrite
> follow-up entry for the current state.

Source: atlas:planner (opus), 2026-07-09, session 1b3bbf4e. Full map in planner
report; this file tracks decisions + status. Baselines under attack: improvements
#27-31 in atlas.db (verifier_coverage 0.6->1.0, parallel_waves 0->2,
dod_gate_repeat_failures 29->5, skill misfires 34->0, asset utilization ->0.5).

## Orchestrator rulings on the planner's open questions

1. Test gate baseline: >= 73 collected (hooks/ + scripts/), all passing.
2. Stage 8 scope: codex adapter ONLY concrete implementation (real logs at
   ~/.codex/sessions, JSONL, tokens+tools recoverable - explorer verified).
   cursor/cline/aider/gemini have no local logs; adapter interface generic,
   their concrete adapters deferred to 3.1.x. session_logs gains agent column.
3. verifier_coverage source: switch to dispatches table (tool_calls targets
   carry the known 0.994 key-mismatch; dispatches.agent_type is recorded by the
   tripwire at dispatch time).
4. Deny mechanism: per current hooks docs - JSON hookSpecificOutput
   permissionDecision "deny" for PreToolUse (implementer confirms against live
   docs per Law 4; exit-2 acceptable fallback if docs say otherwise).
5. Off-by-one: advisory fires when count since last dispatch >= 4 (existing);
   hard deny fires at PreToolUse when count >= 8 (the 9th op is denied).
6. .kimi-plugin/plugin.json: untouched, independently versioned.

## Stages

| # | Stage | Agent/tier | Status |
|---|---|---|---|
| 1 | prompt_optimizer classifier: arm flag + engine nudge | implementer/opus | wave 2 dispatched |
| 2 | tripwire hard-deny tier + edit-block to PreToolUse | implementer/opus | wave 2 dispatched |
| 3 | fork routing doctrine (subagent-kit.md + SKILL.md body) | implementer/sonnet | wave 2 dispatched |
| 4 | output style force-for-plugin + trim | implementer/sonnet | wave 2 dispatched |
| 5 | derive_run_metrics coverage from dispatches + unpaired helper | implementer/opus | blocked on wave 2 slots (atlas_db.py serial chain 5->7->8) |
| 6 | completion_gate unpaired-implementer condition (g) | implementer/opus | after 5 |
| 7 | observer-session exclusion + DB cleanup migration | implementer/opus | after 5 (same files) |
| 8 | agent column + codex ingest adapter (generic interface) | implementer/opus | after 7 |
| 9 | de-overlap frontmatter wave (39 descriptions) | implementer/opus | after 3 (SKILL.md sequencing) |
| 10 | adversarial verifier pass over stages 1-9 | verifier/opus fresh | after 1-9 |
| 11 | full regression (>=73 pass) + 3.1.0 bump + docs reconcile | implementer + docs-curator | after 10 |

## Loop-backs
- If casual sessions get denied/blocked, root cause is stage 1 classifier - reopen 1, re-verify 2+6.
- After stage 8, re-run stage 5 coverage check (multi-agent dispatches change pairing).
- After stage 9 rewrites SKILL.md frontmatter, re-run stage 3 grep on same file.

## Wave 1 results (done, verified in docs/.run/findings.json)
- fork env enable: verified (independent verifier, docs-fetched).
- discovery: pollution source session_ingest.py:193-274; codex-only cross-agent logs;
  de-overlap inventory 40 assets / 4 overlaps / ~5.4k chars bloat / 0 orphans.
