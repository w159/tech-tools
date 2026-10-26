# colony-terminal-installed: Installed 12.5.0 Terminal page works with live tmux worker

- id: colony-terminal-installed
- status: verified
- verified_by: atlas:verifier
- verified_at: 2026-10-16T21:16:03+00:00

## Evidence
- .scratch/verify/v3-step3.png,.scratch/verify/v3-step4.png,.scratch/verify/v3-step5.png

## Reproduction
ATLAS_MUX=tmux atlas_mux.py spawn-team (12.5.0 cache) + headless chrome 1600x1000 on /#/terminal; enlarge card, All agents, wait+reap

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
