# WS5 - Adoption review memo (proposed verdicts, nothing applied)

Date: 2026-06-30. Source: live `~/.atlas/atlas.db` (`tool_calls`, `asset_verdicts`).

## Decision discipline (binding)

Every verdict below is **proposed, awaiting your explicit confirmation**. Nothing here is applied,
disabled, moved, or removed automatically - same CONFIRM discipline as `asset_audit.py`'s apply path.
This memo is a recommendation, not an action.

## Measurement caveat (read first)

Two limits make this a *preliminary* read, not the definitive adoption review the program spec
envisioned (it called for ~2 weeks of normal use AFTER the WS2 instrumentation landed):

1. **Invocation is undercounted.** `tool_calls` records Skill-tool and Agent-tool dispatches.
   Atlas skills that run inline (atlas-engine, atlas-architect methodology applied directly) often
   do not show up as a Skill call, so "idle" by this measure overstates non-use.
2. **The data predates the fixes.** WS1-WS4 (orchestration marker, recall signal, graphify scoping,
   the hub/launcher) only just landed. Adoption measured before they shipped cannot reflect them.

Recommendation: re-run this review after ~2 weeks of normal use on the fixed plugin. The verdicts
below are limited to signals that are unambiguous regardless of the window.

## Observed (current DB)

| Asset | Signal | Read |
|---|---|---|
| context-mode | 951 calls, 45 err (4.7%) | Heavily adopted, healthy. Keep. |
| claude-mem | 9 calls, 4 err (44%) | Near-unused AND failing nearly half its calls. |
| supermemory | 0 calls; auth "expired or revoked" all session | Dead. Not functioning. |
| serena | 1 call | Near-unused (likely inline LSP used instead). |
| sequentialthinking, codex | 0 calls | Not invoked this window. |
| atlas skills invoked | only `atlas-sextant` of 8 (tool_calls) | Undercounted - engine/architect run inline. |
| atlas squad invoked | 5 of 18 (`explorer, implementer, verifier, docs-curator, completeness-critic`) | The core review/build loop is used; specialist agents idle. |
| asset_audit verdicts | 63 agents + 98 skills `disable-here` (0 applied), 8 skills `relocate-global` (8 applied) | Marketplace-wide context-cost flags, already user-gated. |

## Verdicts (confirmed by the user 2026-06-30; follow-ups are separate work)

- **supermemory -> KEEP, configure for LOCAL operation.** User decision: leave it in the
  session-augmentation set but ensure its setup runs locally (local server) so it actually works
  rather than failing auth. Follow-up action (not part of this memo): point supermemory at its local
  server + valid local auth; confirm a non-zero working call count next session.
- **claude-mem -> INVESTIGATE & FIX the 44% error rate.** User decision: keep and fix (atlas leans on
  it for recall, now wired in WS2). Follow-up action: triage the 4/9 failing call types and resolve
  them before trusting recall metrics. Do NOT prune.
- **Atlas's own idle skills/agents -> ADD AN `/atlas` MENU (discoverability), do not prune.** User
  decision: treat idleness as a discoverability problem, not a pruning one. Follow-up action: build
  an `/atlas` menu/surface that lists the available skills/commands and when to use each, instead of
  removing idle assets. Re-measure adoption after a usage window.
- **Marketplace `disable-here` backlog (63 agents / 98 skills) -> USER-RUN asset_audit apply.** These
  are context-cost flags from `asset_audit.py`, already CONFIRM-gated. Run its apply path
  interactively when you want to trim context; not an atlas-cohesion change.

## Resulting follow-up actions (outside WS5's memo scope; prioritize separately)

1. supermemory local setup + auth.
2. claude-mem error triage (the 4 failing call types).
3. Build the `/atlas` discoverability menu.

## Acceptance (this memo) - MET

A written adoption memo citing invocation counts, each idle/failing asset carrying a verdict, decided
via interactive questions, with no automatic change and no build gate. Verdicts are now user-confirmed
above; the three resulting actions are tracked as separate follow-ups.
