# Capability Routing

The orchestrator's job is to put the *right* capability on each task. This file maps task signals -> agent type + skill + MCP tools + model. It is a default; always prefer a live-discovered better fit.

## Step 1 - Discover what is actually live (do this once per session, cheaply)

Capabilities differ per machine and project. Before routing nuanced work, note from the session's own surfaces (system reminders, `/usage`, settings) what exists:

- **Skills** available (the session lists them). **MCP servers** connected (`mcp__*` tools). **Agents** in `~/.claude/agents/` + `.claude/agents/`. **LSP / plugins** enabled (`enabledPlugins` in settings; `/plugin`).
- If a capability you want is *absent*, that itself may be the root cause or a fixable gap -> `references/claude-code-tuning.md`.

Pass the chosen capabilities into each subagent's spec as directives, **and** tell the subagent to confirm/augment them for nuances you can't foresee.

## Step 2 - Route by task signal

| Task signal | Agent type | Skill(s) | MCP / tools | Model |
|---|---|---|---|---|
| Understand a codebase / map a feature | `atlas:explorer`, `codebase-explorer`*, `Explore`* | `smart-explore`, `learn-codebase`, `graphify`, `pathfinder` | `serena`, LSP, `context-mode` | haiku |
| Plan a feature / multi-step task | `Plan`* | `superpowers:brainstorming` -> `make-plan` -> `writing-plans` | `sequentialthinking` | opus/sonnet |
| Implement a feature / bounded change | `atlas:implementer`, `frontend-developer`*, `backend-architect`* | `superpowers:test-driven-development`, `frontend-design`/`ui-ux-pro-max` | `context7` (mandatory), `serena`, LSP | sonnet |
| Fix a bug / regression / incident | `debugger`* | `superpowers:systematic-debugging` | `serena`, `context-mode`, Sentry MCP if present | sonnet |
| Run & validate behavior (FE/BE/DB) | `atlas:ui-runtime-tester`, `test-executor`*, `test-engineer`* | `verify`, `run`, `webapp-testing`, `python-testing-patterns` | Claude_Preview MCP, `context-mode`, curl, playwright | sonnet |
| Full UI/UX test pass / persona testing / pre-release UX sweep (any app) | (orchestrator dispatches atlas-ux-test) | `atlas-ux-test` (canonical home; auto-discovers routes and fields) | Chrome DevTools MCP / Claude_Preview MCP / `browser-harness` / playwright, `context-mode` | sonnet; opus for the reporter |
| Probe the database (read-only) | `atlas:db-prober` | - | read-only `psql`, `whodb`/data-agent-kit plugin if present, `gcloud` | sonnet |
| Verify a finding / fix (adversarial) | `atlas:verifier`, `secondary-expert-validator`* | `superpowers:requesting-code-review` | re-run tests/queries; `codex` for a true second opinion | sonnet -> opus if critical |
| Security review | `security-engineer`* | `security-review`, `security-best-practices`; `backend-security-skills`/`vibeguard` plugins if present | `context7`, `serena` | opus |
| Comprehensive quality + security + OWASP audit (full codebase sweep) | (orchestrator dispatches atlas-audit) | `atlas-audit` | `serena`, `context7`, `context-mode`; no browser needed | sonnet (multi-swarm) |
| Architecture map / structural dedup / boundaries doc missing | (orchestrator dispatches atlas-audit) | `atlas-audit` | `serena`, LSP, `context-mode` | sonnet |
| Recurring or iterative task / needs a reusable loop | (orchestrator dispatches atlas-loop) | `atlas-loop` | - | sonnet |
| Vendor MCP connector setup / credentials to wire | (orchestrator dispatches atlas-setup) | `atlas-setup` | - | sonnet |
| Measure run health / self-improvement from observability data | (orchestrator dispatches atlas-audit) | `atlas-audit` | SQLite observability DB (`~/.atlas/atlas.db`) | sonnet |
| Project boot / onboarding / configure tooling for a repo | (orchestrator dispatches atlas-setup) | `atlas-setup` | `serena`, hook/config wiring | sonnet |
| Multi-stage / multi-surface orchestration (build/fix/audit/refactor spanning several subagents) | (this skill is the orchestrator itself - normally entered via its own skill trigger, not routed to from within a session) | `atlas-orchestrate` | whatever Step 1 discovers live | sonnet |
| Review a diff / PR | `code-reviewer`* | `code-review` (`--fix` to apply), `superpowers:requesting-code-review` | `serena`, LSP | sonnet |
| Library / framework / SDK questions | (inline or any) | `openai-docs`, `claude-api`, `microsoft-foundry` | `context7` (general), `microsoft-docs` (Azure/.NET/M365/Entra) | - |
| UI / design build or critique | `frontend-developer`* | `ui-ux-pro-max`, `frontend-design`, `design:*` | `magic` MCP, Claude_Preview to verify | sonnet |
| Infra / deploy / CI | `devops-automator`* | - | `gcloud`, `gcp-devkit`/`firebase-development` plugins if present | sonnet |
| Large output / logs / data crunching | (any) | - | `context-mode` (`ctx_batch_execute`/`ctx_execute`) - never raw Bash | haiku |
| "Did we solve this before?" | (you) | `mem-search` | `claude-mem`, `ctx_search` | - |
| Claude Code setup feels limiting | (you) | `atlas:explorer` | read `~/.claude` settings/agents/plugins | -> `claude-code-tuning.md` |

\* Built-in/global agent type, not shipped under `plugins/atlas/agents/` - resolved from `~/.claude/agents/`, `.claude/agents/`, or Claude Code's built-in agent types.

## Step 2b - The tool names to actually put in the prompt

A subagent that reads "use serena" will not use serena. These are **deferred MCP tools**: their
schemas are not loaded, so the name has to be concrete and the agent has to `ToolSearch` for it
first. Server prefixes vary per install (`mcp__serena__*`, `mcp__lean-ctx__*`,
`mcp__plugin_context-mode_context-mode__*`, `mcp__plugin_claude-mem_mcp-search__*`), so tell the
agent to search by keyword rather than hardcoding a prefix.

| Job | Name these tools in the prompt | Instead of |
|---|---|---|
| Orient in unfamiliar code | `ctx_compose` (lean-ctx) | a spray of `Read` calls |
| Outline a file | `get_symbols_overview` (serena), `ctx_read` `mode=signatures` | reading the whole file |
| Locate a symbol / its callers | `find_symbol`, `find_declaration`, `find_referencing_symbols` (serena) | `Grep` + `Read` |
| Edit a named function or class | `replace_symbol_body`, `insert_after_symbol` (serena) | rewriting the file |
| Confirm an edit type-checks | `get_diagnostics_for_file` (serena) | eyeballing the diff |
| Impact / callers-of-callers | `ctx_callgraph` (lean-ctx) | manual grep sweeps |
| Pattern or semantic search | `ctx_search` (lean-ctx, `action=semantic`) | `Grep` over the tree |
| Command output past ~20 lines | `ctx_batch_execute` / `ctx_execute` (context-mode) | raw `Bash` |
| Analyze a large file | `ctx_execute_file` (context-mode) | `Read` on the whole file |
| Fetch a web page | `ctx_fetch_and_index` (context-mode) | `WebFetch` |
| Library / SDK behavior | `context7` `resolve-library-id` -> `query-docs` | memory |
| Azure / .NET / M365 / Entra | `microsoft-docs` `microsoft_docs_search` -> `_fetch` | memory |
| "Did we hit this before?" | claude-mem `search` -> `timeline` -> `get_observations` | re-deriving it |

claude-mem worker-runtime arg shapes (the historical error source, see `memory-access.md`):
`timeline` takes `anchor` (int) or `query` and has **no** `limit`; `get_observations` takes `ids` as
an array of **numbers**. `observation_search` is server-beta only - use `search`.

Serena is for **code symbols**. For prose, markdown, JSON, and config, `ctx_read` / `ctx_search` are
correct and serena is not.

## Step 3 - Hard rules that override convenience

- **Never grep-then-read when an LSP/`serena` symbol call answers it.** For an LSP-enabled language (TS, Python via `typescript-lsp`/`pyright-lsp`, etc.), instruct subagents: "use find-references / go-to-definition, not grep + read."
- **`context7` is mandatory** before any library behavior claim or API-targeted edit. A finding that says "library X is misused" with no doc citation is `unverified`.
- **`context-mode` for anything noisy.** Bash is only for git/mkdir/rm/mv/navigation and short fixed-output observation.
- **Read-only stays read-only.** Discovery/verification/DB-probing subagents get `disallowedTools: [Write, Edit, MultiEdit, NotebookEdit]` so they cannot mutate.
- **`isolation: worktree`** on any two subagents that might edit the same files in parallel - prevents working-tree conflicts.

## Cross-surface fault localization (which layer owns the bug?)

When a symptom could live in FE, BE, or DB, dispatch a short diagnostic ladder (see `references/execution-testing.md` for the mechanics) and let the *evidence at each hop* localize it:

1. **Reproduce at the UI** (`atlas:ui-runtime-tester`) - capture the failing console error + the network request/response.
2. **Confirm the backend route** - does the endpoint exist, accept that shape, return the right status + body? (`atlas:implementer`/`backend-architect` hitting the route, or reading the router via `serena`.)
3. **Trace to data** (`atlas:db-prober`) - does the query return what the route expects? Is it an RLS policy, a missing GRANT, a null/constraint, a missing index?
4. **Pin the owner** with the evidence chain. If no layer owns it, suspect the Claude Code setup or environment -> `claude-code-tuning.md`.
