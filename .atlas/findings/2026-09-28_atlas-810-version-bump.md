# atlas-810-version-bump: plugin.json + marketplace.json version bump 8.0.1 -> 8.1.0

- id: atlas-810-version-bump
- status: verified
- verified_by: VerifyAtlas810
- verified_at: 2026-09-28T13:23:10+00:00

## Evidence
- plugins/atlas/.claude-plugin/plugin.json line 3: `"version": "8.1.0"`
- root .claude-plugin/marketplace.json atlas entry line 50: `"version": "8.1.0"`
- independently re-grepped by verifier (VerifyAtlas810 claim 1): CONFIRMED

## Reproduction
grep -n '"version"' plugins/atlas/.claude-plugin/plugin.json && grep -n -A2 '"atlas"' .claude-plugin/marketplace.json

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
