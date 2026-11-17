# atlas-todo-board-test-leak-2026-11-17: Test-suite board leak fixed: a prompt_optimizer test scaffolded six phantom plan rows into the LIVE project board (the string was a test fixture, no user request existed) - atlas_todo.save now refuses any test-isolated write to the checkout board

- id: atlas-todo-board-test-leak-2026-11-17
- status: verified
- verified_by: lead
- verified_at: 2026-11-17T19:17:48+00:00

## Evidence
- plugins/atlas/scripts/atlas_todo.py save() -> _refuse_test_write_to_checkout (raises when _ATLAS_TEST_ISOLATED_ROOT is set and the board path is inside the source checkout)
- plugins/atlas/hooks/test_prompt_optimizer.py PlanUpfrontBoardIsolationTest: 2 tests, fails on HEAD atlas_todo.py (AssertionError: plan rows landed on the board) and passes after
- live board .atlas/.run/todos.json sha256 unchanged across a full test_prompt_optimizer.py run (154213419725fb386b933d192b82dd57c4032c406a366d846e824c064e513d55 before and after)
- suites: prompt_optimizer 151 passed; test_atlas_contract 118 passed 3 skipped 142 subtests; scripts 6325 passed with 1 pre-existing failure; hooks 3276 passed with 2 pre-existing failures - all 3 identical on a pristine HEAD archive

## Reproduction
cd /Users/jerry/MEGA/Projects/Agentic/tech-tools/plugins/atlas/hooks && /Users/jerry/MEGA/Projects/Agentic/tech-tools/.venv/bin/python -m pytest test_prompt_optimizer.py::PlanUpfrontBoardIsolationTest -q

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
