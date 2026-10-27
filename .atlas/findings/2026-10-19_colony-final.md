# colony-final: v13 final colony/terminal verification

- id: colony-final
- status: rejected
- verified_by: atlas:verifier
- verified_at: 2026-10-19T14:12:16+00:00

## Evidence
- .scratch/verify/v13-2-command-center.png: NOW column truncated to 20 chars (ctx_read atlas_dashb…), identical across 24+s while agent progressed chunk 1..1501-1750

## Reproduction
serve :7444; spawn-team --team-id v13a; sampled #/terminal xterm text every 4-5s

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
