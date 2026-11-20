# 2026-11-20 perf and hygiene fixes: before/after evidence

All runs on the user's machine. BEFORE = installed atlas 17.31.0 (`~/.claude/plugins/cache/tech-tools/atlas/17.31.0`,
read only). AFTER = this working tree. DB measurements use a `.backup` copy of `~/.atlas/atlas.db` in the session
scratchpad; the live DB was not modified.

## Root causes (profiled with cProfile on the real project)

| Problem | Root cause | Where |
|---|---|---|
| `atlas_doctor.py --hook` ~2.0 s avg at SessionStart | `backfill_findings` re-scanned all 775 findings per id (277,826 genexpr steps) and ran 2 globs per id (1,214 globs over 613 records) | `scripts/atlas_finding.py` `backfill_findings` |
| ~0.2 s per `atlas_db.init` (3 per session start) | `backfill_run_kinds` grouped all 619k messages on every connection | `scripts/atlas_db.py` `init` |
| Dashboard started every session (~0.9 s) though `~/.claude/settings.json` says off | `apply_store_env` let a stale `~/.atlas/settings.json` value (`ATLAS_DASHBOARD=on`, saved 2026-10-22) override everything | `scripts/atlas_env.py` |
| atlas.db 820 MB, growing | no retention anywhere | `scripts/atlas_db.py` |
| `.atlas/.run` 329 MB | no cleanup of logs/inbox/crew | none |
| Two fallow audits per commit/push | atlas gate and the fallow plugin's `fallow-gate.sh` both run | `hooks/fallow_gate.py` |
| statusLine pinned to a version folder | `install` and `doctor --fix` wrote a versioned path | `scripts/atlas_statusline.py`, `scripts/atlas_doctor.py` |

## Measurements

```
missing_records (5 warm runs)
BEFORE 17.31.0 missing= 11 runs(s): [0.463, 0.46, 0.479, 0.499, 0.494]
AFTER  source  missing= 11 runs(s): [0.016, 0.015, 0.013, 0.014, 0.014]

backfill_run_kinds on DB copy (619,098 messages, ts REAL)
BEFORE full pass                 0.216 s
AFTER  incremental (init path)   0.038 s
full pass after incremental: 0 rows changed (same classification)

SessionStart hooks, 3 runs each, ATLAS_HOME = scratch copy of the DB, ATLAS_MAINT=off
BEFORE atlas_doctor.py runs(s): 3.38 0.91 0.98
BEFORE session_boot.py runs(s): 0.48 0.52 0.55
AFTER  atlas_doctor.py runs(s): 0.44 0.32 0.33
AFTER  session_boot.py runs(s): 0.22 0.29 0.26

Knob precedence on the user's real files (read only, env copy)
real store + real settings -> ATLAS_DASHBOARD = off (before: on)

Retention on DB copy (90 days)
rows older than 90d before: messages 134246, tool_calls 37340, user_prompts 6467, turn_scores 3, signals 316
prune_old 1.4 s; rows older than 90d after: all 0; runs 4059 and facets 4763 kept
vacuum 2.4 s; 820 MB -> 651 MB; second prune: all 0 (idempotent)

Maintenance spawn (AFTER session_boot, scratch ATLAS_HOME)
boot returned in 0.18 s; stamp absent right after (detached)
stamp after background maint: db and project stamped
second boot spawns again? False

.atlas/.run cleanup dry-run on this repo (14 days)
{"files": 438, "bytes": 75647997, "crew_dirs": 0}

fallow plugin gate detected on this machine -> True (0.2 ms)

statusline launcher (median of 5)
direct 17.31.0 39 ms, launcher 38 ms; resolves to .../atlas/17.31.0/scripts/atlas_statusline.py
```
