# reverify-mod-routes-fixed: ROUTE: SCOPE-less in-process dispatches now yield a -/- row (closes rejected reverify-mod-routes)

- id: reverify-mod-routes-fixed
- status: verified
- verified_by: lead
- verified_at: 2026-11-10T10:25:17+00:00

## Evidence
- plugins/atlas/mod/data/core.test.ts:306
- bun test by verifier-49ce on the bumped tree: 3400 pass, 0 fail, 157 files

## Reproduction
cd plugins/atlas && bun test mod/data/core.test.ts mod/pane/sidebar-core.test.ts

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
