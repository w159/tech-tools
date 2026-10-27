---
name: atlas-status
description: "Builds a stakeholder status rollup for a plan or feature from plans, findings, the todo board and commits, claims labeled verified or assumed; announce mode drafts release notes. Use when asked for feature status or to announce shipped work."
when_to_use: "status report, how is it going, progress rollup, release notes, announce"
allowed-tools: Read, Glob, Grep, Bash, Write, Task
argument-hint: '[announce] <plan-or-feature-name, or what shipped and the channels>'
---

# atlas-status

| Mode | When | Detail |
|---|---|---|
| status (default) | "How is this feature going?" | this file |
| announce | Something shipped and needs copy-pasteable announcement drafts | `references/announce.md` |

For announce mode, read `${CLAUDE_SKILL_DIR}/references/announce.md` and follow it; the status steps below do not apply. The switch is done once that reference has been read.

## Status mode

Generate the rollup by running the script. It reads plan docs, `.atlas/.run/findings.json`, the todo board and git, so the numbers come from the script and never from hand assembly:

```bash
python3 ${CLAUDE_PLUGIN_ROOT}/scripts/atlas_status.py <plan-or-feature-name>
```

- `--root` defaults to the current directory; pass it to report on another repo.
- Plan name matches `docs/plans/<name>.md`, with or without a date prefix.
- Output is markdown, safe to paste into a message or doc.
- Claims labeled **verified** have evidence on file; **assumed** claims are recorded without evidence. Say so to the stakeholder and keep the two apart.
- Empty inputs render as `- (none)`; missing telemetry or tags are reported plainly.

Done when the script's markdown is shown to the user unedited apart from a one-line lead sentence.

## Mode references

Open each when its mode reaches that step:

- `references/announcement-channels.md`: announce mode: per-channel shapes and grounding rules
