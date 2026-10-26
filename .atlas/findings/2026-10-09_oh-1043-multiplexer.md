# OH-1043-multiplexer: atlas_mux strips TMUX/TMUX_PANE, 10s tmux timeout, wedged tmux -> ok:false; doctor cmux info-only when inactive

- id: OH-1043-multiplexer
- status: verified
- verified_by: SessionVerifier
- verified_at: 2026-10-09T15:12:53+00:00

## Evidence
- scripts/atlas_mux.py:137-139 strip TMUX/TMUX_PANE, :154 TMUX_TIMEOUT_S=10, :166-174 timeout -> rc 124
- test_atlas_mux.py:1767 missing_or_wedged_tmux pass
- test_atlas_doctor.py:907,913 cmux info-only pass

## Reproduction
env -u CI python3 -m pytest scripts/test_atlas_mux.py scripts/test_atlas_doctor.py -q

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
