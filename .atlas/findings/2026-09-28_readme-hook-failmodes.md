# readme-hook-failmodes: README names fail-closed hooks and the two orchestrating-flag writers; atlas-ship/worktree/commit keep model invocation (programmatic callers)

- id: readme-hook-failmodes
- status: verified
- verified_by: orchestrator-review
- verified_at: 2026-09-28T10:12:17+00:00

## Evidence
- plugins/atlas/README.md Hooks section; dispatch_tripwire.py _deny; prompt_optimizer.py arm_orchestration
- callers: skills/atlas-autopilot/SKILL.md:61, skills/atlas-orchestrate/references/implementation-units.md:46, skills/atlas-ship/SKILL.md:55

## Reproduction
git diff -- plugins/atlas/README.md

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
