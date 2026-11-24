# atlas-taste-neutral: atlas-taste and atlas-frontend impose no taste; values come from the project or AskUserQuestion

- id: atlas-taste-neutral
- status: verified
- verified_by: lead
- verified_at: 2026-11-24T18:40:18+00:00

## Evidence
- grep for Tailwind/shadcn classes, ms timings, breakpoints, hex in skills/atlas-frontend: only <300ms behavior threshold left; contract suites 222 passed; 0 banned punctuation lines

## Reproduction
cd plugins/atlas && ../../.venv/bin/python -m pytest -q hooks/test_atlas_contract.py skills/atlas-taste/scripts/test_taste_check.py

## Proposed fix
none recorded

## Doc refs
- none

## History
- 2026-11-24T17:00:39+00:00 rejected by atlas:verifier: atlas-taste neutral (OK) but atlas-frontend imposes defaults
