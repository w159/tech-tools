# atlas-audit and atlas-testing proof run (2026-10-26)

## Purpose

The user had little faith that the `atlas-audit` and `atlas-testing` skills work. This run exercised both on this tree, fixed what failed, and recorded what was and was not proven. Changes are uncommitted in source. Dependency notes: `.atlas/.run/proof-2026-10-26/audit-deps.md`.

## Proven vs assumed

| Claim | Verdict | Evidence |
|---|---|---|
| atlas-audit Phase 1 works without graphify, security-review, codeql, quality-playbook | proven (fallbacks) | None of the four ships in `plugins/atlas/skills`; fallbacks added in `atlas-audit/SKILL.md` |
| `build_hub.py` runs with no graph.json | proven | exit 0, `node_id` null |
| `atlas_finding.py` commands in the skill are valid | was missing, fixed | the skill text named the script but showed no invocation; the flat argparse CLI's verified and rejected forms are now literal in `references/output-format.md` |
| Act-mode hub glob finds existing audits | was false, fixed | old glob `docs/audits/atlas-*-*/hub/manifest.json` never matched `2026-07-17_atlas-audit` |
| "```!" operating-contract injection works on Claude Code | proven | lead invoked atlas-refactor via the Skill tool; contract text appeared |
| Workflow `agent()` options match `references/workflow-template.md` | proven | label, phase, schema, model, effort, isolation:'worktree', agentType all supported; no change |
| atlas-audit Phases 2-4 (swarm, synthesis, hub) live | assumed | not run; see ROADMAP |
| testscope detects and runs unittest suites | proven after fix | `commands --root plugins/atlas/hooks` emits the discover command; `-s scripts` command ran 21 tests OK |
| atlas-testing write and mutate flow | proven | `.atlas/evidence/2026-10-26-atlas-testing-live/` |

## Defects found and fixed

| Defect | File | Fix | Test |
|---|---|---|---|
| Dead skill name `atlas-work` | `plugins/atlas/skills/atlas-plan/SKILL.md` (3 lines), `references/handoff.md` (1 line) | reworded | `test_skill_agent_conformance.py:333` |
| No guard for dangling skill names | `plugins/atlas/scripts/test_skill_agent_conformance.py:159` | allowlist of 12 optional externals plus detector | `:333`, `:921` |
| audit skill assumed absent skills | `plugins/atlas/skills/atlas-audit/SKILL.md` | "when installed ... else" fallbacks | conformance suite |
| Hub glob never matched | `atlas-audit/references/act-on-finding.md` | `docs/audits/*atlas-audit*/hub/manifest.json`, newest by mtime | live listing |
| audit skill lacked tools and contract fence | `atlas-audit/SKILL.md` | AskUserQuestion, Workflow in `allowed-tools`; fence added | conformance suite |
| testscope ignored unittest | `plugins/atlas/skills/atlas-testing/scripts/testscope.py:351,604,1050` | `detect_unittest`, `command_rows` branch | `test_testscope.py:388,402` |
| commands.md output lacked backtick wrap | `testscope.py` | wrapped with header | `test_testscope.py:375` |
| Six atlas-testing instruction defects | `atlas-testing/SKILL.md`, `references/workflow.md`, `types-mutation.md`, `lang-python.md` | see CHANGELOG 2026-10-26 | `report.md` in evidence dir |
| ATLAS_* env leaks into 3 tests | `test_atlas_control.py:67-76`, `test_typesafe_client.py:47` | `setUp` scrubs env | the 3 baseline failures now pass with ATLAS_* unset |

## Suite numbers

- Baseline: hooks Ran 1589 OK (skipped=3); scripts Ran 2255 FAILED (failures=3, env leak); omp `bun test` 486 pass; dashboard_ui `bun test` 154 pass.
- Final suites after the change (lead-run, same tree): hooks Ran 1589 OK (skipped=3), exit 0; scripts Ran 2257, exit 0, zero FAIL or ERROR lines; `test_skill_agent_conformance` Ran 40 OK; `test_testscope` Ran 21 OK.

## Mutation summary

mutmut via uvx on a scratch copy of `testscope.py`: 2948 mutants, 804 killed, 1787 survived, 357 no tests, score 31.0%. Survivors concentrate in `command_rows`, `detect_misc_files`, `_collect`, `baseline_rows`, `detect_terraform`, `detect_workflows`. Detail: `mutate-results-full.txt` in the evidence dir.

## Open follow-ups

Tracked in `docs/ROADMAP.md` under "Audit and testing proof follow-ups (2026-10-26)": graphify vendoring, `--root .` hiding unittest suites, mutation score, 10 skills without the contract fence, full audit swarm run, P6-env-scrub stamp.
