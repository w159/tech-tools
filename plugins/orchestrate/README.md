# orchestrate

A self-contained Claude Code plugin that turns any coding agent into a disciplined
**multi-agent orchestrator** — and turns vague prompts into precise, environment-aware
instructions for it to execute.

Three things ship together:

| Piece | What it is |
| --- | --- |
| **`orchestrate` skill** | The orchestrator playbook: decompose a task, route every code edit to a subagent, demand execution evidence, verify with a second agent, and protect the main context window. Triggers on whole-codebase build/fix/audit/refactor/investigate work. |
| **`/orc-prompt` command** | On-demand prompt optimizer for agentic coding. Discovers the tools/skills/subagents *actually* loaded this session and rewrites a "noob" prompt into a structured `# Optimized Prompt` block — methodology, mandatory verification gates, a subagent plan, and acceptance criteria. No external dependency. |
| **`prompt-optimizer` skill + Modelfile** | The passive path: a chat-oriented prompt rewriter skill, plus the ollama `Modelfile` that powers the optional automatic `UserPromptSubmit` hook. |

## Layout

```
orchestrate/
├── .claude-plugin/plugin.json     # manifest
├── agents/                        # 5 subagents, auto-registered on install
│   ├── orc-explorer.md            #   read-only codebase mapping
│   ├── orc-implementer.md         #   bounded, verified code edits
│   ├── orc-verifier.md            #   adversarial confirm/refute
│   ├── orc-db-prober.md           #   read-only schema/RLS/index inspection
│   └── orc-ui-runtime-tester.md   #   live browser/runtime behavior
├── commands/orc-prompt.md         # the /orc-prompt command
└── skills/
    ├── orchestrate/               # SKILL.md + references/ + hooks/ + scripts/
    └── prompt-optimizer/          # SKILL.md + Modelfile
```

## Install

**As a plugin (Claude Code):** place this directory under your plugins root (or install
from the marketplace once published). The skills, `/orc-prompt` command, and the five
`orc-*` subagents are discovered automatically.

**As a bare skill (any agent):** copy `skills/orchestrate/` into the agent's skills
directory. It is internally self-contained — `scripts/install_hooks.py` finds its hooks
via a path relative to itself, and the skill dispatches subagents by name. Note that the
`orc-*` subagents live at the plugin root, so a bare-skill copy won't auto-register them;
copy `agents/` alongside if you need them.

## Hooks (opt-in, fail-safe)

The orchestrate skill ships four stdlib-only hooks. Each passes through silently on any
error, so they can never block a session. They are **not** auto-loaded — install on demand:

```bash
# from the skill directory:
python3 skills/orchestrate/scripts/install_hooks.py --list      # show current coverage
python3 skills/orchestrate/scripts/install_hooks.py             # dry-run plan
python3 skills/orchestrate/scripts/install_hooks.py --apply     # install default set (optimizer, format, guard)
python3 skills/orchestrate/scripts/install_hooks.py --select completion-gate --apply   # opt into the Stop gate
```

| Hook | Event | Purpose |
| --- | --- | --- |
| `prompt_optimizer.py` | `UserPromptSubmit` | rewrites the prompt through a local model before the agent sees it (trigger-gated; augments, never replaces) |
| `format_after_edit.py` | `PostToolUse` (Edit/Write) | runs the formatter after edits |
| `bash_guard.py` | `PreToolUse` (Bash) | nudges away from footgun shell commands |
| `completion_gate.py` | `Stop` | **opt-in** — blocks a premature "done" until verification evidence exists |

### Optional: the ollama-backed optimizer

`prompt_optimizer.py` reaches a local model over the ollama HTTP API and falls back to the
`ollama run` CLI. Reproduce the model from the bundled Modelfile:

```bash
ollama create prompt-optimizer -f skills/prompt-optimizer/Modelfile
```

It is not required — the hook passes through if no model is reachable, and `/orc-prompt`
does the same optimization with no external service at all. Override the backend with
`ORCHESTRATE_OPTIMIZE_CMD`, `ORCHESTRATE_OPTIMIZER_MODEL`, or `ORCHESTRATE_OLLAMA_URL`
(see `skills/orchestrate/references/hooks-automation.md`).

## Recommended MCP servers

The orchestrator is sharpest with a docs resolver (**context7**), a symbol/LSP server
(**serena**), and a memory server (**claude-mem**) available — but it degrades gracefully
and references only the tools actually present in the session.

## License

Apache-2.0 · © w159
