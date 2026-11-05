# Atlas inventory (2026-11-05, Atlas 17.1.0)

Every function, method, class, constant, type and interface in `plugins/atlas`, plus the hooks, skills, agents and mod files, with the test files that name each one.

Regenerate the page and the full per-symbol JSON (about 6.7 MB, not committed):

```sh
cd plugins/atlas
python3 scripts/atlas_inventory.py --root . --tests --json /tmp/atlas-inventory.json --markdown /tmp/atlas-inventory.md
```

A symbol "not named by a test" has no test file that mentions it by name. That is a reference check, not coverage: the mutation audit (`2026-11-05_atlas-mutation.md`) measures whether the tests catch faults.

| | count |
|---|---|
| Python source files | 124 |
| TS/JS source files | 420 |
| Python test files | 156 |
| TS/JS test files | 256 |
| class | 91 |
| const | 3139 |
| function | 6908 |
| interface | 438 |
| method | 614 |
| type | 928 |

## Components

- Claude Code hook entries: 14; Codex hook entries: 14
- Skills: 40 (3 manual)
- Agents: 11; output styles: 1
- Mod files (Claude Code): 49; omp extension files: 33

| event | matcher | command |
|---|---|---|
| SessionStart | `*` | `python3 -S "${CLAUDE_PLUGIN_ROOT}/hooks/session_boot.py"` |
| SessionStart | `*` | `python3 -S "${CLAUDE_PLUGIN_ROOT}/scripts/atlas_doctor.py" --hook` |
| UserPromptSubmit | `*` | `python3 -S "${CLAUDE_PLUGIN_ROOT}/hooks/prompt_optimizer.py"` |
| PreToolUse | `*` | `python3 -S "${CLAUDE_PLUGIN_ROOT}/hooks/event_dispatch.py" PreToolUse` |
| PreToolUse | `Bash` | `python3 -S "${CLAUDE_PLUGIN_ROOT}/hooks/fallow_gate.py"` |
| PostToolUse | `TodoWrite|TaskCreate|TaskUpdate|Agent|Task|Bash|Edit|Write|MultiEdit|NotebookEdit|Read|read|mcp__.*ctx_read|Grep|Glob|Skill|mcp__.*` | `python3 -S "${CLAUDE_PLUGIN_ROOT}/hooks/event_dispatch.py" PostToolUse` |
| PostToolUse | `Edit|Write|MultiEdit|NotebookEdit` | `python3 -S "${CLAUDE_PLUGIN_ROOT}/hooks/format_after_edit.py"` |
| Stop | `*` | `python3 -S "${CLAUDE_PLUGIN_ROOT}/hooks/completion_gate.py"` |
| Stop | `*` | `python3 -S "${CLAUDE_PLUGIN_ROOT}/hooks/stop_tail.py"` |
| SubagentStart | `*` | `python3 -S "${CLAUDE_PLUGIN_ROOT}/hooks/dispatch_tripwire.py"` |
| SubagentStop | `*` | `python3 -S "${CLAUDE_PLUGIN_ROOT}/hooks/ingest_session.py"` |
| SubagentStop | `*` | `python3 -S "${CLAUDE_PLUGIN_ROOT}/hooks/worker_report_gate.py"` |
| SessionEnd | `*` | `python3 -S "${CLAUDE_PLUGIN_ROOT}/hooks/ingest_session.py"` |
| PreCompact | `*` | `python3 -S "${CLAUDE_PLUGIN_ROOT}/hooks/ingest_session.py"` |

| skill | manual | lines |
|---|---|---|
| atlas-audit |  | 140 |
| atlas-autopilot |  | 77 |
| atlas-bakeoff |  | 91 |
| atlas-brainstorm |  | 105 |
| atlas-compound |  | 120 |
| atlas-crew | yes | 21 |
| atlas-db-audit |  | 75 |
| atlas-debug |  | 53 |
| atlas-doctor |  | 212 |
| atlas-dogfood |  | 85 |
| atlas-explain |  | 66 |
| atlas-frontend |  | 77 |
| atlas-gitignore |  | 57 |
| atlas-handoff |  | 81 |
| atlas-harden |  | 53 |
| atlas-loop |  | 82 |
| atlas-optimize |  | 110 |
| atlas-orchestrate |  | 146 |
| atlas-plan |  | 89 |
| atlas-prompt |  | 116 |
| atlas-proof |  | 84 |
| atlas-prototype |  | 79 |
| atlas-pulse |  | 83 |
| atlas-readme |  | 62 |
| atlas-refactor |  | 53 |
| atlas-resolve-pr-feedback |  | 54 |
| atlas-review |  | 136 |
| atlas-run-watch |  | 100 |
| atlas-security |  | 65 |
| atlas-setup | yes | 199 |
| atlas-ship |  | 97 |
| atlas-status |  | 38 |
| atlas-sweep |  | 89 |
| atlas-test-xcode |  | 99 |
| atlas-testing |  | 129 |
| atlas-tui | yes | 102 |
| atlas-ux-test |  | 202 |
| atlas-validate |  | 107 |
| atlas-wiki |  | 212 |
| atlas-worktree |  | 184 |

## Symbols by area

Vendored areas (upstream code with its own tests) are marked and left out of the totals below.

| area | files | functions | methods | classes | other | not named by a test |
|---|---|---|---|---|---|---|
| .claude-plugin | 3 | 3 | 0 | 0 | 654 | 2 |
| colony/herdr-web-ui/public (vendored) | 1 | 8 | 0 | 0 | 4 | 4 |
| colony/herdr-web-ui/scripts (vendored) | 82 | 458 | 52 | 7 | 466 | 203 |
| colony/herdr-web-ui/server (vendored) | 70 | 712 | 223 | 27 | 505 | 395 |
| colony/herdr-web-ui/shared (vendored) | 10 | 13 | 0 | 0 | 125 | 4 |
| colony/herdr-web-ui/src (vendored) | 118 | 801 | 55 | 7 | 455 | 421 |
| colony/herdr-web-ui/vite.config.ts (vendored) | 1 | 0 | 1 | 0 | 3 | 1 |
| contracts | 5 | 2 | 0 | 0 | 6 | 1 |
| hooks | 26 | 452 | 6 | 6 | 226 | 183 |
| mod | 50 | 662 | 13 | 2 | 387 | 383 |
| omp | 33 | 536 | 15 | 0 | 387 | 307 |
| scripts | 78 | 2283 | 131 | 35 | 981 | 1120 |
| scripts/dashboard_ui | 42 | 832 | 91 | 3 | 201 | 557 |
| scripts/scorecard | 8 | 77 | 27 | 4 | 33 | 47 |
| skills | 5 | 69 | 0 | 0 | 49 | 50 |
| types | 1 | 0 | 0 | 0 | 23 | 0 |

Atlas-owned functions and methods that no test file names: 2650 of 5199. This is a reference check only; the mutation scores measure whether tests catch faults.

The full per-symbol list (file, line span, kind, naming tests) is in the JSON the command above writes.
