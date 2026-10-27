## Test evidence
- Date / target: 2026-10-26 / plugins/atlas/skills/atlas-testing/scripts (testscope.py)
- Detect: languages=python(2 files) frameworks=none test_tools=none (unittest not detected) ci=none
- Gaps (top): ci-pipeline@ci must; static-lint@python must; unit@python must (false: 17 unittest tests exist); sca@security must; secrets@security must
- Commands run:
  - `python3 plugins/atlas/skills/atlas-testing/scripts/testscope.py commands --root plugins/atlas/skills/atlas-testing/scripts --format json` -> exit 0, output `[]` (no command emitted)
  - fallback `python3 -m unittest test_testscope` (cwd scripts/) -> exit 0, 17 passed/0 failed/0 skipped (run-unittest.txt)
  - green with new test: same command -> exit 0, 18 passed (write-green.txt)
  - seeded: same -> exit 1, FAILED (failures=1) (write-seeded.txt)
  - reverted: same -> exit 0, 18 passed (write-reverted.txt)
  - final: same -> exit 0, Ran 18 tests OK
  - `uvx mutmut run` (no config) -> exit 1 FileNotFoundError; with pyproject [tool.mutmut] in scratch copy -> exit 0 (mutate.txt)
- New tests: test_testscope.py::test_commands_md_wraps_command_in_backticks_with_header; sensitivity proof: seeded fault in md_commands (removed backticks around {r['command']}), failed as `AssertionError: '| pytest | unit | `python -m pytest` |' not found in '...| pytest | unit | python -m pytest |  |...'`, reverted via git checkout, passed as `Ran 18 tests ... OK`
- Mutation: mutmut 3.8.0, killed=804, survived=1787 (+357 no-tests, 0 timeout) of 2948; survivors concentrated in command_rows (808, testscope.py:967), detect_misc_files (321, :488), _collect (195, :700), baseline_rows (107, :857), detect_terraform (106, :430), detect_workflows (86, :468); verdict needs-test for these (assert exact commands/evidence); md_*/main "no tests" = subprocess-invoked tests invisible to mutmut
- Flakes: none (not exercised; single runs)
- Not recommended: none evaluated
- Evidence dir: .atlas/evidence/2026-10-26-atlas-testing-live/
- Next test: unit@command_rows (exact command strings per detected tool; 808 survivors)

## Instruction defects
1. SKILL.md:44 and :86-ish `run` mode says use `testscope commands` output; on a unittest-only repo it emits `[]` (and `detect` reports test_tools=[]), so `run` has nothing to execute. testscope.py does not detect stdlib unittest; gaps then wrongly reports python/unit missing (run-gaps.md) though 17 tests exist. Fallback had to come from memory.
2. SKILL.md:40/:56 `--root` semantics: root must be the scripts dir to see only 2 py files; no guidance on passing a subpath vs repo root (not a defect per se, but `commands` on the parent dir also gave `[]`).
3. lang-python.md:37 / types-mutation.md:37: `uvx mutmut run` fails with exit 1 FileNotFoundError on a flat-layout module; required `[tool.mutmut] source_paths=["testscope.py"]` plus `pytest_add_cli_args_test_selection`. types-mutation.md:53-60 shows a config using `backend/` and `also_copy`, never says source_paths is mandatory or what to do for a single-file module.
4. lang-python.md:37 lists `uv add --dev mutmut`/`uv run mutmut run` as install but the Run column says `uvx mutmut run` without noting uvx uses its own interpreter (3.12 here, not the repo's 3.15) and needs pytest from mutmut's env; project deps must be importable there.
5. types-mutation.md:37 never warns that tests invoking the code under test via subprocess (CLI tests) are not traced by mutmut stats, yielding "no tests" mutants (md_commands, main); cross-ref to types-test-quality.md missing.
6. workflow.md:67-82 sensitivity proof does not say how to restore (git checkout vs backup) or that uncommitted real changes in the file make `git checkout` unsafe; I copied a backup first.
7. SKILL.md:15 and hook text reference `${CLAUDE_PLUGIN_ROOT}` for the operating-contract; not resolvable in a source-tree run (not exercised; untested).
8. Mutation result tooling: `mutmut results` prints only survivors by default (2144 lines); the reference gives no guidance on summarising per function or thresholds for a 31% score beyond "40-60 baseline" (types-mutation.md:113).
