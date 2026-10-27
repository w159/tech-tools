# verify-atlas-8.4.0-docs-propagation-2026-10-01: Atlas 8.4.0: colony board safety, dispatch tripwires, and native omp agents documented

- id: verify-atlas-8.4.0-docs-propagation-2026-10-01
- status: verified
- verified_by: DocsPropagation
- verified_at: 2026-10-01

## Evidence
- plugins/atlas/CHANGELOG.md: new 8.4.0 section above the unchanged 8.3.0 text (board safety, notes channel, dispatch tripwires, native omp agents)
- plugins/atlas/.claude-plugin/plugin.json version 8.4.0; .claude-plugin/marketplace.json version 4.2.0 with atlas pinned to 8.4.0
- plugins/atlas/README.md: directory-form omp extension load (omp --extension <abs>/plugins/atlas/omp), dispatch_tripwire row with the model-override and name-required atlas:* denies plus the CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 exception, and a Colony work section (board locking, worktree resolution, notes CLI, ${CLAUDE_PLUGIN_ROOT} resolution caveat, no per-subagent thinking setting)
- plugins/atlas/omp/README.md already matches the 8.4.0 facts: directory-form install, todo mirror, CLAUDE_PLUGIN_ROOT factory default, notes CLI, and the @smol/@default model fallbacks
- Upstream verification supplied for this documentation stage: cd plugins/atlas && python3 -m pytest hooks/ scripts/ -q -> 1625 passed, 3 skipped, 0 failed
- Upstream omp verification supplied for this documentation stage: bun test plugins/atlas/omp -> 35 pass, 0 fail
- Upstream real omp runs supplied for this documentation stage: notes CLI exit 0 with env unset at launch; todo mirror held the lead's items pending -> completed; verifier tier resolved to the default model at :medium; unconfigured worker role fell back to @smol
- Upstream board smoke supplied for this documentation stage: a note written from inside a worktree landed on the main repo's board; 8 processes racing for 40 items produced exactly 40 claims

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
