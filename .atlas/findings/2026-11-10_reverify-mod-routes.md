# reverify-mod-routes: dispatchRoutes drops SCOPE-less dispatches: no ROUTE row with '-' and sidebar says 'no team this session' despite dispatches

- id: reverify-mod-routes
- status: rejected
- verified_by: atlas:verifier
- verified_at: 2026-11-10T09:18:10+00:00

## Evidence
- plugins/atlas/mod/data/core.ts dispatchRoutes (SCOPE_RE continue); /tmp/reverify/probe.test.ts prints NOSCOPE rows= 0

## Reproduction
bun test /tmp/reverify/probe.test.ts

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
