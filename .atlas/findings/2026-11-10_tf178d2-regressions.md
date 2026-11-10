# tf178d2-regressions: 17.5.0 regression fixes: hooks 2822 OK, scripts only HEAD-known failures, bun 0 fail

- id: tf178d2-regressions
- status: verified
- verified_by: atlas:verifier
- verified_at: 2026-11-10T12:11:58+00:00

## Evidence
- /tmp/v4fca_hooks.log /tmp/v4fca_scripts.log /tmp/v4fca_bun.log

## Reproduction
python3 -m unittest discover -s plugins/atlas/{hooks,scripts} -p test_*.py; cd plugins/atlas && bun test

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
