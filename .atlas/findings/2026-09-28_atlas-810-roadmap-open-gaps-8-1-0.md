# atlas-810-roadmap-open-gaps-8-1-0: two explicit docs/ROADMAP.md [in-progress] items record real, still-open gaps from the 8.1.0 work (no MCP-server-registration check in atlas_doctor; --fix cannot bootstrap a genuinely empty ~/.claude) rather than silently deferring them

- id: atlas-810-roadmap-open-gaps-8-1-0
- status: verified
- verified_by: VerifyAtlas810
- verified_at: 2026-09-28T13:23:10+00:00

## Evidence
- docs/ROADMAP.md lines 25-43 (MCP-registration gap) and lines 44-55 (--fix on empty ~/.claude) read in full by fresh verifier dispatch: both accurately describe still-open gaps, neither secretly already fixed elsewhere in the diff
- grepped scripts/atlas_doctor.py for `def check_` -- only check_orchestration_wiring, check_output_style, check_context_tooling exist; no MCP-server-registration check exists
- grepped for the literal string 'cannot fix: context incomplete' -- found unconditionally at scripts/atlas_doctor.py:592 with no surrounding bootstrap/first-install branch, confirming --fix still cannot bootstrap a genuinely empty ~/.claude
- VerifyAtlas810 claim 7: CONFIRMED -- both roadmap entries are honest and unresolved

## Reproduction
grep -n 'def check_' plugins/atlas/scripts/atlas_doctor.py; grep -n 'cannot fix: context incomplete' plugins/atlas/scripts/atlas_doctor.py

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
