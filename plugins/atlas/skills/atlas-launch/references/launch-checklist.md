# Launch Checklist

The ordered steps `atlas-launch` performs to close the
audit -> remediation loop. Use this as a reviewable runbook; each step
has one failable check.

## Step 1 - Locate the most recent hub

- Find the newest `docs/audits/atlas-*-*/hub/manifest.json` by run-dir
  name (date-sortable).
- **Check:** a manifest exists. If not, stop with "No audit hub found.
  Run atlas-athena or atlas-ariadne first."

## Step 2 - Parse the manifest

- Read `manifest.json`. Each entry has `id`, `severity`, `file`,
  `line`, `node_id`, `handoff_path`, `prompt_summary`.
- **Check:** the manifest parses and has at least one entry. If empty,
  stop with "Hub is empty; nothing to launch."

## Step 3a - No finding id given: list actionable findings

- Print one line per entry, HIGH severity first:
  `<severity>  <id>  <file>:<line>  - <prompt_summary>   ->  atlas-launch <id>`
- Stop. Do not start work.

## Step 3b - Finding id given: resolve it

- Match `<id>` against the manifest.
- **Check:** the id exists. If not, list valid ids and stop.

## Step 4 - Read the handoff prompt in full

- Read `<run_dir>/<handoff_path>`. It is self-contained: names file:line,
  the flaw, the acceptance criterion, and the lead squad agent.
- **Check:** the handoff file exists and names a lead agent. If the lead
  agent is missing or unknown, stop and say so.

## Step 5 - Mark the session as orchestrating

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/atlas_db.py" mark-orchestrating \
  "${CLAUDE_CODE_SESSION_ID}" "$(pwd)"
```

- Fail-open: if the command is unavailable, continue. The discipline
  hooks stay advisory-off.

## Step 6 - Write the launch artifact

- Copy `templates/launch-artifact.seed.md` to
  `<run_dir>/launch/<finding-id>.md` and fill it. This is the resumption
  record for a fresh session.

## Step 7 - Invoke atlas-metis with the handoff

- The handoff IS the task. Run atlas-metis's methodology
  (Orient -> plan -> dispatch -> verify) against it, with the handoff's
  acceptance criterion as the definition of done.
- Do not re-derive the finding; start from the handoff and route to the
  squad agent it names.

## Anti-patterns

- Do not invoke a non-existent `/atlas-metis` command. `atlas-metis` is
  the orchestration skill; this launcher loads a handoff into it.
- Do not confuse this with `/atlas-handoff`, which writes a
  session-resume checkpoint, not a remediation launch.
- Do not skip Step 6. A launch without an artifact cannot be resumed.