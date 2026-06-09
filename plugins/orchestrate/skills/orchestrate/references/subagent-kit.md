# Subagent Kit

How to dispatch a subagent so it stays small, focused, and returns only what you need.

## The dispatch spec (use this shape, nothing extra)

Pass paths and goals — not file contents. The subagent's prompt is its entire system prompt; every extra sentence is context it spends before starting.

```
ROLE: <one line — which specialist this is>
GOAL: <one sentence, measurable>
CONTEXT: <only what it cannot derive itself — key paths, the inventory line, prior finding ids>
DISCOVER FIRST: confirm the best-fit capability for this exact job —
  check live skills/MCP/LSP; use serena/LSP over grep+read; pull context7 docs
  for any library you touch and cite the version.
TOOLS ALLOWED: <explicit>
TOOLS FORBIDDEN: package installs · migrations · .env edits · git push  (+ Write/Edit for read-only roles)
DELIVERABLE: <exact artifact — a report, a diff, a findings entry path>
SUCCESS CRITERIA: <bullets, each independently checkable, each with required evidence>
OUT OF SCOPE: <bullets — what NOT to touch>
STOP CONDITIONS: <when to halt and report back rather than push through>
REPORT BACK (final message only): what you did · evidence (file:line / cmd output / screenshot path) ·
  what you did NOT do · what you are uncertain about · proposed next step. Keep it tight — your
  final message is the only thing the orchestrator reads.
```

## Choosing the agent + model

- Pick the agent type from `capability-routing.md`. Set `model` per the tier table in `SKILL.md`.
- Read-only roles (explore, verify, db-probe, ui-test) → `disallowedTools: [Write, Edit, MultiEdit, NotebookEdit]`.
- Parallel editors of the same tree → `isolation: "worktree"` so they don't collide.
- Cap long/background jobs with a turn budget. Spawn all independent jobs in ONE message.

## Companion agents (this skill's core squad)

Use these by name as `subagent_type`. They already carry the orchestrator's discipline; your spec just supplies GOAL + CONTEXT + paths.

| Agent | Use for | Model | Writes? |
|---|---|---|---|
| `orc-explorer` | map a feature/module, find owners, trace a call path | haiku | no |
| `orc-implementer` | make one bounded change correctly, run the local gate | sonnet | yes |
| `orc-verifier` | adversarially confirm a finding/fix in a fresh context | sonnet (→opus if critical) | no |
| `orc-db-prober` | read-only schema / RLS / grants / indexes / EXPLAIN | sonnet | no |
| `orc-ui-runtime-tester` | actually run the FE and validate observed behavior | sonnet | no |

For domain depth, route instead to the installed specialists (`backend-architect`, `frontend-developer`, `security-engineer`, `debugger`, `devops-automator`, `code-reviewer`, `test-engineer`, `test-executor`, `secondary-expert-validator`, `codebase-explorer`) — same spec shape.

## Parallelism & integration

- **In flight:** ~4–6 max. As each returns, read its report, then dispatch dependents.
- **Independent vs related:** only parallelize truly independent jobs. Related failures (one fix may resolve several) go to one agent first.
- **Integrate:** after a wave, check for conflicting edits, run the affected gate, then mark findings. A verifier's `rejected` sends the item back to a *fresh* implementer with the failure attached — three failed attempts → mark `needs-human`, defer, move on.

## Anti-patterns

- ❌ Pasting file bodies into the prompt when a path + symbol name suffices.
- ❌ "Fix everything" — unscoped agents wander. One domain per agent.
- ❌ Letting an agent grade its own fix — verification is always a separate context.
- ❌ Returning raw logs/diffs in the final message — return the distilled report; write bulky evidence to `.orchestrator/evidence/`.
