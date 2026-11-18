# panel-split-reverify: panel-layout split is move-only: 219/219 decls identical, facade exports 58/58, no cycle, mod 4302/0 fail, omp 839/0 fail, live gate PASS, relative TS2307 0

- id: panel-split-reverify
- status: verified
- verified_by: atlas:verifier
- verified_at: 2026-11-18T08:33:56+00:00

## Evidence
- /tmp/claude-0/-home-user-tech-tools/bbfaed12-29e6-53ab-90ed-6bdf3a88b336/scratchpad/decl.js; HEAD eade1e5 plugins/atlas/mod/view/panel/*

## Reproduction
node decl.js old.ts; bun test mod; bun test omp; atlas_mod_gate.py --live --require-live; tsc TS2307 relative filter

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
