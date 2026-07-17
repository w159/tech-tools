# Evidence: atlas canonical structure scaffolding + enforcement

Date: 2026-07-17
Change: expand the atlas canonical project structure (docs-ssot.md), make
atlas-setup scaffold/repair the full tree, and align every skill/agent/hook.

## Independent verifier results (fresh context, real commands)

Suite runs:
- `python3 plugins/atlas/skills/atlas-setup/scripts/test_scaffold_docs.py` -> 13 assertions pass, exit 0, "OK: full docs/ + .atlas/ + root canonical structure is in place."
- `python3 -m pytest plugins/atlas/hooks/test_session_boot.py plugins/atlas/hooks/test_completion_gate.py plugins/atlas/scripts/test_skill_agent_conformance.py -q` -> 99 passed, 0 failures.

End-to-end scaffold (throwaway `git init` temp dir), run twice:
- First run exit 0; tree contains root README.md/AGENTS.md/CLAUDE.md/.gitignore; docs/ CHANGELOG.md+ROADMAP.md+AGENTS.md + 7 base subfolders (architecture, decisions, plans, specs, features, lessons, wiki); .atlas/ with 11 entries (evidence, findings, audits, decisions, archive, understand-anything, graphify, self-improvement, memory, nudge, .run) + .atlas/CLAUDE.md + .atlas/AGENTS.md.
- Second run exit 0, every line "keep existing:", zero `^seeded:` lines (idempotent, no false re-seed).
- API adaptivity: docs/api absent with no API signal; created when a routes/ dir or openapi file is present.

Zero-trust .gitignore (git check-ignore -q exit codes in the scaffolded repo):
- docs/CHANGELOG.md -> 1 (NOT ignored)
- .atlas/evidence/.gitkeep -> 1 (NOT ignored)
- .atlas/.run/STATE.md -> 0 (ignored)
- .atlas/.run/findings.json -> 1 (NOT ignored, re-allowlisted durable ledger)
- .env -> 0 (ignored)

Reference consistency:
- scaffolding.md and session-lifecycle.md: zero matches for docs/evidence, docs/.run, docs/runs/; .atlas/archive and .atlas/.run/findings.json present.
- `diff` of the two docs-ssot.md mirrors: empty (byte-identical).

Regression found and fixed this session:
- atlas-setup/SKILL.md carried a dead `references/docs-ssot.md` link (M16 pattern);
  test_no_dangling_skill_references failed. Reworded to a descriptive pointer;
  conformance suite now 13/13.

Pre-existing, unrelated (out of scope): test_skill_factory.py::test_cli_auto
(KeyError 'created' with no DB); skill_factory.py was not touched this session.
