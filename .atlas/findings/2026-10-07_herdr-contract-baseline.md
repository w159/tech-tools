# herdr-contract-baseline: 13 vendored herdr-web-ui contract test failures are pre-existing (identical set in /tmp/colony-mirror-backup)

- id: herdr-contract-baseline
- status: verified
- verified_by: atlas:verifier
- verified_at: 2026-10-07T13:17:03+00:00

## Evidence
- /tmp/ct-backup-fails.txt vs /tmp/ct-current-fails.txt: diff empty, 13 each; logs /tmp/ct-{backup,current}-*.log

## Reproduction
/tmp/ct-run.sh <dir> <tag> (bun test --timeout 60000 server/{codex-binding,prompt,api,omo-prompt}.contract.test.ts)

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
