---
name: atlas-crew
description: "Builds a multi-file deliverable with a parallel Atlas crew on tmux + IRC (one worker per file, file leases, check gate). Use when a spec or plan splits into independent files to build at once. Args are the atlas_crew.py run flags."
when_to_use: "crew, parallel workers per file, build these files in parallel, spec to files, plan.json crew"
disable-model-invocation: true
allowed-tools: Bash(python3 ${CLAUDE_PLUGIN_ROOT}/scripts/atlas_crew.py:*)
argument-hint: "--plan plan.json | --spec SPEC.md --files 'glob' --tests 'pattern' --check 'cmd'"
---

# atlas-crew

The crew has already run. This line executed before you saw this page; its output is the result:

!`python3 ${CLAUDE_PLUGIN_ROOT}/scripts/atlas_crew.py run $ARGUMENTS --wait 100`

Read the output above and act on it. Do not start the crew again.

- Final JSON summary with `check_exit` 0: reply in one line with the numbers from the summary (workers, wall time, tokens, check result).
- Only a start line (the crew outlasted the 100 s pre-execution window): run `python3 ${CLAUDE_PLUGIN_ROOT}/scripts/atlas_crew.py wait --run <id>` with the Bash timeout set to 600000 ms, using the run id from the start line, until the summary appears.
- `check_exit` non-zero: read only `check_tail`, fix what remains in the named files, and re-run the check command.
- An error line instead of JSON: report it verbatim and stop.
