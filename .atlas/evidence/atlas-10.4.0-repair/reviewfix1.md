# ReviewFix1 evidence (colony Send/Kill, member revive, recorded handles)

- Smoke (`python3 /tmp/atlas-fix/smoke_rf1.py`, temp repo/ATLAS_HOME/port): kill W -> `(200, {'ok': True, 'killed': 'W', 'via': 'pid'})`, sleep child exit -15; send to finished F -> `409 member_finished`.
- run-worker smoke: registry entry carried `"pid": 78571` mid-run, `exit_code: 0` at end.
- Targeted: `pytest scripts/test_atlas_dash_colony.py test_atlas_mux.py test_atlas_channels.py test_atlas_dash_irc.py` -> 141 passed, 30 subtests passed.
- Full suite before the `_find` scope change: 2700 passed, 3 skipped (/tmp/atlas-fix/suite4.txt). Re-run after: /tmp/atlas-fix/suite5.txt.
- Reproduce: `cd plugins/atlas && env -u ATLAS_CHANNEL -u ATLAS_LEAD_NAME -u ATLAS_WORKER_NAME -u ATLAS_TRIPWIRE_HARD -u ATLAS_PROJECT_ROOT ATLAS_DASHBOARD=off ATLAS_COLONY=off python3 -m pytest hooks/ scripts/ -q -p no:cacheprovider`
