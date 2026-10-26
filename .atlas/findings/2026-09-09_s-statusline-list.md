# S-statusline-list: ATLAS statusline segment rebuilt as a real todo list: header + one line per item (5.27.2)

- id: S-statusline-list
- status: verified
- verified_by: atlas-orchestrator
- verified_at: 2026-09-09T12:44:56+00:00

## Evidence
- user verdict: the 5.27.0 one-line counter was NOT a todo list and looked bad; renderer rewritten
- test_atlas_statusline.py rewritten to the list contract: 9 tests OK
- live render: ESC[1;36m[0m-escape ATLAS Todos ESC[1;90m0/1 done, item line ESC[1;36m  ❯ prove ATLAS statusline renders at the prompt
- shim at ~/.atlas/atlas_statusline.py updated in place

## Reproduction
echo '{"session_id":"live-check","cwd":"<project>"}' | bash ~/.claude/statusline-command.sh

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
