# Launch Artifact Seed

The on-disk record a `atlas-launch` run leaves behind when it starts a
remediation. Copy this file to `<run_dir>/launch/<finding-id>.md` and
fill the brackets. One finding per file.

```markdown
# Launch: <finding-id>

- **Source hub:** docs/audits/atlas-<skill>-<date>/hub/
- **Manifest entry:** <id>, severity <HIGH|MEDIUM|LOW>, file <path:line>
- **Launched at:** <ISO 8601 timestamp>
- **Session:** <CLAUDE_CODE_SESSION_ID>
- **Lead squad agent:** <atlas:implementer | atlas:hephaestus | ...>

## Handoff prompt (verbatim)

<paste the handoff prompt read from <run_dir>/<handoff_path> in full>

## Acceptance criterion

<the single testable criterion from the handoff that defines done>

## Plan

1. <first concrete step the lead agent will take>
2. <step>

## Verification

- <command the verifier will run, and the expected output that proves the
  acceptance criterion is met>

## Status

- [ ] dispatched to lead agent
- [ ] lead agent reports done with evidence
- [ ] independent atlas:verifier confirmed
- [ ] integrated / closed
```

## Why a seed

A launch is a commitment: a finding was picked, a squad agent was
named, an acceptance criterion was stated. Writing that down at launch
time means a fresh session can resume the remediation without re-reading
the entire audit hub. The seed is the contract between the launcher and
the squad.