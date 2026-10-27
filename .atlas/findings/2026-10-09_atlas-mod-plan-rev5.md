# atlas-mod-plan-rev5: Atlas mod plan rev5 sprite architecture and plugin.root check

- id: atlas-mod-plan-rev5
- status: verified
- verified_by: verifier-mod-plan-rev5
- verified_at: 2026-10-09T21:19:45+00:00

## Evidence
- index.d.ts:2333 plugin root: string; :4883 FsAncestorsRequest names; :1415 ClientElements omits Client|Raster|Image; cc-arcade register.tsx AbovePrompt+terminal+!hasSurvey+viewport.columns+maxRows; common.tsx runs/maxRuns fold; doom.tsx:126 every(50)+onKey/onPointer/post; doc 597-598 wording ok; only blit refs 34,97,117 (Raster art), 118 says band independent of blit

## Reproduction
grep -n 'blit\|root: string\|ClientElements' doc + index.d.ts

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
