# rootcause-lead-only-anim: Lead-only turns animate nothing: tick gated on liveWorkers since 298d4895

- id: rootcause-lead-only-anim
- status: verified
- verified_by: atlas:verifier
- verified_at: 2026-11-12T13:00:08+00:00

## Evidence
- plugins/atlas/mod/register.ts:1030; git show 298d4895 restyle.tsx; round2/after/live-150-4b5b5a94-1 frames f0074-f0090

## Reproduction
git show 298d4895 -- plugins/atlas/mod/restyle.tsx; glyph scan of frames f0070-f0090

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
