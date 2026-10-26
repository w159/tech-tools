# skill-paths-deoverlap-frontend-component: atlas-frontend and atlas-component SKILL.md paths: globs no longer share identical literal entries; both used to co-activate on every .tsx edit

- id: skill-paths-deoverlap-frontend-component
- status: verified
- verified_by: orchestrator-test-run
- verified_at: 2026-09-28T11:49:24+00:00

## Evidence
- atlas-component paths narrowed to ["components/**"]; atlas-frontend paths now ["**/*.tsx", "**/*.css", "**/*.scss"]
- plugins/atlas/hooks/test_atlas_contract.py SkillPathsContract.test_no_two_skills_share_identical_paths_globs added, fleet-wide (all skills/*/SKILL.md with a paths field)
- doc grounding: agentscamp.com SKILL.md frontmatter reference / anthropics/claude-code#39105 -- paths is a real glob-matching auto-activation field
- python3 -m unittest discover -s plugins/atlas/hooks -p test_atlas_contract.py -> 88 tests, 1 pre-existing failure (install-cache parity)

## Reproduction
python3 -m unittest plugins.atlas.hooks.test_atlas_contract.SkillPathsContract

## Proposed fix
none recorded

## Doc refs
- https://agentscamp.com/guides/skills/skill-md-reference

## History
- no earlier verdicts
