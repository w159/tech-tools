# S-statusline: ATLAS statusline segment renders the durable todo board as a static branded line at the prompt (5.27.0)

- id: S-statusline
- status: verified
- verified_by: atlas-orchestrator
- verified_at: 2026-09-09T12:17:16+00:00

## Evidence
- python3 -m unittest discover (scripts): Ran 648 tests OK, includes 7 test_atlas_statusline cases
- hooks contract suite: Ran 86 tests OK (skipped=3), includes 3 StatuslineContract cases
- live render: /tmp/atlas-sline board -> bash ~/.claude/statusline-command.sh line 4 = ESC[1;36mATLAS ESC[0m ESC[1;90m1/3 | now: wire the ATLAS statusline | 2 left; no-board project prints nothing
- shim seeded to ~/.atlas/atlas_statusline.py, syntax-checked; session_boot._sync_statusline_shim keeps it current on every boot

## Reproduction
echo '{"session_id":"live-1","cwd":"<root-with-board>"}' | bash ~/.claude/statusline-command.sh

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
