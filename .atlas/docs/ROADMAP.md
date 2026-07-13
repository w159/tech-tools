# ROADMAP

Everything still to be done. This is the backlog with status. atlas-setup
seeds this file on first scaffold; atlas-orchestrate and the task skills update it
as work lands.

## Status legend

- `planned` - not started
- `active` - in progress
- `blocked` - waiting on a dependency or decision
- `done` - shipped and verified (move the entry to CHANGELOG.md)

## Zero-defect loop (atlas:docs-curator, 2026-07-12)

| ID | Status | Batch | Task | Notes |
|----|--------|-------|------|-------|
| Z1 | done | Batch 1 | 5 HIGH defects (atlas_db, atlas_context_optimizer, auto_skill, memory_capture, operating-contract promotion) | verifier: CONFIRMED. See CHANGELOG 2026-07-12. |
| Z2 | done | Batch 2a | 6 MEDIUM hook defects (M1-M8: completion_gate, dispatch_tripwire, session_boot, memory_capture, nudge, bash_advisor) | verifier: CONFIRMED. New test_bash_advisor.py. |
| Z3 | done | Batch 2b | 7 MEDIUM script defects (M10-M22: scaffold_docs, skill_factory, atlas_curator, atlas_context_optimizer, session_ingest, install_hooks, atlas_doctor) | verifier: CONFIRMED. New test_scaffold_docs.py, test_session_ingest.py, test_install_hooks.py; extended test_atlas_doctor.py. |
| Z4 | done | Batch 2c | Skill-reference conformance (M16-M18: 4 dangling refs resolved, session-lifecycle disambiguated, 7 bare script refs prefixed) | verifier: CONFIRMED. Extended test_skill_agent_conformance.py. |
| Z5 | done | lint-zero | ruff 23 -> 0 across hooks + scripts | verifier: CONFIRMED. Behavior-preserving import/var cleanup. |
| Z6 | done | Batch 3a | Fix broken YAML frontmatter (missing closing ---) on 10 skills + add test_valid_frontmatter | verifier: CONFIRMED. See CHANGELOG 2026-07-13. Evidence: .atlas/docs/evidence/batch-3a-verification.md. |
| Z7 | done | Batch 3b | Pyright type cleanup | verifier: CONFIRMED. pyright 0/0/0. Evidence: .atlas/docs/evidence/batch-3b-verification.md. |
| Z8 | done | Batch 4 | Coverage to 85/85/75/85 on hooks/ and scripts/ (final: 98% hooks / 99% scripts) | verifier: CONFIRMED. Exceeded bars. Sub-batches 4a-1/4a-2/4b-1/4b-2 + pyright-cleanup. Evidence: .atlas/docs/evidence/batch-4a-1/4a-2/4b-1/4b-2-verification.md, pyright-cleanup-verification.md. |
| Z9 | done | dry rounds | atlas:completeness-critic rounds until K=3 consecutive clean | verifier: CONFIRMED. K=3 clean + bars met. See CHANGELOG 2026-07-13. |


## Live action items

| ID | Status | Item | Notes |
|----|--------|------|-------|
| L1 | active | Marketplace plugin 5.0.0 is stale vs the working tree | The installed marketplace atlas plugin (5.0.0) lags the verified working tree. Run `/reload-plugins` (or reinstall) so the live Stop hook executes the fixed `.atlas/docs`-resolving completion_gate. Coverage and test fixes are inert in the live agent until this reload lands. |

## Backlog (skills-mastery-rebuild)

| ID | Status | Skill | Task | Notes |
|----|--------|-------|------|-------|
| (none active) | | | | All skills-mastery-rebuild items are done. |

## Done (moved to CHANGELOG.md)

- S1 olympus rebuild, S2 gate flips, S3 batch A, S4 batch B, S5a batch C-1,
  S5b batch C-2, S6 atlas-wiki producer, olympus-cleanup. All verified by a
  fresh atlas:verifier. See CHANGELOG.md 2026-07-11 entry.
- S7 armada all 11 departments: design, productivity, data, it-ops,
  support, finance, hr, security, engineering, m365, product. All
  CONFIRMED by per-department verifier. See CHANGELOG.md 2026-07-11
  completion entry.
- S8 .atlas/docs scaffold: 12/12 folders verified. See CHANGELOG.md
  2026-07-11 completion entry.
- S10 completeness critic and final docs reconcile: security audit-rubric
  directive (3 SKILL.md), engineering Sentry allowed-tools (5 skills),
  manual-vs-auto-map.md atlas-wiki update, metis em-dash fix. All
  verified. 9 reserved placeholder dirs documented (3 hr, 5 finance,
  1 engineering), not deleted (Law 6).
- Z1-Z5 zero-defect loop batches 1, 2a, 2b, 2c, lint-zero. All verifier
  CONFIRMED 2026-07-12. See CHANGELOG.md 2026-07-12 entry.
- Z6-Z9 zero-defect loop batches 3a, 3b, 4 (4a-1/4a-2/4b-1/4b-2), pyright-cleanup, dry-rounds. All verifier CONFIRMED 2026-07-13. Coverage 17%->98% hooks / 63%->99% scripts; 495->867 tests; ruff + pyright 0. See CHANGELOG.md 2026-07-13 entry and .atlas/docs/evidence/.

## Notes

- Move done items to CHANGELOG.md, do not leave them here.
- A blocked item must name its blocker in Notes.
- The skills-mastery-rebuild run is complete. The zero-defect loop is
  COMPLETE: Z6-Z9 verified 2026-07-13, K=3 dry rounds pass, coverage bars met.
  Remaining live item L1 (marketplace plugin 5.0.0 stale - /reload-plugins).