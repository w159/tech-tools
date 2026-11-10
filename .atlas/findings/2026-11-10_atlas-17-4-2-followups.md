# ATLAS-17.4.2-followups: atlas 17.4.2: report-only doctor, every-reply header gate with scoped loop cap and burst-breaker fix, finished/failed card labels, payload cuts with byte measures, dead code removed; suites green; not observed live

- id: ATLAS-17.4.2-followups
- status: verified
- verified_by: lead-test-run
- verified_at: 2026-11-10T08:02:31+00:00

## Evidence
- hooks unittest: Ran 2772 tests OK (skipped=5)
- scripts unittest (venv with pytest on PATH): Ran 4275 tests OK (skipped=1)
- claude plugin test plugins/atlas: 908 pass, 188 fail (all 'did not load'); bun test: 3391 pass, 0 fail
- validate passed; tsc exit 0; ruff F401,F811,F841,F821 clean; fallow dead-code 2
- gate probes: 6 of 6 header-less turns block; mixed a,n escapes at limit; burst breaker not tripped

## Reproduction
python3 -m unittest discover -s plugins/atlas/hooks -p 'test_*.py'

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
