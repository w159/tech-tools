# herd-page-singleton-10.1.2: Herd dashboard page + single-instance herdr-web-ui guard

- id: herd-page-singleton-10.1.2
- status: verified
- verified_by: atlas:lead
- verified_at: 2026-10-07T00:42:15+00:00

## Evidence
- unittest test_atlas_herdr 8 OK; live: SIGTERM instance, 8 parallel separate-process ensure -> 1 started + 7 reused, duplicates 0, one listener on 7317, none on 17317/27317/37317/47317; PORT=7317 pinned in plugin config .env; headless Chrome: Herd nav present, iframe loads herdr UI, scrollHeight==innerHeight; no X-Frame-Options/CSP on :7317. Recorded by lead from implementer evidence, not independent re-verification. herdr [[startup]] hook itself is not guarded; PORT pin makes a racing start fail instead of forking.

## Reproduction
cd plugins/atlas/scripts && python3 -m unittest test_atlas_herdr; python3 atlas_herdr.py status

## Proposed fix
none recorded

## Doc refs
- docs/architecture/atlas-workboard.md
- plugins/atlas/CHANGELOG.md

## History
- no earlier verdicts
