# atlas-810-doctor-context-tooling-warn-check: scripts/atlas_doctor.py: new WARN-severity context-tooling check (C11) plus a severity field on add()/failed filtering, so an unscaffolded project does not trigger a false SessionStart warning

- id: atlas-810-doctor-context-tooling-warn-check
- status: verified
- verified_by: VerifyAtlas810
- verified_at: 2026-09-28T13:23:10+00:00

## Evidence
- scripts/atlas_doctor.py:271 def check_context_tooling(root_path=None); :304 def add(cid, ok, detail, severity="fail"); :460 add("context-tooling", tooling_ok, tooling_detail, severity="warn"); the two `failed = [...]` filter sites at :1429 and :1435 both read `if not r["ok"] and r.get("severity") != "warn"`; the --hook warning block at :1437-1444 operates only on that same failed list
- `python3 -m pytest scripts/test_atlas_doctor.py -q -k context_tooling` -> 5 passed, 62 deselected
- independent throwaway repro by fresh verifier dispatch (not the existing test): monkeypatched atlas_doctor.check_context_tooling to return (False, "x"), called atlas_doctor.main(["--hook"]) with stdout captured -- result: exit code 0, no 'ATLAS-DOCTOR WARNING' text in captured stdout (VerifyAtlas810 claim 4: CONFIRMED)

## Reproduction
cd plugins/atlas && python3 -m pytest scripts/test_atlas_doctor.py -q -k context_tooling

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
