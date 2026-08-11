# Serena never activated a project: a required config key, a missing launch arg

**Date:** 2026-08-11
**Status:** verified
**Files:** `~/.mcp.json`, `.serena/project.yml`, `plugins/atlas/agents/*.md` (all 12),
`skills/atlas-orchestrate/references/{capability-routing,lsp-and-symbols,subagent-kit}.md`,
`hooks/test_atlas_contract.py`

## Symptom

The serena MCP server appeared in the status bar but was always empty. Logs showed a
`tools/list` handshake and then nothing: no project, no tool calls. 5.7.0 had already fixed
the "tools named in prose are not callable" defect, so the agents named serena correctly and
still nothing happened.

## Root cause: two independent config defects, in series

**D1 - `.serena/project.yml` is missing a required key.** serena 1.6 made `languages:` a
field without a default:

```
serena/config/serena_config.py
  ProjectConfig.FIELDS_WITHOUT_DEFAULTS = {"project_name", "languages"}
  _from_dict():569 ->  for language_str in data["languages"]:
```

Every `.serena/project.yml` on this machine predates that change and carries only
`language_servers:`. Result, reproduced with a full traceback via
`serena project health-check`:

```
ERROR serena.config.serena_config:from_config_file:1064 - Failed to load project
configuration for <path>: 'languages'. This project will be skipped.
...
KeyError: 'languages'
```

The project is skipped at load, so `activate_project` fails and every symbol tool returns
`No active project`.

**D2 - the server was launched with no project.** `~/.mcp.json:57` read
`["start-mcp-server", "--context", "claude-code"]`. The `claude-code` context is
`single_project: true`, which only minimizes the toolset *if a project is supplied at
startup*. Without one, serena comes up idle. A different entry in `~/.claude.json` did carry
`--project-from-cwd`, which is why this looked configured; `~/.mcp.json` is the file the
session actually reads (`.claude/settings.local.json` lists serena under
`enabledMcpjsonServers`).

## Consequence in the telemetry

Across all recorded transcripts:

| server | calls | errors | rate |
|---|---|---|---|
| context-mode | 5510 | 252 | 4.6% |
| lean-ctx | 339 | 23 | 6.8% |
| serena | 207 | 60 | **29.0%** |

Zero serena calls ever in this repo. The 29% is the wiring, not the tool. Corroboration:
all 7 recorded `search_for_pattern` calls failed, because the `claude-code` context
*excludes* that tool along with `read_file`, `create_text_file`, `execute_shell_command`,
`find_file` and `list_dir`, precisely so serena never duplicates Claude Code's own tools.

## The determination that was wrong on the first pass

Initial reading was "native `LSP` subsumes serena, remove it." That was wrong, and the
correction matters more than the fix:

- `LSP` requires `(filePath, line, character)` and returns **locations**. `find_symbol` takes
  a **name** and returns the **body**. Reaching a position for `LSP` means Read or Grep
  first, which is the exact context cost serena exists to remove.
- serena's edit tools have no native equivalent at all: `replace_symbol_body`,
  `insert_before/after_symbol`, `rename_symbol` and `safe_delete_symbol` (reference-aware and
  atomic), `replace_content`, and `replace_in_files` (one edit across many files with a
  `dry_run` diff and per-occurrence ids).
- serena never competed with lean-ctx or context-mode. The `claude-code` context removes the
  overlap by construction.

Evaluating a tool from its tool list instead of its manual and context definition is what
produced the wrong call.

## Fixes applied

| # | Fix | Verification |
|---|---|---|
| D1 | `languages: ["python"]` added to this repo's `.serena/project.yml` | `serena project health-check` -> "✅ Health check passed - All tools working correctly"; `activate_project` -> "Created and activated ... Programming languages: python" |
| D2 | `--project-from-cwd` added to `~/.mcp.json:57` | stdio probe: "Auto-detected project root: .../tech-tools", "Activating tech-tools", pyright up in 1.9s, 22 tools exposed, `SingleProjectExclusions excluded 2 tools: activate_project, get_current_config` |
| D3 | dispatch brief now carries a `NON-INTERACTIVE` clause | `test_dispatch_brief_overrides_serena_interactive_mode` |
| D4 | all 12 agents load the symbol toolset in one up-front `ToolSearch` | `test_agents_load_symbol_toolset_up_front` |

**D3 detail.** serena's global `default_modes` are `interactive, editing`. The `interactive`
mode prompt tells the model to "engage with the user throughout the task, asking for
clarification" - an instruction a subagent cannot act on, and the same failure shape as the
nudge.py hijack recorded on 2026-08-06. serena 1.6.1's claude-code context exposes no
`switch_modes` tool, so the mode cannot be changed per dispatch. The lever that does exist is
serena's own documented escape hatch: interactive mode applies "unless the user instructs you
to proceed without asking questions." The dispatch brief now says exactly that. The user's
global `default_modes` was deliberately left alone, since `interactive` is correct for their
own sessions.

## Not done, by decision

The `languages:` key is missing from roughly 40 other `.serena/project.yml` files across the
machine. The user declined the sweep. Consequence: serena still fails in those repos until
each yml gets the key. Note that a repo with **no** `.serena/project.yml` is fine -
`--project-from-cwd` autogenerates one from the current template, which includes `languages:`.
Only stale existing files fail. The agents now recognize the error and report it in one line
instead of retrying every tool.

## Reusable rule

A tool that is wired, named, and still unused is a configuration failure until proven a
capability failure. Check that the server has state (an active project, an index, a session)
before concluding the tool does not earn its place - and read the server's manual and context
definition, not just its tool list.
