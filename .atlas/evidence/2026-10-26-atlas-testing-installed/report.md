## Test evidence
- Date / target: 2026-10-26 / plugins/atlas/hooks
- Detect: languages=python (65 files), shell (1 file) frameworks=none test_tools=unittest (unit; evidence test_atlas_contract.py) ci=none
- Gaps (top): ci-pipeline@ci, must; static-lint@python, must; sca@security, must; secrets@security, must; static-lint@shell, must; unit@shell, must (python/unit = present)
- Commands run:
  - `python3 "<skill>/scripts/testscope.py" commands --root plugins/atlas/hooks --format json` -> exit 0, emitted [{tool: unittest, type_id: unit, command: "python3 -m unittest discover"}]
  - `python3 -m unittest discover` (cwd plugins/atlas/hooks) -> exit 0, Ran 1589 tests in 97.843s, OK (passed 1589 / failed 0 / skipped 0; no skipped line printed)
  - `python3 "<skill>/scripts/testscope.py" gaps --root plugins/atlas/hooks --format md` -> exit 0, 22 rows
- New tests: none; sensitivity proof: n/a (run and gaps modes only, no authoring)
- Mutation (if run): not run
- Flakes: none observed (single run, no reruns, quarantine count 0)
- Not recommended: mutation/coverage-chasing not pursued: this is a run/gaps validation, not an authoring pass
- Evidence dir: .atlas/evidence/2026-10-26-atlas-testing-installed/
- Next test: static-lint@python (ruff, lang-python.md:19); ci-pipeline is ranked first by the pipeline-dependency override (selection-and-gaps.md:91) but no CI config exists under the hooks root, so lint is the actionable next step. Regulated rows (authz, data exposure, audit, encryption, calculation) not applicable to this target; testscope raised none.

Contract injected at top of skill body on installed copy: YES (both invocations: "Apply the Operating Contract to this entire task" followed by the full contract text).

## References read
taxonomy.md, workflow.md, lang-python.md, selection-and-gaps.md, types-functional.md (lines 1-60, unit trigger). Not read (no trigger): types-test-quality, types-mutation, types-input-generation, types-nonfunctional, types-security, data-sql, infra, docs.

## Followed as written
- Skill invoked with args `plugins/atlas/hooks run` then `plugins/atlas/hooks gaps` (SKILL.md Arguments).
- Phase-table reads: taxonomy.md (phase 1), selection-and-gaps.md (phase 2), workflow.md (phase 3) (SKILL.md table and Mandatory reads).
- Python language file read because python detected (SKILL.md Mandatory reads, last row).
- run mode: ran `testscope commands --root plugins/atlas/hooks` and executed its emitted command verbatim (SKILL.md Arguments `run` row; workflow.md:86).
- gaps mode: ran `testscope gaps --format md`, saved table verbatim (selection-and-gaps.md:112-113).
- Filtered/ordered by priority and read reasons (selection-and-gaps.md:104-109).
- Evidence block fields all filled (workflow.md:127-142); files in evidence dir (workflow.md:150).
- Exit status recorded as verdict (SKILL.md Hard rules).
- Skipped-count rule (workflow.md:148): no skipped count printed by unittest OK line; reported 0 skipped.

## Instruction gaps
1. Working directory for the emitted command: `testscope commands --root X` emits bare `python3 -m unittest discover` with no `-s`/cwd. SKILL.md Arguments `run` row and workflow.md:86 do not say to run it from the --root directory. I chose cwd=plugins/atlas/hooks (inference). Running from repo root would discover nothing relevant. Minor; fix: emit `cd <root> &&` or `-s <root>`, or state "run from --root".
2. workflow.md:126 report block says "Evidence dir ... <slug>" and files "named by phase (01-detect.log ...)" (workflow.md:151); the dispatch asked for different names (run-commands.json etc.). Not a skill defect; noted only.
3. gaps output shows `shell/unit missing must` for a single shell file and `ci-pipeline must` with no CI under --root; the skill gives no instruction for scope-limited roots (selection-and-gaps.md:109 says downgrade on mismatch but gives no rule here). I reported rows unchanged.
Otherwise none.
