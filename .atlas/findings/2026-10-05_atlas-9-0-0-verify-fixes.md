# atlas-9.0.0-verify-fixes: atlas 9.0.0: the four problems in verifier row atlas-9.0.0-verify are fixed and re-demonstrated; the verifier did not re-run

- id: atlas-9.0.0-verify-fixes
- status: verified
- verified_by: orchestrator (self re-check of verifier findings; not an independent agent)
- verified_at: 2026-10-05T15:42:23+00:00

## Evidence
- orphan test: mutation copy (atlas-audit/SKILL.md minus lens-set.md, references/ still mentioned) -> 1 failed naming atlas-audit/references/lens-set.md; real tree -> 35 passed
- dispatch templates restored: atlas-optimize/references/verifier-brief.md:25-28 and atlas-plan/references/handoff.md:17-18 carry ${CLAUDE_PLUGIN_ROOT}/skills/... paths again (verifier-brief is byte-identical to HEAD)
- hooks-automation.md:44-49 now uses ${CLAUDE_PLUGIN_ROOT}/scripts/install_hooks.py; /tmp/run_install_hooks_list.sh ran the SOURCE-tree script (plugins/atlas/scripts/install_hooks.py), exit 0. Three earlier ad-hoc --list runs hit the omp 8.6.0 cache read-only (nothing written); they are not the proof.
- counts re-measured vs HEAD with a YAML parser: old total 29074 (was 29077), atlas-pov 1518 (was 1521), docs-curator 579 (was 581); conformance module 35 tests; changelogs and README corrected
- post-fix full run: bun test 245 pass 0 fail; pytest hooks+scripts 1887 passed 3 skipped; lint_skill_names and lint_docs_names clean; manifests parse

## Reproduction
cd plugins/atlas && python3 -m pytest -q hooks scripts && (cd omp && bun test)

## Proposed fix
none outstanding; live-omp verification of the omp fixes is NOT done and is tracked in docs/ROADMAP.md

## Doc refs
- none

## History
- no earlier verdicts
