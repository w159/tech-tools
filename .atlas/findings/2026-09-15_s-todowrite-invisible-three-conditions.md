# S-todowrite-invisible-three-conditions: CLAUDE_CODE_ENABLE_TODO_TOOLS clears only one of three conditions that hide the native todo widget

- id: S-todowrite-invisible-three-conditions
- status: verified
- verified_by: atlas-orchestrator
- verified_at: 2026-09-15T12:27:11+00:00

## Evidence
- ~/.claude/settings.json env had CLAUDE_CODE_ENABLE_TODO_TOOLS=true AND ENABLE_TOOL_SEARCH=true; the user reported the todo list still never appeared
- TodoWrite was listed as a deferred tool in the live session and required ToolSearch('select:TodoWrite') before it could be called: present, not dropped, so the 5.27.2 'gated model families drop it' framing is insufficient rather than wrong
- After loading and calling TodoWrite, the user confirmed via AskUserQuestion that no checklist appeared: the widget draws inline with the tool call and focus mode suppresses tool calls
- Statusline segment verified against the real board: `python3 plugins/atlas/scripts/atlas_statusline.py <<< '{"cwd":"/Users/jerry/.claude","session_id":"055193b9-..."}'` printed the header plus one line per item
- Suites after the change: test_atlas_contract 86 OK, test_atlas_db 76 OK, test_atlas_statusline 9 OK

## Reproduction
Set ENABLE_TOOL_SEARCH=true with focus mode on; TodoWrite appears only in the deferred list, and calling it renders nothing in the transcript.

## Proposed fix
Docstring/README/output-style state all three conditions; the output style makes ToolSearch('select:TodoWrite') the first check and forbids treating a TodoWrite call as user-visible communication.

## Doc refs
- plugins/atlas/CHANGELOG.md#601---2026-09-15
- docs/CHANGELOG.md#601---2026-09-15

## History
- no earlier verdicts
