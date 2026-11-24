---
name: atlas-status
description: "Rolls up feature status, release notes, product pulse and the live TUI. Use when asked for status, an announcement, a usage and error pulse, or to watch colony workers."
when_to_use: "status report, where do we stand, progress rollup, release notes, announce a release, product pulse, usage report, error rate, PostHog, Sentry, Mixpanel, atlas tui, command center, watch workers"
allowed-tools: Read, Glob, Grep, Bash, Write, Task
argument-hint: '[announce | pulse [window e.g. 24h, 7d] | tui] <plan-or-feature-name, or what shipped and the channels>'
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

## Merged modes

- **pulse** (`pulse [window]`): time-windowed product pulse (usage, performance, errors) from wired telemetry, read-only, into docs/pulses/. Procedure: `references/pulse.md` (sub-references under `references/pulse/`).
- **tui** (`tui`): open the Atlas Command Center, a live terminal UI over the colony's tmux workers (topology, seats, feed, system). Procedure: `references/tui.md`; it runs `${CLAUDE_PLUGIN_ROOT}/scripts/atlas_tui.py`. Run only when the user asks for it.

## Merged-mode reference files

- `references/pulse/config.md`
- `references/pulse/discovery.md`
- `references/pulse/interview.md`
- `references/pulse/report-template.md`
- `references/pulse/run.md`
