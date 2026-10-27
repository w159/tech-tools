# S3-docs-underscore: Docs naming: YYYY-MM-DD_slug, hyphen migration, docs-root routing, embedded date parse

- id: S3-docs-underscore
- status: verified
- verified_by: lead
- verified_at: 2026-10-26T13:45:32+00:00

## Evidence
- plugins/atlas/scripts/test_lint_docs_names.py
- test_lint_docs_names Ran 42 OK after follow-up merge

## Reproduction
python3 plugins/atlas/scripts/lint_docs_names.py --all --root <proj>

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
