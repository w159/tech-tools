# Evidence: Atlas 16.7.0 warm lead benchmark

Audit page: docs/audits/2026-10-29_atlas-16.7.0-warm-lead.md

- `runs/<fixture>-<arm>-<label>.json`: result of one run (wall_s, pytest
  passed/failed, tokens, per-log token split). fixture = 8 modules,
  fixture3 = 18, fixture4 = 30.
- Arms: `warmp-wf` crew with warm lead on the released code; `warmp-wl` the
  same on 7a23e3f3; `skill-cr` crew cold; `single-cs` single prompt cold;
  `singlew-sx` single prompt with start and exit excluded.
- `*.warm.json`: timestamps of start, ready, hand-off, first and last result,
  exit (single prompt). `*.send.json`: output of `atlas_warm_lead.py send
  --wait` (crew).
- `raw-lines.txt`: one line per run as printed by the loop: fixture, arm,
  label, wall s, passed, failed, tokens.
- `harness/`: the scripts that ran the arms (arm3w.sh, warmlead.py, wloop.sh,
  acct.py).
