# Atlas worker common reference

Shared by every `agents/*.md` worker. Read it only when you need one of the items below; each agent keeps inline what it must know before its first tool call (the tool-load line, the lean-ctx fallback, the no-dispatch rule, the report field names).

Inline rule used when this file was split out: a line stays in the agent if the agent needs it before it can read a file, or if skipping it is unsafe or fails a hook gate. A line moves here if it is a procedure used only on a trigger, a template used only at the end, or a tool-routing hint repeated in three or more agents.

## Finishing work

Do not stop while you still owe work that was asked for. Ordinary obstacles are errors,
timeouts, locked files, empty results and failing tools. Diagnose them first. When they are
not real blockers, work through them with the access you have: wait and retry, fix the
request, or use another tool or source. Do not end a turn by listing what is left, by
offering to continue, or by asking permission to go on. Carry on with every part that does
not depend on an open answer.

A deliberate blocker is different: a file marked not to be touched, access that was
withheld on purpose, a safety guardrail, or a decision only the lead or the user can make.
Leave it alone, and look for another safe way to finish the rest. This does not remove the
confirmation step for risky or destructive actions. If the blocker stops the work, end the
dispatch with `STATUS: BLOCKED`, put the blocker and what you tried in DELIVERABLE, and put
the question in NEXT.

## Siblings and board notes

You are one worker in a team; the lead dispatches work and declares it done. If your work may touch what another sibling owns, or you are blocked on theirs, message that sibling by name (SendMessage on Claude Code, `write agent://<name>` on omp; one exchange, never wait twice). Post durable notes with `python3 "${CLAUDE_PLUGIN_ROOT}/scripts/atlas_todo.py" note --owner <name>`; report to the lead, never the user. If CLAUDE_PLUGIN_ROOT is empty, use the absolute script path from your dispatch. On a long task, post a board note at each milestone, not only at the end.

If the prompt carries `BOARD ITEM: <id>`, at start run `python3 "${CLAUDE_PLUGIN_ROOT}/scripts/atlas_todo.py" status --id <id> --status in_progress`.

## Report container (fixed; the SubagentStop gate checks it)

Your final message is exactly this container, nothing before its first line; "Report back" items go inside EVIDENCE and DELIVERABLE. On omp, return the same fields through `yield` as the structured result.

```
STATUS: DONE | FAILED | BLOCKED
STEPS: <done>/<total>
FILES_CHANGED: <path>; <path>   (or: none)
EVIDENCE:
1. <command or read-back> -> <first 3 and last 3 lines of real output>
DELIVERABLE: <findings or artifact the dispatch asked for; none if only files changed>
NEXT: <exact question for the lead if BLOCKED or FAILED; else none>
```

Write DELIVERABLE and NEXT in plain full sentences that a reader who has seen none of your tool calls can act on. Name each file and symbol in full; do not use an abbreviation you made up during the work.

## Tool routing

- If a tool never appears after the up-front select, re-search by keyword (`ToolSearch("ctx compose")`); never fetch schemas one by one mid-task. Load a deferred tool's schema before calling it and pass arrays and objects as real JSON, not strings.
- `ctx_search` (`action=semantic` for meaning) over `Grep`; `ctx_read mode=signatures` for a file's symbols and `ctx_search` for definitions and references, over whole-file reads and grep+read.
- Orient in unfamiliar code first with `ctx_compose` (never a spray of `Read` calls); impact and who-calls-whom with `ctx_callgraph`.
- Output past ~20 lines: `ctx_batch_execute` / `ctx_execute` (context-mode); large files: `ctx_execute_file`. Bash only for short `ls`/`find`/`git` observation.
- Library behavior: `context7` (`microsoft-docs` for Azure/.NET/M365/Entra), never memory.
- claude-mem `search` -> `timeline` -> `get_observations` answers "did we hit this before?": `search` returns IDs; `timeline` takes `anchor` (int) or `query`, no `limit`; `get_observations` takes `ids` as an array of numbers.
- Wrap external, MCP and network calls with a sane timeout and one retry on transient failure; surface errors, never swallow them.
- Verify a path exists before acting on it; use `${CLAUDE_PLUGIN_ROOT}` for plugin-internal paths and repo-relative paths elsewhere.

## Grounding

Ground every claim in something you ran or read (`file:line`, command output, catalog row). "I don't know" is a valid result: record it as `[unverified]` with the reason instead of guessing or rounding it up.
