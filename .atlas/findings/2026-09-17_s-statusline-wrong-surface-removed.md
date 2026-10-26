# S-statusline-wrong-surface-removed: The ATLAS statusline segment was built on a surface that structurally could not meet the request: statusLine renders BELOW the prompt input, the user asked for the todo list ABOVE it

- id: S-statusline-wrong-surface-removed
- status: verified
- verified_by: main-agent-direct-execution
- verified_at: 2026-09-17T15:16:00+00:00

## Evidence
- User verdict: 'get rid of the ATLAS Todos in the statusline too. it's worthless garbage because i asked to have it above the prompt input.'
- Three releases chased the segment's plumbing instead of its position: 5.27.2 (model gate / CLAUDE_CODE_ENABLE_TODO_TOOLS), 6.0.1 (statusline promoted to THE plan surface), 6.0.2 (single-use-stdin capture). None questioned whether statusLine could ever render above the input.
- Removed from product source: scripts/atlas_statusline.py (128 lines) + test_atlas_statusline.py (149) deleted; _sync_statusline_shim + its call cut from hooks/session_boot.py; StatuslineContract and DocsMatchCodeContract.test_readme_statusline_snippet_captures_stdin cut from test_atlas_contract.py; README section, output-style paragraph, plugin.json description clause, ROADMAP item removed.
- Verification: repo-wide grep for atlas_statusline|ATLAS_STATUSLINE|_sync_statusline_shim across plugins/ docs/ .claude-plugin/ (excluding CHANGELOG history and .atlas telemetry) returns zero matches; test_atlas_contract.py 83 passed / 3 skipped / 62 subtests, zero failures.
- User wiring (explicitly requested): the trailing 'printf "\n"; printf '%s' "$input" | python3 $HOME/.atlas/atlas_statusline.py' segment removed from ~/.claude/settings.json statusLine; backup at settings.json.bak-pre-atlas-statusline-removal; live render now prints only the project line and the context-mode line, exit 0.
- Versions: plugin.json 6.3.0 -> 6.4.0, marketplace.json 3.20.0 -> 3.21.0 with atlas pin 6.3.0 -> 6.4.0 (the pin was missed by both implementers; neither owned that file).

## Reproduction
grep -rn 'atlas_statusline' plugins docs .claude-plugin | grep -v CHANGELOG

## Proposed fix
No replacement above-the-input surface ships in 6.4.0. The durable board (.atlas/.run/todos.json, atlas_todo.py, todo_capture.py, dashboard Work tab) is unchanged and remains the plan record. Any future above-the-input rendering must be proven to render above the input BEFORE it is documented as a plan surface.

## Doc refs
- plugins/atlas/CHANGELOG.md
- docs/CHANGELOG.md
- docs/ROADMAP.md

## History
- no earlier verdicts
