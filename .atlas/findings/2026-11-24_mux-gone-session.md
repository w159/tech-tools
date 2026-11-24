# mux-gone-session: parseMuxStatus: tmux:false members without exit note read failed; tmux present unchanged

- id: mux-gone-session
- status: verified
- verified_by: atlas:verifier
- verified_at: 2026-11-24T19:25:12+00:00

## Evidence
- plugins/atlas/mod/data/mux.ts:29-35; mod/host/poll.ts:326 passes raw status stdout; bun test mod/data/mux.test.ts 11 pass

## Reproduction
atlas_mux.py status --run t033ece --root . (tmux:false) -> bun run chk.ts: no-exit members failed, exit0 finished, tmux:true running; bun test mod/data/mux.test.ts

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
