# verify-atlas-8.3.0-docs-propagation-2026-10-01: Atlas 8.3.0: delegation mandate and native tool routing documented for Claude Code and omp

- id: verify-atlas-8.3.0-docs-propagation-2026-10-01
- status: verified
- verified_by: DocsPropagation
- verified_at: 2026-10-01

## Evidence
- plugins/atlas/CHANGELOG.md: new 8.3.0 section above the unchanged 8.2.0 turn-scoring text
- plugins/atlas/.claude-plugin/plugin.json version 8.3.0; .claude-plugin/marketplace.json version 4.1.0 with atlas pinned to 8.3.0
- plugins/atlas/README.md: thirteen-condition Stop gate, flag-independent condition (m), native Grep/Glob deny, one-time Read/Bash nudge, and omp extension install command
- Upstream verification supplied for this documentation stage: cd plugins/atlas && python3 -m pytest hooks/ scripts/ -q -> 1598 passed, 3 skipped
- Upstream omp verification supplied for this documentation stage: bun test plugins/atlas/omp/index.test.ts -> 18 pass
- Documentation-stage verification: cd plugins/atlas && python3 -m pytest hooks/test_atlas_contract.py -q -> 87 passed, 3 skipped, 62 subtests passed in 4.31s; InstalledParityContract skips because atlas is not installed at the manifest version
- Upstream subprocess smoke supplied for this documentation stage: (m) blocks an unflagged run and clears after a Task dispatch; Grep/Glob denied; Read nudges once then stays silent

## Reproduction
cd plugins/atlas && python3 -m pytest hooks/test_atlas_contract.py -q

## Proposed fix
none recorded

## Doc refs
- docs/CHANGELOG.md
- plugins/atlas/CHANGELOG.md
- plugins/atlas/README.md

## History
- no earlier verdicts
