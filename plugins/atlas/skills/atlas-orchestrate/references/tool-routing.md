# Tool routing (context engineering)

Load when Orienting, writing a dispatch TOOLS block, debugging "why is this agent grepping", or deciding serena vs lean-ctx vs Bash.

Goal: **correct tool first, minimum tokens.** Atlas fails when agents default to Read/Grep/Bash and blow the window. This matrix is mandatory for code work.

## Hard rules

1. **One batched `ToolSearch` before any Read/Grep/Bash** on a code task (orchestrator or subagent). Paste the batch from `scripts/tool_routing.py` (`TOOLSEARCH_BATCH`) or `subagent-kit.md`.
2. **`activate_project` before serena symbols.** Path = project cwd (or codebase root). If `.serena/project.yml` is missing, run serena onboarding once (atlas-setup install), do not invent greps.
3. **Serena is for code symbols. lean-ctx is for shaped tree/file access. context-mode is for noisy command output. claude-mem is for prior sessions.** Do not swap them.
4. **Bash `grep` / `cat` / `sed` / `head` on source is a defect**, not a fallback. Serena down -> lean-ctx. lean-ctx down -> narrow native Read of a known path span, never a repo-wide Grep sweep.
5. **Do not preload every MCP schema.** Batch once; only re-search by keyword if a name did not bind. Prefer fewer tools used well over every server connected.

## Decision table

| Situation | Use | Do not use |
|---|---|---|
| First touch of a codebase / feature map | lean-ctx `ctx_compose` then serena overview on hot files | spray of `Read` |
| "Where is X defined / who calls it" | serena `find_symbol` / `find_declaration` / `find_referencing_symbols` | `Grep` + `Read` |
| File outline without body | serena `get_symbols_overview` or lean-ctx `ctx_read` `mode=signatures` | full file Read |
| Edit one function/class | serena `replace_symbol_body` / `insert_after_symbol` | rewrite whole file |
| Post-edit type/lint on a file | serena `get_diagnostics_for_file` or native LSP | eyeball only |
| Semantic / fuzzy search across tree | lean-ctx `ctx_search` (`action=semantic` when meaning matters) | repo-wide Grep |
| Prose, markdown, JSON, YAML, config | lean-ctx `ctx_read` / `ctx_search` | serena |
| Call graph / impact | lean-ctx `ctx_callgraph` when available | manual grep chains |
| Command or log output > ~20 lines | context-mode `ctx_batch_execute` / `ctx_execute` / `ctx_execute_file` | raw Bash into context |
| "Did we solve this before?" | claude-mem `search` -> `timeline` -> `get_observations` (ids as **numbers**) | re-derive from scratch |
| Library/SDK API truth | context7 (or microsoft-docs for MS) | memory |
| JS/TS dead code, dupes, health, PR gate | fallow CLI/MCP (`--format json`); commit gate is atlas `fallow_gate` | guessing unused exports |
| Want less code / cheaper session posture | ponytail plugin (session-augmentation tier) | rewriting style guides by hand |
| git / mkdir / short fixed-output shell | Bash | context-mode |

## Setup order (atlas-setup / `/atlas` install)

For any code repo, activate in this order (confirm each install with the user):

1. **claude-mem** + **context-mode** (session tier; always)
2. **ponytail** (optional session tier; less code)
3. **serena** MCP + `activate_project` on cwd; ensure `.serena/project.yml` has top-level `languages:` (session_boot heals missing key)
4. **lean-ctx** MCP (if not already provided by context-mode stack)
5. **context7** when many third-party deps
6. **fallow** CLI (+ optional fallow-mcp / fallow-skills) on JS/TS
7. Never install MCP servers that the stack cannot use this session

Discovery emits these via `discover_capabilities.py` + `capability-catalog.md`.

## Orchestrator (parent session)

- Orient: recall (claude-mem + ctx_search) -> note live MCP -> **tool-routing line** -> then plan.
- You still do not edit target code. When you must peek, use lean-ctx/serena, not Grep.
- Every `atlas:*` dispatch must include the TOOLS block (`subagent-kit.md`). The tripwire **denies** atlas dispatches that omit `ToolSearch`.
- Prefer one implementer + recorded test over a squad that re-reads the tree.

## Subagents

Agent files already require the ToolSearch batch as first action. Implementers must include surgical serena edit tools and `activate_project`. If serena returns `No active project` / `KeyError: languages` / `No such tool available`: one line in the report, switch to lean-ctx, **do not** Bash-grep.

## Minimum context checklist

- [ ] ToolSearch run once, not per tool
- [ ] serena activated for this cwd when doing symbols
- [ ] No full-file reads when overview/signatures suffice
- [ ] Noisy output via context-mode
- [ ] Final reports are distilled; bulk evidence under `.atlas/evidence/`
- [ ] Unused skills/agents disabled via `atlas_context_optimizer` (setup), not left loading forever

## Related

- `lsp-and-symbols.md` - serena vs native LSP detail
- `memory-access.md` - claude-mem worker runtime arg shapes
- `fallow-tools.md` - JS/TS fallow gate and CLI
- `subagent-kit.md` - dispatch TOOLS paste block
- `scripts/tool_routing.py` - `boot_lines()`, `scan_stack()`, `TOOLSEARCH_BATCH`
