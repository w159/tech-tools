# ATLAS-TUI-ACTIONS: atlas-tui actionable: single-click, msg/view/term/stop buttons, transcript seat view

- id: ATLAS-TUI-ACTIONS
- status: verified
- verified_by: lead
- verified_at: 2026-10-19T19:12:03+00:00

## Evidence
- tmux-driven real TUI: click [ view ] on in-process omp seat showed transcript lines; click [ msg ] + text + Enter -> atlas_todo inbox returned the note for explorer-a
- inside omp (-e repo extension): /atlas-tui, clicked colony then [ view ], seat view rendered with buttons
- pytest tui+colony_model+dash_colony+todo 171 passed

## Reproduction
none recorded

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
