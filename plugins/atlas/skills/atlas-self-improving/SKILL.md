---
name: atlas-self-improving
description: "Use to make Atlas gradually better in a codebase as it is worked - capture a reusable lesson (decision, fix, gotcha, preference) to claude-mem and committed .agents/ notes, surface a relevant past lesson before re-deriving it, and run the look-back loop on resume. Triggers when the user corrects the agent, when a non-obvious fix or pattern is found, after notable work, and on session resume. The atlas Stop/SubagentStop nudge hook points here."
---

# self-improving

Atlas compounds. Each session should leave the codebase's agent knowledge richer
than it found it, so the next session starts ahead instead of re-discovering. This
skill defines what to capture, where it goes, and when to look back. The long-form
reference is `../atlas-engine/references/self-improving.md`.

## When to capture

Capture only durable, reusable knowledge. Log when:
- the user corrects or rejects the work ("no, it should be...", "I prefer X", "stop doing Y"),
- a command, API, or build step fails in a non-obvious way worth remembering,
- a better approach is found and proven,
- the same instruction or pattern recurs 3+ times.

Do not capture one-time instructions, file-specific context, or hypotheticals.
Never infer a rule from silence.

## Where it goes

Two stores, used together:
- claude-mem (cross-session, cross-project): `observation_add` for a lesson,
  `memory_add` for a durable decision/preference. This survives project switches.
- Committed `.agents/` notes (in-repo, shared with the team and with Codex/Copilot):
  for project-specific conventions, gotchas, and decisions that belong with the code.

Capture format:

```
TYPE:    Decision | Pattern | Error | Constraint | Preference
CONTEXT: project / feature / library@version
LESSON:  one or two sentences - what to do differently next time
SOURCE:  file:line or command + observed result
```

## The nudge

The atlas Stop and SubagentStop hook (`hooks/nudge.py`) fires at most once per
window. When it fires, it asks two things: did this turn produce a lesson worth
capturing, and if behavior or structure changed, does `docs/` still match. Treat the
nudge as a prompt to act, not noise: capture the lesson if there is one, run a quick
docs-drift check if you changed something durable.

## Look back before re-deriving

On resume or after compaction, query memory before re-discovering anything:
- claude-mem `memory_search` / `observation_search` for the current task and repo,
- `.agents/` notes for project conventions,
- cite the source when you act on a recalled lesson ("using X, from .agents/notes.md").

This look-back is enforced as a hard gate in the orchestrator: atlas-engine step 0 (Orient) makes recall a precondition to planning - cite prior work or state "no prior work found" before decomposing any substantive task.

## Transparency and traps

Cite the source of any memory-derived action. Keep new lessons tentative until they
repeat; promoting too fast pollutes the hot set. Merge and summarize rather than
delete. Never log from observation alone - wait for an explicit correction or
repeated evidence.
