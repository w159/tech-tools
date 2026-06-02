# Capability Routing

The orchestrator's job is to put the *right* capability on each task. This file maps task signals → agent type + skill + MCP tools + model. It is a default; always prefer a live-discovered better fit.

## Step 1 — Discover what is actually live (do this once per session, cheaply)

Capabilities differ per machine and project. Before routing nuanced work, note from the session's own surfaces (system reminders, `/usage`, settings) what exists:

- **Skills** available (the session lists them). **MCP servers** connected (`mcp__*` tools). **Agents** in `~/.claude/agents/` + `.claude/agents/`. **LSP / plugins** enabled (`enabledPlugins` in settings; `/plugin`).
- If a capability you want is *absent*, that itself may be the root cause or a fixable gap → `references/claude-code-tuning.md`.

Pass the chosen capabilities into each subagent's spec as directives, **and** tell the subagent to confirm/augment them for nuances you can't foresee.

## Step 2 — Route by task signal

| Task signal | Agent type | Skill(s) | MCP / tools | Model |
|---|---|---|---|---|
| Understand a codebase / map a feature | `orc-explorer`, `codebase-explorer`, `Explore` | `smart-explore`, `learn-codebase`, `graphify`, `pathfinder` | `serena`, LSP, `context-mode` | haiku |
| Plan a feature / multi-step task | `Plan` | `superpowers:brainstorming` → `make-plan` → `writing-plans` | `sequentialthinking` | opus/sonnet |
| Implement a feature / bounded change | `orc-implementer`, `frontend-developer`, `backend-architect` | `superpowers:test-driven-development`, `frontend-design`/`ui-ux-pro-max` | `context7` (mandatory), `serena`, LSP | sonnet |
| Fix a bug / regression / incident | `debugger` | `superpowers:systematic-debugging` | `serena`, `context-mode`, Sentry MCP if present | sonnet |
| Run & validate behavior (FE/BE/DB) | `orc-ui-runtime-tester`, `test-executor`, `test-engineer` | `verify`, `run`, `webapp-testing`, `python-testing-patterns` | Claude_Preview MCP, `context-mode`, curl, playwright | sonnet |
| Probe the database (read-only) | `orc-db-prober` | — | read-only `psql`, `whodb`/data-agent-kit plugin if present, `gcloud` | sonnet |
| Verify a finding / fix (adversarial) | `orc-verifier`, `secondary-expert-validator` | `superpowers:requesting-code-review` | re-run tests/queries; `codex` for a true second opinion | sonnet → opus if critical |
| Security review | `security-engineer` | `security-review`, `security-best-practices`; `backend-security-skills`/`vibeguard` plugins if present | `context7`, `serena` | opus |
| Review a diff / PR | `code-reviewer` | `code-review` (`--fix` to apply), `superpowers:requesting-code-review` | `serena`, LSP | sonnet |
| Library / framework / SDK questions | (inline or any) | `openai-docs`, `claude-api`, `microsoft-foundry` | `context7` (general), `microsoft-docs` (Azure/.NET/M365/Entra) | — |
| UI / design build or critique | `frontend-developer` | `ui-ux-pro-max`, `frontend-design`, `design:*` | `magic` MCP, Claude_Preview to verify | sonnet |
| Infra / deploy / CI | `devops-automator` | — | `gcloud`, `gcp-devkit`/`firebase-development` plugins if present | sonnet |
| Large output / logs / data crunching | (any) | — | `context-mode` (`ctx_batch_execute`/`ctx_execute`) — never raw Bash | haiku |
| "Did we solve this before?" | (you) | `mem-search` | `claude-mem`, `ctx_search` | — |
| Claude Code setup feels limiting | (you) | `agentic-tools`, `orc-audit` | read `~/.claude` settings/agents/plugins | → `claude-code-tuning.md` |

## Step 3 — Hard rules that override convenience

- **Never grep-then-read when an LSP/`serena` symbol call answers it.** For an LSP-enabled language (TS, Python via `typescript-lsp`/`pyright-lsp`, etc.), instruct subagents: "use find-references / go-to-definition, not grep + read."
- **`context7` is mandatory** before any library behavior claim or API-targeted edit. A finding that says "library X is misused" with no doc citation is `unverified`.
- **`context-mode` for anything noisy.** Bash is only for git/mkdir/rm/mv/navigation and short fixed-output observation.
- **Read-only stays read-only.** Discovery/verification/DB-probing subagents get `disallowedTools: [Write, Edit, MultiEdit, NotebookEdit]` so they cannot mutate.
- **`isolation: worktree`** on any two subagents that might edit the same files in parallel — prevents working-tree conflicts.

## Cross-surface fault localization (which layer owns the bug?)

When a symptom could live in FE, BE, or DB, dispatch a short diagnostic ladder (see `references/execution-testing.md` for the mechanics) and let the *evidence at each hop* localize it:

1. **Reproduce at the UI** (`orc-ui-runtime-tester`) — capture the failing console error + the network request/response.
2. **Confirm the backend route** — does the endpoint exist, accept that shape, return the right status + body? (`orc-implementer`/`backend-architect` hitting the route, or reading the router via `serena`.)
3. **Trace to data** (`orc-db-prober`) — does the query return what the route expects? Is it an RLS policy, a missing GRANT, a null/constraint, a missing index?
4. **Pin the owner** with the evidence chain. If no layer owns it, suspect the Claude Code setup or environment → `claude-code-tuning.md`.
