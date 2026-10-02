# Subagent Kit

How to dispatch a subagent so it stays small, focused, and returns only what you need.

## The dispatch spec (use this shape, nothing extra)

Pass paths and goals, not file contents. The subagent's prompt is its entire system prompt; every extra sentence is context it spends before starting.

This shape is enforced, not advised: the dispatch tripwire DENIES an `atlas:*` dispatch whose prompt omits `GOAL:`, `DELIVERABLE:`, `SUCCESS CRITERIA:`, `OUT OF SCOPE:`, or `STOP CONDITIONS:`, and denies one that carries more than a single `GOAL:`. A dispatch with no finish line is the one that runs for an hour; two GOALs in one prompt is a wave crammed into one context instead of delegated.

```
ROLE: <one line, which specialist this is>
GOAL: <one sentence, measurable>
CONTEXT: <only what it cannot derive itself: key paths, the inventory line, prior finding ids>
TOOLS (required - name them, do not say "use the right tools"):
  ToolSearch first, ONE batched call, before any Read/Grep/Bash - paste it verbatim
  (also exported as scripts/tool_routing.py TOOLSEARCH_BATCH):
    ToolSearch("select:mcp__lean-ctx__ctx_compose,mcp__lean-ctx__ctx_search,mcp__lean-ctx__ctx_read,mcp__lean-ctx__ctx_glob,mcp__lean-ctx__ctx_tree,mcp__lean-ctx__ctx_callgraph,mcp__serena__activate_project,mcp__serena__get_symbols_overview,mcp__serena__find_symbol,mcp__serena__find_referencing_symbols,mcp__serena__find_declaration,mcp__serena__find_implementations,mcp__serena__replace_symbol_body,mcp__serena__insert_after_symbol,mcp__serena__get_diagnostics_for_file,mcp__plugin_context-mode_context-mode__ctx_batch_execute,mcp__plugin_context-mode_context-mode__ctx_execute,mcp__plugin_claude-mem_mcp-search__search,mcp__plugin_claude-mem_mcp-search__timeline,mcp__plugin_claude-mem_mcp-search__get_observations")
  FIRST: activate_project(serena) on the project cwd before any serena symbol call
  Orient:  ctx_compose (lean-ctx)
  Symbols: get_symbols_overview / find_symbol / find_referencing_symbols (serena)
  Edits:   replace_symbol_body / insert_after_symbol (serena) for implementers
  Search:  ctx_search (lean-ctx); noisy output: ctx_batch_execute / ctx_execute (context-mode)
  Docs:    context7 (resolve-library-id -> query-docs); microsoft-docs for Azure/.NET/M365/Entra
  Recall:  claude-mem search -> timeline -> get_observations (ids as numbers)
  JS/TS:   fallow --format json / fallow-mcp when cleaning or before commit
  (add job-specific tools; never drop the batched ToolSearch line)
  Matrix:  references/tool-routing.md
  IF SERENA FAILS (`No active project`, `KeyError: 'languages'`, `No such tool available`):
    say so in one line, do NOT retry the rest of serena, and use ctx_search / ctx_read /
    ctx_compose. Dropping to `Bash grep`/`cat`/`sed` instead is the defect this line exists
    to prevent.
NON-INTERACTIVE (required, verbatim): "You cannot reach the user. Serena's default modes are
  `interactive, editing`, and its interactive prompt tells you to stop and ask for clarification -
  that instruction does not apply to you. Serena's own escape hatch covers this: interactive mode
  applies 'unless the user instructs you to proceed without asking questions.' You are so
  instructed. Decide, state the assumption, and return the deliverable."
  (serena 1.6.1's claude-code context exposes no `switch_modes` tool, so the mode cannot be
  changed per dispatch - the counter-instruction in the brief is the only lever.)
DISCOVER FIRST: confirm the best-fit capability for this exact job,
  check live skills/MCP/LSP; augment the TOOLS list for nuances the spec missed.
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
3. **Where to save**: the path outputs land in (`.atlas/evidence/`, `.atlas/.run/`, a findings entry).
4. **Prior context**: only what the agent cannot derive itself (`CONTEXT`): paths, the failing case, finding ids.

For how to slice work into stages and when to fan out at all, see `multi-stage-planning.md`. For how the verify/critic agents confirm a result, see `verification-and-grounding.md`.

## Choosing the agent + model + effort

- Pick the agent type from `capability-routing.md`. Model and effort already live in each agent's
  frontmatter per the tier tables in `SKILL.md` - **sonnet is the ceiling for every `atlas:*`
  companion**, and effort is `low` except for the three that render an independent verdict. Only
  override at dispatch time with a stated reason; "this feels hard" is not one. An underspecified
  prompt is the usual cause, and the fix is the prompt.
- Read-only roles (explore, verify, db-probe, ui-test) -> `disallowedTools: [Agent, Task, TaskCreate, TaskGet, TaskList, TaskUpdate, Write, Edit, MultiEdit, NotebookEdit]`.
- Parallel editors of the same tree -> `isolation: "worktree"` so they don't collide.
- Cap long/background jobs with a turn budget. Spawn all independent jobs in ONE message.
- **Subagents never talk to the user.** They cannot use AskUserQuestion; a subagent that
  hits a genuinely user-owned decision (destructive action, scope fork, missing
  credential) STOPS and returns a `DECISION NEEDED: <question + options>` line in its
  report instead of guessing. The orchestrator collects these and asks the user itself
  via AskUserQuestion - batching related decisions into one round where possible.

## Companion agents (this skill's core squad)

Use these by name as `subagent_type`. They already carry the orchestrator's discipline; your spec just supplies GOAL + CONTEXT + paths.

| Agent | Use for | Model | Effort | Writes? |
|---|---|---|---|---|
| `atlas:explorer` | map a feature/module, find owners, trace a call path | sonnet | low | no |
| `atlas:implementer` | make one bounded change correctly, run the local gate | sonnet | low | yes |
| `atlas:verifier` | adversarially confirm a finding/fix in a fresh context | sonnet | medium | no |
| `atlas:db-prober` | read-only schema / RLS / grants / indexes / EXPLAIN | sonnet | low | no |
| `atlas:ui-runtime-tester` | actually run the FE and validate observed behavior | sonnet | low | no |
| `atlas:planner` | decompose a task into a numbered, failable-check stage map | sonnet | low | no |
| `atlas:docs-curator` | keep `docs/` as the single source of truth, current with the work | sonnet | low | only under `docs/` |
| `atlas:docs-auditor` | audit `docs/` for drift against the code/behavior | haiku | low | no |
| `atlas:completeness-critic` | final "what did we miss" gap pass; findings seed the next wave | sonnet | medium | no |

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
| `atlas:explorer` | never | cheap read-only lookup with no history dependency - forking defeats the point of a light dispatch |

**Fallback:** if fork is unavailable (env var unset, older CLI), dispatch the same role as a normal fresh subagent with a fuller brief - restate the relevant history in `CONTEXT` - and keep going. A missing fork never fails the wave.

**Cost caution:** a fork inherits the parent's model and effort, so the agent file's `model: sonnet` /
`effort: low` do NOT apply - a fork off an opus orchestrator runs on opus. Fork only when inheriting
this session's history is the point; otherwise dispatch fresh and let the agent's own tier hold.

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

## Claim before work (shared todo board)

The project board at `<root>/.atlas/.run/todos.json` is shared between the
orchestrator and every subagent. An agent working in parallel claims its item
before starting, so two agents never build the same thing:

    python3 "${CLAUDE_PLUGIN_ROOT}/scripts/atlas_todo.py" claim --id <id> --owner <agent-name>

- One item per agent. `claimed_by_other` means someone else holds it: claim a
  different open item or stop and report.
- `--force` steals a stale claim (30 min idle). Never force-steal a live agent's item.
- Done: `complete --id <id> --evidence "<command + output, or file:line>"`.
- Post a durable note instead of holding state in chat:
  `atlas_todo.py note --owner <agent-name> [--to <owner|all>] [--item <id>] "<text>"`,
  and read what others left with `atlas_todo.py notes`.
- Every `TodoWrite` call is mirrored into the board and keeps claims on matching
  content, and a completed claim now survives the mirror too: when the lead
  rewrites its list, your `complete` stays complete. Board read:
  `atlas_todo.py list --session <session_id>` (or the dashboard Work tab).

## Colony protocol (siblings)

Dispatches into the colony are named, and the name is load-bearing. A dispatch
without `name: <role>-<slice>` (e.g. `auth-explorer`) is denied by the dispatch
tripwire: only a named sibling appears on the sibling roster, and the roster is
what makes the channel below work. One exception: with
`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` the name requirement is lifted — in
teams mode a named dispatch from the main conversation launches as a teammate
(inherits the lead's effort, runs in the lead's cwd) instead of a scoped
subagent, so atlas workers must stay nameless to keep their definition's
effort/model tier and guardrails.

- Siblings message each other, not just the lead. Before touching a file a
  sibling may own, or when blocked on a sibling's output, `SendMessage` that
  sibling by roster name - one exchange, then move on; never wait twice on the
  same sibling.
- Quick coordination goes by `SendMessage`; durable state goes on the board:
    python3 "${CLAUDE_PLUGIN_ROOT}/scripts/atlas_todo.py" note --owner <name> [--to <name|all>] [--item <id>] "<text>"
- The sibling roster is a snapshot taken when you start: a sibling spawned after
  you is not on it. Missing an expected sibling -> read `atlas_todo.py notes`
  and address it with `note --to <name>` instead.
- Touch the board only through `atlas_todo.py`. Never edit `todos.json` or
  `board/*.jsonl` directly: direct writes skip the lock and can erase a sibling's claim.
- The lead alone dispatches and declares done. Siblings report to the lead,
  never to the user, and never dispatch other subagents.

## Colony mux mode (opt-in, tmux)

`ATLAS_MUX=tmux` runs each worker as its own headless process in a window of one
tmux session `atlas-<run>`, instead of an in-process subagent. The default
(in-process named dispatch + board) is unchanged. Use it when workers must run
fully independently (separate processes, watchable panes) at their own tiers.

    python3 "${CLAUDE_PLUGIN_ROOT}/scripts/atlas_mux.py" spawn --run <id> --harness claude|omp \
        --name <Name> --agent <role> --prompt-file <brief.md> [--model M] [--effort E | --thinking T]
    python3 "${CLAUDE_PLUGIN_ROOT}/scripts/atlas_mux.py" status --run <id>
    python3 "${CLAUDE_PLUGIN_ROOT}/scripts/atlas_mux.py" kill --run <id>     # idempotent

- Tiers come from the agent definition: Claude
  `claude -p --agent atlas:<role> --model <model> --effort <effort> --permission-mode acceptEdits`;
  omp `omp -p --model=<concrete> --thinking=<thinkingLevel>` (omp has no `--agent` flag, so
  the role's body is prepended to the brief).
- Tier enforcement: `spawn` refuses (`ok:false`, exit 2, before any tmux call; the error
  names the role and the agents path searched) when the definition is missing or yields no
  model. The only override is an explicit `--model` AND the harness tier flag (`--effort`
  for claude, `--thinking` for omp); `--model` alone is still refused.
- omp model resolution: a `@role` alias in the definition's `model:` list (or in
  `--model`) is replaced by the CONCRETE selector under `modelRoles` in
  `~/.omp/agent/config.yml` (`ATLAS_MUX_OMP_CONFIG` overrides the path); the first pattern
  that resolves wins and omp receives that concrete selector. Nothing resolving = refused.
- Each worker gets `ATLAS_PROJECT_ROOT` and `ATLAS_WORKER_NAME`. `atlas_todo.note` is the
  single writer of `.atlas/.run/board/<Name>.jsonl`: run-worker posts, all addressed to
  `lead`, the exact harness argv (shlex-quoted, so model and effort are auditable) first,
  then every output line (stderr merged), then `exit <code>`, plus ` [failed: <reason>]`
  on failure. `omp -p` exits 0 on `Model "..." not found` and on HTTP 402, so output
  matching model-not-found / 402 / credit / auth patterns is recorded as `exit 1`.
  Workers post their own notes with `atlas_todo.py note --owner <Name>`.
- The lead reads everything with `atlas_todo.py notes --to lead`.
- Not Claude Code agent teams: teammates inherit the lead's effort, which would erase
  the per-role tiers.
- Test-only: `ATLAS_MUX_WORKER_CMD` / `--command-override` replaces the harness command.

## Anti-patterns

- x Pasting file bodies into the prompt when a path + symbol name suffices.
- x "Fix everything": unscoped agents wander. One domain per agent.
- x Letting an agent grade its own fix: verification is always a separate context.
- x Returning raw logs/diffs in the final message: return the distilled report; write bulky evidence to `.atlas/evidence/`.
- x Assuming a generated or downloaded file exists without reading it back - verify the path before acting on it. Use `${CLAUDE_PLUGIN_ROOT}` for plugin-internal paths.
- x Calling a deferred/MCP tool without loading its schema first (`ToolSearch` before the call); passing arrays or objects as strings causes `InputValidationError`.
- x Firing external/MCP/network calls without a timeout or retry; one transient failure should not silently kill the subagent.
