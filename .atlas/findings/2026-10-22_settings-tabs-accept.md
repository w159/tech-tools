# settings-tabs-accept: Settings five tabs browser acceptance on main (sandbox 7499)

- id: settings-tabs-accept
- status: rejected
- verified_by: uitest-settings-tabs
- verified_at: 2026-10-22T22:41:31+00:00

## Evidence
- C1 PASS 5 tabs ordered, Dashboard selected, no .st-nav, global nav present | C2 PASS counts Dashboard 6 Behavior 50 Models 16, 4 group titles, paths footer present | C3 PASS no banned text any tab | C4 PASS no on/off text inputs in Behavior/Models, both selects | C5 PASS scrollWidth==innerWidth (1600/1137 css px, zoom 0.9) | C6 FAIL hash form #/settings?tab=integrations and ?cat=guardrails land on Dashboard; query form /?tab=..#/settings works; Models click + ArrowRight pass | C7 PASS | C8 PASS a-f | C9 PASS only 2 deliberate 400s | C10 PASS one PUT /api/v2/prefs verified

## Reproduction
none recorded

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
