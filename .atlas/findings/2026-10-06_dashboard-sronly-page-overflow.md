# dashboard-sronly-page-overflow: .sr-only top/left fix removes document-level scroll overflow on dashboard pages

- id: dashboard-sronly-page-overflow
- status: verified
- verified_by: atlas:verifier
- verified_at: 2026-10-06T22:36:49+00:00

## Evidence
- plugins/atlas/scripts/dashboard_ui/css/base.css:51-54 .sr-only {position:absolute; top:0; left:0}
- sr-only uses in js: components.js:70 span, components.js:146 caption, pages/overview.js:20 span, pages/work.js:160 span inside button, pages/work.js:168 span inside label; none focusable
- live http://127.0.0.1:7421/: scrollHeight===innerHeight on #/overview 1208/1208 (.main scrollHeight 1766, 17 .sr-only) and #/work 1208/1208 (.main 1161, 232 .sr-only). Caveat: browser.open ran in cmux browser at 1482x1208, not managed headless Chromium 1440x900 (relay/cmux override)

## Reproduction
browser.open(url=http://127.0.0.1:7421/#/overview|#/work); evaluate [document.documentElement.scrollHeight, innerHeight]

## Proposed fix
none recorded

## Doc refs
- plugins/atlas/CHANGELOG.md [10.1.2] Fixed

## History
- no earlier verdicts
