# Atlas enforcement for omp

- In projects with a `docs/` directory in cwd or an ancestor, native `grep` and `glob` are blocked in main and subagent sessions when lean-ctx is available (binary on PATH or MCP tool provenance naming a lean-ctx server). Replacements are `ctx_search` and `ctx_glob`, called by writing JSON to `xd://mcp__lean_ctx_ctx_search` and `xd://mcp__lean_ctx_ctx_glob`.
- Native `read` and `bash` stay allowed, with one nudge per tool per session: `ctx_read` for exploration (native Read before Edit remains fine), `ctx_shell` / context-mode `ctx_execute` for output over roughly 20 lines (native Bash remains fine for mutations and short output).
- Main-thread `edit`/`write` calls outside `docs/`, `.atlas/`, and `*.md`, excluding internal URIs, require a main-thread `task` dispatch. `session_stop` returns a real `{ decision: "block", reason }` refusal once per session, asking the orchestrator to dispatch the code change to a subagent and verify. The next stop is allowed; this is not a persistent refusal and cannot loop. Subagents are exempt. Tracking is of tool calls, not git changes or shell/eval mutations.
- `ATLAS_GATE=off` disables the Stop-time delegation check. `ATLAS_TRIPWIRE_HARD=off` allows grep/glob; Read/Bash nudges remain. Internal errors fail open. Outside docs-scoped projects all checks are silent.

## Install (not performed automatically)

OMP marketplace installations load this module from the atlas root `package.json` → `omp.extensions: ["./omp/index.ts"]`. A Claude Code installation alone does not discover this nested directory. See [Marketplace concepts](omp://marketplace.md) and [Extension Loading](omp://extension-loading.md) §§ Installed plugin extension entries / Explicitly configured paths.

For an existing source checkout, load once:

```sh
omp --extension /absolute/path/to/tech-tools/plugins/atlas/omp/index.ts
```

Or add this entry to the existing `extensions` list in the active profile's agent `config.yml` (default `~/.omp/agent/config.yml`), then restart omp:

```yaml
extensions:
  - /absolute/path/to/tech-tools/plugins/atlas/omp/index.ts
```

Do not replace existing extension entries. Named profiles use their own agent config. No package dependencies or installation into `~/.omp` are required by the source itself.

## Verification

```sh
bun test plugins/atlas/omp/index.test.ts
```

The tests drive the documented handlers with fake events and temporary docs-scoped projects. Runtime contracts: [Extensions](omp://extensions.md), sections Handler context (`ctx.agent.kind`), Prompt and turn lifecycle (`session_stop`, a true blocking primitive rather than notification-only `agent_end`), and Tool lifecycle (`tool_call`, `additionalContext`).
