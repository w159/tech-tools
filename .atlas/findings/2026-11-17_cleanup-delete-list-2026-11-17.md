# cleanup-delete-list-2026-11-17: Delete list: 1,2,3,7 confirmed; 4,5,6 refuted (keep types/, connector-config-flow.md, herdr scripts)

- id: cleanup-delete-list-2026-11-17
- status: verified
- verified_by: atlas:verifier
- verified_at: 2026-11-17T12:11:08+00:00

## Evidence
- .atlas/.run/briefs/cleanup-audit.verified-deletes.report.md

## Reproduction
git grep skill names outside skills/; ls node_modules; git status --ignored --short plugins/atlas; grep tsconfig extends .claude-plugin/types; read herdr-web-ui/UPSTREAM.md

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
