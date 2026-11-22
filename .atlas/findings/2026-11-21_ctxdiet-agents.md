# ctxdiet-agents: agents withhold Artifact and armada servers; explorer omitClaudeMd; no duplicate frontmatter

- id: ctxdiet-agents
- status: verified
- verified_by: lead
- verified_at: 2026-11-21T06:37:06+00:00

## Evidence
- test_atlas_contract OK (680 tests with test_prompt_optimizer and test_dispatch_tripwire); grep -c omitClaudeMd explorer.md = 1; probe 63158 to 54674 tokens

## Reproduction
cd plugins/atlas/hooks && python3 -m unittest test_atlas_contract

## Proposed fix
none recorded

## Doc refs
- none

## History
- 2026-11-21T06:08:19+00:00 rejected by atlas:verifier: agents slice (4aca7ea2): explorer.md has duplicate omitClaudeMd key and disallowedTools list doubled
