# colony-terminal-live: Enlarged colony card attaches live worker pane; atlas-view session created/removed; TUI seat opens

- id: colony-terminal-live
- status: verified
- verified_by: atlas:verifier
- verified_at: 2026-10-16T21:03:00+00:00

## Evidence
- .scratch/verify/v2-3-enlarged.png,.scratch/verify/v2-4-enlarged-10s.png,.scratch/verify/v2-5-back.png,.scratch/verify/v2-tui-capture.txt

## Reproduction
spawn-team ta34430 + headless chrome :7431/#/terminal click card, tmux ls; atlas_tui.py in tmux Enter Enter q

## Proposed fix
none recorded

## Doc refs
- none

## History
- 2026-10-16T20:18:04+00:00 rejected by atlas:verifier: Colony terminal live e2e: all steps pass except enlarged pane view (ws kind=pane) -> atlas-view session destroyed before
