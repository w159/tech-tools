# Subagent Kit

How to dispatch a subagent so it stays small, focused, and returns only what you need.

## The dispatch spec (use this shape, nothing extra)

Pass paths and goals, not file contents. The subagent's prompt is its entire system prompt; every extra sentence is context it spends before starting.

```
ROLE: <one line, which specialist this is>
GOAL: <one sentence, measurable>
CONTEXT: <only what it cannot derive itself: key paths, the inventory line, prior finding ids>
DISCOVER FIRST: confirm the best-fit capability for this exact job,
  check live skills/MCP/LSP; use serena/LSP over grep+read; pull context7 docs
  for any library you touch and cite the version.
TOOLS ALLOWED: <explicit>
TOOLS FORBIDDEN: package installs - migrations - .env edits - git push  (+ Write/Edit for read-only roles)
DELIVERABLE: <exact artifact: a report, a diff, a findings entry path>
SUCCESS CRITERIA: <bullets, each independently checkable, each with required evidence>
OUT OF SCOPE: <bullets, what NOT to touch>
STOP CONDITIONS: <when to halt and report back rather than push through>
REPORT BACK (final message only): what you did - evidence (file:line / cmd output / screenshot path) -
  what you did NOT do - what you are uncertain about - proposed next step. Keep it tight, your
  final message is the only thing the orchestrator reads.
```

The spec above is the full form. Its load-bearing core is the **4-part brief**, never dispatch without all four:

1. **Task**: the one specific job (`GOAL`).
2. **Product**: exactly what to produce (`DELIVERABLE`).
3. **Where to save**: the path outputs land in (`.atlas/docs/evidence/`, `.atlas/docs/.run/`, a findings entry).
4. **Prior context**: only what the agent cannot derive itself (`CONTEXT`): paths, the failing case, finding ids.

For how to slice work into stages and when to fan out at all, see `multi-stage-planning.md`. For how the verify/critic agents confirm a result, see `verification-and-grounding.md`.

## Choosing the agent + model

- Pick the agent type from `capability-routing.md`. Set `model` per the tier table in `SKILL.md`.
- Read-only roles (explore, verify, db-probe, ui-test) -> `disallowedTools: [Write, Edit, MultiEdit, NotebookEdit]`.
- Parallel editors of the same tree -> `isolation: "worktree"` so they don't collide.
- Cap long/background jobs with a turn budget. Spawn all independent jobs in ONE message.
- **Subagents never talk to the user.** They cannot use AskUserQuestion; a subagent that
  hits a genuinely user-owned decision (destructive action, scope fork, missing
  credential) STOPS and returns a `DECISION NEEDED: <question + options>` line in its
  report instead of guessing. The orchestrator collects these and asks the user itself
  via AskUserQuestion - batching related decisions into one round where possible.

## Companion agents (this skill's core squad)

Use these by name as `subagent_type`. They already carry the orchestrator's discipline; your spec just supplies GOAL + CONTEXT + paths.

| Agent | Use for | Model | Writes? |
|---|---|---|---|
| `atlas:explorer` | map a feature/module, find owners, trace a call path | haiku | no |
| `atlas:implementer` | make one bounded change correctly, run the local gate | sonnet | yes |
| `atlas:verifier` | adversarially confirm a finding/fix in a fresh context | sonnet (->opus if critical) | no |
| `atlas:db-prober` | read-only schema / RLS / grants / indexes / EXPLAIN | sonnet | no |
| `atlas:ui-runtime-tester` | actually run the FE and validate observed behavior | sonnet | no |
| `atlas:planner` | decompose a task into a numbered, failable-check stage map | sonnet | no |
| `atlas:docs-curator` | keep `.atlas/docs/` as the single source of truth, current with the work | sonnet | only under `.atlas/docs/` |
| `atlas:docs-auditor` | audit `.atlas/docs/` for drift against the code/behavior | sonnet | no |
| `atlas:completeness-critic` | final "what did we miss" gap pass; findings seed the next wave | sonnet | no |

For domain depth, route instead to the installed specialists (`backend-architect`, `frontend-developer`, `security-engineer`, `debugger`, `devops-automator`, `code-reviewer`, `test-engineer`, `test-executor`, `secondary-expert-validator`, `codebase-explorer`), same spec shape.

## Fork subagents (`subagent_type: "fork"`) - when to inherit history instead of starting fresh

A fork inherits the full conversation history, the parent's system prompt, tools, and model - and its first request reuses the parent's prompt cache, so a forked dispatch is cheap. It requires `CLAUDE_CODE_FORK_SUBAGENT=1` (set globally on this machine). Fork is not a frontmatter field on an agent `.md` file - there is no such agent definition; `fork` is chosen at dispatch time, per call, by passing it as the `subagent_type`. A fork cannot spawn further forks.

Route by whether the dispatch's value comes from everything already said this session:

| Dispatch | Fork? | Why |
|---|---|---|
| `atlas:planner` | fork | decomposition needs the whole task history to be correct |
| `atlas:completeness-critic` | fork | judges gaps against everything already claimed or done this session |
| `atlas:docs-curator` | fork | writes docs reflecting the session's actual decisions, not a re-explained summary |
| synthesis / summary dispatches | fork | the output IS a compression of this conversation |
| `atlas:verifier` | never | law 5 independence requires a fresh context carrying none of the orchestrator's assumptions |
| `atlas:explorer` | never | cheap haiku lookup with no history dependency - forking defeats the point of a light dispatch |

**Fallback:** if fork is unavailable (env var unset, older CLI), dispatch the same role as a normal fresh subagent with a fuller brief - restate the relevant history in `CONTEXT` - and keep going. A missing fork never fails the wave.

**Caution:** a fork inherits the orchestrator's assumptions verbatim, unexamined. Anything that needs independent judgment - a verifier, a second opinion, any check that must not be contaminated by what the orchestrator already believes - must not fork.

## Structured output (define the shape, every time)

Every dispatch must specify the EXACT format the subagent returns: a named schema or a precise template. Unstructured reports are not comparable across a wave, and the orchestrator wastes context re-parsing prose. Define the shape up front so reports come back parseable and diffable.

State it in the spec's `REPORT BACK` line. A reusable schema:

```
SCHEMA: subagent-report v1
summary:    <2-3 sentences: what you did and the verdict>
findings:   [ { claim: <one line>, evidence: <file:line | cmd output | screenshot path>, severity: critical|high|medium|low } ]
unverified: [ <claim with no failable check: why it could not be proven> ]
next_step:  <single proposed action, or "none">
```

Match field names across a wave so results stack. For a verification dispatch, add `verdict: confirmed|refuted|needs-evidence`. For a planning dispatch, return the numbered stage map from `multi-stage-planning.md` instead.

## Parallelism & integration

- **In flight:** ~4-6 max. As each returns, read its report, then dispatch dependents.
- **Independent vs related:** only parallelize truly independent jobs. Related failures (one fix may resolve several) go to one agent first.
- **CONFLICT-CHECK before every wave (required):** for each agent in the wave, list its expected write/touch set (files/paths it will create or modify) and any ordering need (whether it consumes another agent's output). If two agents would write the same file or one needs another's output, they are not independent for that wave - either give the colliding agents the dispatch-time `isolation: "worktree"` option (a dispatch-time Agent option, not agent-file frontmatter) so their edits land in isolated worktrees, OR serialize just those agents while still fanning out the rest. Read-only agents have no write set and pass automatically. See `multi-stage-planning.md` for the full precondition.
- **Integrate:** after a wave, check for conflicting edits, run the affected gate, then mark findings. A verifier's `rejected` sends the item back to a *fresh* implementer with the failure attached: three failed attempts -> mark `needs-human`, defer, move on.

## Anti-patterns

- x Pasting file bodies into the prompt when a path + symbol name suffices.
- x "Fix everything": unscoped agents wander. One domain per agent.
- x Letting an agent grade its own fix: verification is always a separate context.
- x Returning raw logs/diffs in the final message: return the distilled report; write bulky evidence to `.atlas/docs/evidence/`.
- x Assuming a generated or downloaded file exists without reading it back - verify the path before acting on it. Use `${CLAUDE_PLUGIN_ROOT}` for plugin-internal paths.
- x Calling a deferred/MCP tool without loading its schema first (`ToolSearch` before the call); passing arrays or objects as strings causes `InputValidationError`.
- x Firing external/MCP/network calls without a timeout or retry; one transient failure should not silently kill the subagent.
