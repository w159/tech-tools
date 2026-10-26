# ATLAS-TUI-OPENRIG: TUI OpenRig parity (tree seats, WALL, agent detail, terminals) + dashboard self-heal + launch respawn

- id: ATLAS-TUI-OPENRIG
- status: verified
- verified_by: lead
- verified_at: 2026-10-19T20:11:53+00:00

## Evidence
- tmux-driven TUI with live omp-style colony: clicked WALL tab -> tiles with transcript output; clicked tile -> agent detail with CONTEXT/ACTIVITY/WORK/QUEUE/NEEDS YOU/SEAT/COMMUNICATION/OUTPUT
- headless browser: :7421 served ui_missing from deleted 12.5.6 install; after ensure Overview/Colony/Terminal render; DashSelfHeal live proof on :7439 1.9.0 -> 1.10.0 after dir delete
- pytest tui/colony_model/dash_colony/todo/dashboard/dispatch_tripwire 557 passed

## Reproduction
none recorded

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
