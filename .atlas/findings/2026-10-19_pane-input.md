# pane-input: Typing into enlarged dashboard terminal reaches real tmux pane; resize propagates

- id: pane-input
- status: verified
- verified_by: atlas:verifier
- verified_at: 2026-10-19T14:00:33+00:00

## Evidence
- .scratch/verify/v11-input.png; capture-pane showed hello-atlas-123 x2; pane 129x49 -> 106x35 after viewport 1440x900 -> 1100x700

## Reproduction
tmux new-session -d -s atlas-inputprobe cat; browser :7421 #/terminal?space=inputprobe&seat=inputprobe, type hello-atlas-123+Enter, tmux capture-pane -p -t %19

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
