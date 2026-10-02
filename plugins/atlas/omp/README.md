# Atlas enforcement for omp

- In projects with a `docs/` directory in cwd or an ancestor, native `grep` and `glob` are blocked in main and subagent sessions only when a replacement is callable in THIS session, decided per call from `pi.getActiveTools()`: a bare `ctx_search`/`ctx_glob` tool is named directly; otherwise a live lean-ctx MCP device (`xd://mcp__lean_ctx_ctx_search` / `_ctx_glob`, which needs the `write` tool). The lean-ctx binary on PATH or a configured-but-inactive server never arms the deny; with nothing reachable the call is allowed with a one-time nudge, and unknown availability allows silently.
- Native `read` and `bash` stay allowed, with one nudge per tool per session naming the reachable route (silent when none is reachable): `ctx_read` for exploration (native Read before Edit remains fine), `ctx_shell` / context-mode `ctx_execute` for output over roughly 20 lines (native Bash remains fine for mutations and short output).
- Main-thread `edit`/`write` calls outside `docs/`, `.atlas/`, and `*.md`, excluding internal URIs, require a main-thread `task` dispatch. `session_stop` returns a real `{ decision: "block", reason }` refusal once per session, asking the orchestrator to dispatch the code change to a subagent and verify. The next stop is allowed; this is not a persistent refusal and cannot loop. Subagents are exempt. Tracking is of tool calls, not git changes or shell/eval mutations.
- Atlas-bound task dispatches that omit per-item `name` get a one-time `additionalContext` hint telling the lead to name items; a task item's `name` doubles as its spawn handle and its sibling address (`write agent://<name>`). Non-blocking; omp auto-names omitted items.
- The extension factory sets `CLAUDE_PLUGIN_ROOT` to the atlas plugin root (resolved from the module's own location, only when `scripts/atlas_todo.py` exists there) if and only if the variable is unset or empty. omp substitutes that placeholder only during Claude-plugin discovery, so it is unset for omp-native agents; with the factory default, workers can run `python3 "${CLAUDE_PLUGIN_ROOT}/scripts/atlas_todo.py" ...` from bash. A non-empty pre-existing value is never overwritten.
- Board mirror: every successful main-thread `todo` tool result in a docs-scoped project mirrors the lead's full plan into `<project>/.atlas/.run/todos.json` by spawning `python3 <plugin-root>/scripts/atlas_todo.py set --root <project> --session <omp-session-id> '<JSON array of {content,status}>'`. omp's `todo` tool is never mirrored by omp itself (unlike Claude Code's TodoWrite), so this is what gives omp workers claimable board items. Statuses outside the board vocabulary (`blocked`, `abandoned`) normalize to `pending`; the spawn is detached and fire-and-forget, and any failure (including a missing session id) fails open without touching the session.
- Output style: `omp/style.ts` appends `output-styles/atlas-orchestrator.md` (frontmatter stripped, Claude tool names translated via `contracts/tool-names.json`) to the MAIN session's system prompt from `before_agent_start`; subagents get nothing, as in Claude Code. Idempotent on handler re-entry. `ATLAS_STYLE=off` disables it.
- Tool mandates (`omp/mandates.ts`, text in `contracts/mandates.json`): a "Recall first" system-prompt line naming the live claude-mem search device (only when one is callable), and a one-time `additionalContext` nudge to run ponytail-review on the staged diff before a main-thread `git commit` (only when `ponytail-review` is listed in the session's skills). `ATLAS_MANDATES=off` disables both.
- Hook bridge (`omp/hook-bridge.ts`): runs the Claude Code hooks marked bridgeable in `contracts/hook-bridge.json` straight from `hooks/hooks.json` — SessionStart on the first main prompt (its context is appended to every main prompt), UserPromptSubmit on each main prompt, PreToolUse on `tool_call` (a deny blocks the call), PostToolUse on `tool_result`. Hooks run via `/bin/sh` with `CLAUDE_PLUGIN_ROOT`, `ATLAS_HARNESS=omp`, `ATLAS_MANDATES=off`. Failures allow. `ATLAS_HOOK_BRIDGE=off` disables it.
- Worker output budget (`omp/workers.ts`): subagent provider payloads have their output-token field (`max_tokens`, `max_completion_tokens`, `max_output_tokens`, ollama `options.num_predict`) lowered to `ATLAS_WORKER_MAX_TOKENS` (default 32000). Never raised; payloads whose Anthropic thinking budget would exceed the cap are left alone.
- Advisor gate (`omp/advisor.ts`): advisor notes of severity `concern`/`blocker` become board items (`advisor[<severity>]: ...`); `session_stop` blocks up to 3 times while any is open. Close each with `atlas_todo.py complete --id <id> --evidence ...`. `ATLAS_ADVISOR_GATE=off`.
- Recall gate (`omp/mandates.ts`): when a claude-mem search device is callable, the first main-thread tool call that is not a claude-mem call (or `todo`) is blocked on every attempt until a real claude-mem call happens.
- Exploration-only `bash` (cat/grep/find/ls/... with no writes) is blocked toward the matching lean-ctx tool when a shell replacement is reachable; every `bash` runs through `lean-ctx -c` when the binary resolves and a lean-ctx route is active (`omp/shell-route.ts`, `ATLAS_LEAN_SHELL=off`).
- Delegation gate also counts code written through the shell: `omp/delegation.ts` snapshots dirty non-docs paths (git status + content hash) at session start and diffs them at stop.
- Child processes go through `omp/proc.ts` (temp-file stdio), which works under every `bun test` invocation form on hosts where piped child stdio breaks.
- Native-tool kinds, replacements, and the delegation exemption come from `contracts/native-tools.json` via `omp/contracts.ts`, shared with the Python hooks; an unreadable contract allows everything.
- `ATLAS_GATE=off` disables the Stop-time delegation check. `ATLAS_TRIPWIRE_HARD=off` allows grep/glob; Read/Bash nudges remain. Internal errors fail open. Outside docs-scoped projects all checks are silent.

## Colony agents (omp-native, generated)

`omp/agents/*.md` are GENERATED by `gen-agents.ts` from the Claude-format sources in `agents/` — never edit them by hand; re-run:

```sh
bun plugins/atlas/omp/gen-agents.ts   # idempotent; commit the output
```

Why generated copies exist: omp discards the frontmatter `model` of Claude-dialect plugin agents (a package with `.claude-plugin/plugin.json` is Claude-format, `pluginUsesClaudeModelDialect`), so the `agents/` sources run model-less on omp. omp instead scans `<extension-root>/agents` for extension packages and keeps `model` + `thinkingLevel` there; extension-package agents are merged first-wins by exact name and precede Claude plugin agents, so these generated copies override the model-less ones (and bundled agents) of the same names.

The generated frontmatter adds what omp understands and Claude dialect does not:

- `thinkingLevel` — user-approved map: `off` for explorer, docs-auditor, docs-curator, schema-inventory, naming-glossary-audit; `low` for implementer, planner, db-prober, ui-runtime-tester; `medium` for verifier, completeness-critic, rls-privilege-audit.
- `model` — ordered list: `["@atlas-worker", "@smol"]` for off/low agents, `["@atlas-verifier", "@default", "@smol"]` for medium agents. Role aliases resolve through `modelRoles.<role>`; an unconfigured custom role stays a raw pattern that matches no model (empirically the spawned subagent fails with "No model selected" — there is no automatic parent-model fallback), so each list carries built-in fallback aliases that resolve with no user configuration: `@smol` (omp's cheap role) for workers; `@default` (omp's `modelRoles.default` — the session's main model) for verifiers, then `@smol` as a last resort if `modelRoles.default` is unset, because a cheap verifier beats one that fails to spawn.
- `spawns: "none"` — lead-only dispatch: atlas workers may not spawn subagents.

Point `modelRoles.atlas-worker` / `modelRoles.atlas-verifier` at real models (EXAMPLE — not applied by anything here):

```yaml
# ~/.omp/agent/config.yml
modelRoles:
  atlas-worker: openai/gpt-5-mini:low
  atlas-verifier: openai/gpt-5.2:medium
  default: anthropic/claude-sonnet-5-5:medium   # @default fallback for verifier-tier agents (else @smol)
```

Colony messaging: dispatch atlas agents with named task items (unique, CamelCase, <= 32 chars); a worker addresses its sibling via `write agent://<name>`. Shared worker notes go through the atlas board notes CLI — `${CLAUDE_PLUGIN_ROOT}` is set by the extension factory (see above), so these are runnable as-is from any omp worker's bash: `python3 "${CLAUDE_PLUGIN_ROOT}/scripts/atlas_todo.py" note --owner <name> [--to <name|all>] [--item <id>] "<text>"` and `... notes [--to <name>] [--since <ts>]`.

## Install (not performed automatically)

OMP marketplace installations load this module from the atlas root `package.json` → `omp.extensions: ["./omp/index.ts"]`. A Claude Code installation alone does not discover this nested directory. See [Marketplace concepts](omp://marketplace.md) and [Extension Loading](omp://extension-loading.md) §§ Installed plugin extension entries / Explicitly configured paths.

For an existing source checkout, load the extension package by DIRECTORY so the sibling `agents/` surface is discovered too (file entrypoints contribute zero sub-discovery surface):

```sh
omp --extension /absolute/path/to/tech-tools/plugins/atlas/omp
```

Or add this entry to the existing `extensions` list in the active profile's agent `config.yml` (default `~/.omp/agent/config.yml`), then restart omp:

```yaml
extensions:
  - /absolute/path/to/tech-tools/plugins/atlas/omp
```

Do not replace existing extension entries. Named profiles use their own agent config. No package dependencies or installation into `~/.omp` are required by the source itself.

Note: when atlas is installed through the omp marketplace (Claude-format root), the generated `omp/agents/` directory is not part of the marketplace agent surface (marketplace roots load agents only via the Claude path); load the package directory as above to get the colony workers.

## Verification

```sh
bun test plugins/atlas/omp/index.test.ts plugins/atlas/omp/gen-agents.test.ts
```

The tests drive the documented handlers with fake events and temporary docs-scoped projects. Runtime contracts: [Extensions](omp://extensions.md), sections Handler context (`ctx.agent.kind`), Prompt and turn lifecycle (`session_stop`, a true blocking primitive rather than notification-only `agent_end`), and Tool lifecycle (`tool_call`, `additionalContext`).
