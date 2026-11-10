# verify-be89-release: 17.5.0 tree: 10 tests fail on tree but pass on HEAD (stale tests/codex hooks json/crew.md TOC); live checks 1-4,6,8 pass

- id: verify-be89-release
- status: rejected
- verified_by: atlas:verifier
- verified_at: 2026-11-10T11:37:27+00:00

## Evidence
- .atlas/tmp/verify/a.log b.log; hooks.codex.json vs gen_codex_hooks; plugins/atlas/skills/atlas-orchestrate/references/crew.md

## Reproduction
python3 -m unittest discover -s plugins/atlas/hooks / scripts; same files in git worktree of HEAD

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
