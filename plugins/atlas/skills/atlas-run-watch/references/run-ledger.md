# Run ledger spec: `.atlas/.run/runs/<id>/`

Pattern sibling to the worktrees ledger (`atlas-worktree/SKILL.md:32-34`): ephemeral
run state under `.atlas/.run/`, discoverable by sibling skills. One run, one directory
(`SKILL.md` boundary — two entries for one run is a defect).

`<id>` = `<short-target>-<YYYYMMDD-HHMM>` (e.g. `train-50ep-20261010-1412`). It must
uniquely identify the run; a re-watch of the same target resumes the same id.

| File | Owner | Contents |
|---|---|---|
| `run.json` | open | `{"target": "...", "mode": "log\|pid\|ci\|cmd", "pid": null\|N, "path": null\|"...", "url": null\|"...", "command": null\|"...", "started": "<ISO8601>", "interval": 120}` |
| `offset` | every tick | last byte offset read from the watched log (log/PID modes) |
| `checkpoints.log` | every tick | one line per tick: `<ISO8601> <status> +<delta>` — the checkpoint notes |
| `full.log` | open + every tick | the complete observed log / response bodies; the only evidence handle, pass its path (`ci-classification.md:19-21`) |

Rules:

- Ephemeral: like `worktrees.json` this is run state, not docs; never commit-tracked project history.
- Every tick appends exactly one checkpoint line — no tick without a checkpoint note, no checkpoint without a tick.
- Cleanup: on ✅ or ⛔ leave the ledger (it is the evidence); a user may delete stale run dirs manually. No background process writes here (this skill is in-session only).
- Sibling discovery: another skill may resume a watch by reading `run.json` and the last `checkpoints.log` line — the checkpoint-mode resume line in `SKILL.md` Step 2 must point at this target.
