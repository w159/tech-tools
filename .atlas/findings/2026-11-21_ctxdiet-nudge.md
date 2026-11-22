# ctxdiet-nudge: route nudge names spawn-team when the team gate routes

- id: ctxdiet-nudge
- status: verified
- verified_by: lead
- verified_at: 2026-11-21T06:37:07+00:00

## Evidence
- test_prompt_optimizer OK; gate on: nudge contains spawn-team; gate off: old text

## Reproduction
cd plugins/atlas/hooks && python3 -m unittest test_prompt_optimizer test_dispatch_tripwire

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
