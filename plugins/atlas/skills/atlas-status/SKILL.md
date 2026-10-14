---
name: atlas-status
description: "Builds a stakeholder-readable status rollup for a plan or feature from docs/plans/, findings, the todo board and commits, claims labeled verified or assumed. Use when asked how a feature is going."
when_to_use: "status report, how is it going, progress rollup, stakeholder update, feature status, plan status"
allowed-tools: Read, Glob, Grep, Bash
argument-hint: '<plan-or-feature-name>'
---
Generate the rollup by running the script — it reads plan docs, `.atlas/.run/findings.json`, the todo board, and git; never hand-assemble:

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/atlas_status.py <plan-or-feature-name>
```

- `--root` defaults to the current directory; pass it to report on another repo.
- Plan name matches `docs/plans/<name>.md`, with or without a date prefix.
- Output is markdown, safe to paste into a message or doc.
- Claims labeled ✅ **verified** have evidence on file; ⚠️ **assumed** are recorded without evidence — say so to the stakeholder rather than blurring the distinction.
- Empty inputs render as `— (none)`; missing telemetry or tags are reported plainly, never invented.
