# settings-tabs-accept-2: Settings five tabs browser acceptance on main after ui2 (sandbox 7499, lead Playwright run)

- id: settings-tabs-accept-2
- status: verified
- verified_by: lead-playwright
- verified_at: 2026-10-22T22:56:20+00:00

## Evidence
- ui-runtime-tester run: C1-C5, C7-C10 PASS (5 tabs, counts 6/50/16/39/14, no next session/Undocumented/unchanged text, no overflow at 1137 and 1600 css px, one POST per save, read_only 400, console clean except deliberate 400s)
- lead rerun after ui2: #/settings?tab=models selects Models with groups Prompt optimizer/Decision model/Turn scoring; Behavior at 1024 shows 4 groups, footer names ATLAS_HOME/ATLAS_DB/ATLAS_DASHBOARD_PORT, scrollWidth == innerWidth, 0 on/off text inputs
- .playwright-mcp/v151-settings-models-1440.png
- .playwright-mcp/v151-settings-behavior-1024.png

## Reproduction
none recorded

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
