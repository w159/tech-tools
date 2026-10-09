STATUS: DONE
STEPS: 6/6
FILES_CHANGED: plugins/atlas/scripts/dashboard_ui/js/pages/colony.js; plugins/atlas/scripts/dashboard_ui/js/colony-roster.test.js; plugins/atlas/scripts/atlas_todo.py; plugins/atlas/scripts/atlas_mux.py; plugins/atlas/scripts/atlas_launch.py; plugins/atlas/scripts/atlas_dash_colony.py; plugins/atlas/scripts/test_atlas_dash_colony.py; plugins/atlas/scripts/test_atlas_channels.py; docs/atlas-colony.md; plugins/atlas/CHANGELOG.md
EVIDENCE:
1. full suite (env -u ... pytest hooks/ scripts/) -> 2700 passed, 3 skipped, 422 subtests passed in 186.66s (/tmp/atlas-fix/suite4.txt)
2. dashboard_ui/js bun test -> 23 pass, 0 fail
3. omp bun test (env -u ATLAS_* ATLAS_MANDATES=off) -> 356 pass, 0 fail (16 delegation-gate tests fail only under this session's atlas env, untouched by this slice)
4. smoke (/tmp/atlas-fix/smoke_rf1.py): kill W -> (200, {'ok': True, 'killed': 'W', 'via': 'pid'}); sleep exit code -15; send F finished -> (409, error member_finished)
5. run-worker smoke: MID "pid": 78571 recorded; END exit_code 0 on same entry
DELIVERABLE: #1 colony.js posts project in send/kill bodies (sendBody/killBody + bun test). #2 register_member revives (revive flag on _add_member/join/open_lead_channel; plain re-open does not). #3/#4 set_member_handles (fail-open); mux spawn records pane_id, run-worker records harness pid, launch records pane_id; roster resolves registry-member panes only by recorded pane_id (lead still by title); kill = recorded pane, else alive recorded pid, else 409 member_dead. P2: failed spawn unregisters member; leave/mark_finished use CHANNEL_LOCK_TIMEOUT_S. Docs and CHANGELOG updated. Tests: no-handle 409, cross-project same-name pane, kill via sleep pid, gone pid dead, respawn live.
NEXT: none
