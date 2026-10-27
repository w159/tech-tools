# S-statusline-boundary: Never modify the user's personal wiring (statusline-command.sh, .zshrc, settings.json) without an explicit per-item approval

- id: S-statusline-boundary
- status: verified
- verified_by: atlas-orchestrator
- verified_at: 2026-09-09T14:48:52+00:00

## Evidence
- User: 'i never asked or approved you to change or modify the statusline' - the unrequested edit of ~/.claude/statusline-command.sh cost trust and had to be reverted; the file was later believed empty (stale editor buffer), reinforcing that even well-meant personal-config edits are trust-destructive
- Correct process: propose the change, wait for the pick (AskUserQuestion), then edit only what was named; atlas product work stays under plugins/atlas/**

## Reproduction
git show 8a5afcd..cb300e5 --stat (the release that carried the unrequested statusline block)

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
