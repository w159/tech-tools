# ATLAS-process-fetch-before-declaring-a-commit-missing: git cat-file failing proves the object is absent LOCALLY, not that the commit does not exist; fetch before telling the user work was lost

- id: ATLAS-process-fetch-before-declaring-a-commit-missing
- status: verified
- verified_by: this session claimed 5.12.0 was lost, then found it on origin/main at push time
- verified_at: 2026-08-18T15:38:13+00:00

## Evidence
- docs/CHANGELOG.md

## Reproduction
git cat-file -t f796445 fails on a clone that has not fetched; git fetch origin then git log --all shows it on origin/main

## Proposed fix
none recorded

## Doc refs
- docs/CHANGELOG.md

## History
- no earlier verdicts
