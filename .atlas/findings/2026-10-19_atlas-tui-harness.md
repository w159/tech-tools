# ATLAS-TUI-HARNESS: atlas-tui works from omp/claude/codex: /atlas-tui omp command, skill path, visible launch, live in-process colonies

- id: ATLAS-TUI-HARNESS
- status: verified
- verified_by: lead
- verified_at: 2026-10-19T17:54:39+00:00

## Evidence
- real omp (-e plugins/atlas/omp/index.ts) in tmux: /atlas-tui rendered curses TUI, keys reached it, q restored omp editor
- bun-parented channel-open: colony transport=subagent, source from omp, seats runtime omp working; gone after lead exit
- pytest test_atlas_tui/colony_model/todo 122 passed; hooks+dash_term 884 passed; bun tui-command+index 81 pass

## Reproduction
none recorded

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
