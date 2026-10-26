# atlas-mod-plan-rev2: Atlas mod plan rev2 fact-check

- id: atlas-mod-plan-rev2
- status: verified
- verified_by: verifier-mod-plan-rev2
- verified_at: 2026-10-09T21:02:00+00:00

## Evidence
- All 10 corrections CONFIRMED: interface.md:731,812-830 ($.state reset by /clear,/resume,/branch; classic.SessionStart source clear/resume/fork); overview.md:189-199 (claude -p + Agent SDK: hooks yes, draws no); reference.md:290 (10/s, 30/s visible pane/expanded band/hint line); channel-view.ts:73-80 boardRoot; atlas_todo.py:149-162 find_root (.git/.atlas/docs, worktree map, range(7)); atlas_dash_colony.py:12-13,:38 STUCK_S=15*60,:406 parked; glyphs.js:23 blocked->input; atlas-agents.ts:38 implementer medium vs agents/implementer.md effort: low; squad-and-tiers.md:20-27 effort table; subagent-kit.md:126-128 fork roles,:135-137 fork inherits model+effort; capability-routing.md:27,34 and workflow-template.md:85,129,231 model opus in both atlas-orchestrate and atlas-audit copies; git grep headerFirstLinePattern -> only reader completion_gate.py:1682; turn_scoring.py:40 HEADER_RE ^ATLAS \|; reference.md:76 prompt.submit next({...e, context}), :81 prompt.context once per conversation. No new factual errors; nit: plan :104 and :308 say 30/s for 'band', docs say 'expanded band' (:45 is exact).

## Reproduction
curl -sL https://code.claude.com/docs/en/plugins/mods/reference.md | grep -n 'Throttled\|prompt.submit'; git grep -n headerFirstLinePattern

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
