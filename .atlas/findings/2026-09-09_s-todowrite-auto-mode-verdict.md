# S-todowrite-auto-mode-verdict: Docs verdict: defaultMode auto does not remove TodoWrite; checklist tools are model-gated since v2.1.233 (Opus 4.8/Sonnet 5/Fable 5/Mythos 5+), restorable via CLAUDE_CODE_ENABLE_TODO_TOOLS=1 / --allowedTools / --tools

- id: S-todowrite-auto-mode-verdict
- status: verified
- verified_by: guide-agent
- verified_at: 2026-09-09T14:03:09+00:00

## Evidence
- Q1 NO: permission-modes doc defines modes as controlling which actions run without asking; auto = 'Everything, with background safety checks' via a classifier. No doc ties tool availability to a permission mode; the only mode that changes a tool list is plan (ExitPlanMode, sub-agents doc)
- Q1 actual mechanism: tools-reference 'Task tool availability' - in v2.1.233+ TodoWrite/TaskCreate/TaskGet/TaskUpdate/TaskList are not provided on Opus 4.8, Sonnet 5, Fable 5, Mythos 5 or later 'unless you opt in'; also TodoWrite deprecated since v2.1.142 in favor of the Task tools
- Q2 YES: CLAUDE_CODE_ENABLE_TODO_TOOLS=1 env var, naming a tool in --allowedTools, or listing tools in --tools restores them on any model; CLAUDE_CODE_ENABLE_TASKS=0 re-enables legacy TodoWrite; Agent SDK allowedTools/tools options equivalent; background sessions and Claude Code on the web always provide them
- Q3: interactive-mode 'Task list' section documents Ctrl+T toggle showing up to five tasks, empty on the listed models; no doc describes a prompt-pinned scrolling widget and no documented setting customizes or brands its rendering (customizable UI per docs: statusLine, subagentStatusLine, footerLinksRegexes, keybindings, /tui, /focus)
- caveat: 'defaultMode: auto' only takes effect from user or managed settings or --permission-mode; it is ignored in project/local settings (settings + permission-modes docs)
- changelog (main, fetched 2026-09-09): zero entries name TodoWrite or todo-list UI placement

## Reproduction
none recorded

## Proposed fix
none recorded

## Doc refs
- https://code.claude.com/docs/en/tools-reference
- https://code.claude.com/docs/en/permission-modes
- https://code.claude.com/docs/en/interactive-mode
- https://code.claude.com/docs/en/sub-agents
- https://code.claude.com/docs/en/settings
- https://code.claude.com/docs/en/agent-sdk/todo-tracking
- https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md

## History
- no earlier verdicts
