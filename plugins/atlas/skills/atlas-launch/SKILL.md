---
name: atlas-launch
description: Launch a remediation session preloaded with a finding from the latest audit hub; use after atlas-athena or atlas-ariadne. No args lists findings.
when_to_use: the task involves launch
disable-model-invocation: true
argument-hint: '[finding-id]  (no args: list actionable findings from the latest hub)'
---



Apply the Operating Contract to this entire task. It is injected below.

```!
cat "${CLAUDE_PLUGIN_ROOT}/skills/atlas-metis/references/operating-contract.md"
```

If the contract did not load above, read `skills/atlas-metis/references/operating-contract.md` and apply it before proceeding.

You are the launcher that closes the audit -> remediation loop. A prior `atlas-athena` or
`atlas-ariadne` run wrote a hub under `docs/audits/atlas-<skill>-<date>/hub/`
(`manifest.json` + branded `index.html`, built by `scripts/build_hub.py`). Each manifest entry is
an actionable finding with its `id`, `severity`, `file`, `node_id`, `handoff_path`, and
`prompt_summary`.

Requested finding: $ARGUMENTS

## Step 1 - Find the most recent hub

Locate the newest `docs/audits/atlas-*-*/hub/manifest.json` (most recent run dir by name/date). If
none exists, stop and say so: "No audit hub found. Run `atlas-athena` or `atlas-ariadne` first."

## Step 2a - No finding id given: list the actionable findings

Read the manifest and print one line per entry, HIGH severity first:

```
<severity>  <id>  <file>:<line>  - <prompt_summary>   ->  atlas-launch <id>
```

Then stop. Do not start any work; let the user pick a finding.

## Step 2b - A finding id given: launch its remediation

1. Resolve `<id>` in the manifest. If it is not found, list the valid ids and stop.
2. Read the handoff prompt at `<run_dir>/<handoff_path>` in full - it is self-contained (names the
   `file:line`, the flaw, the acceptance criterion, and the lead squad agent).
3. Mark this as a real orchestration run so the discipline hooks engage:

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/atlas_db.py" mark-orchestrating "${CLAUDE_CODE_SESSION_ID}" "$(pwd)"
```

   (Fail-open: if the command is unavailable, continue - the hooks just stay advisory-off.)
4. Invoke the **`atlas-metis`** skill with the handoff prompt as its opening task. The handoff IS
   the task: run atlas-metis's methodology (Orient -> plan -> dispatch -> verify) against it, with
   the handoff's acceptance criterion as the definition of done. Do not re-derive the finding;
   start from the handoff and route to the squad agent it names.

This command never invokes a non-existent `/atlas-metis` command - `atlas-metis` is the
orchestration skill, and this launcher is the single entry point that loads a handoff into it.
(Distinct from `/atlas-handoff`, which writes a session-RESUME checkpoint, not a remediation
launch.)
