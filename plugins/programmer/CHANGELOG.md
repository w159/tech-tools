# Changelog

## 1.0.0 - 2026-10-27

Rebuilt from scratch.

- Added a deterministic Python scanner (`scripts/principles`) with 20 rules, each citing its book and tip. Text, JSON, SARIF 2.1.0 and Markdown output; config, suppression comments, baseline and `--diff` mode.
- Added fixture tests for every rule (fires on `bad`, quiet on `good`, seeded no-op check), a clean sample project, CLI tests, hook tests and docs-versus-code contract tests.
- Added the `review` skill (scanner then cited judge) and the `principles-judge` agent.
- Merged `code-principles` and `tpp-principles` into the `principles` advisor skill.
- Added an opt-in PostToolUse hook (`PROGRAMMER_SCAN_ON_EDIT=1`).
- Removed the `code-review` skill, which dispatched 6 agents that did not exist; the `tpp-audit` skill; the `tpp-auditor` agent, whose frontmatter was invalid YAML; the unwired nudge hook; and the `Books` gitlink, which had no `.gitmodules`.
- Fixed the book count (30, not 31) and manifest claims of 7 agents and a nudge hook.
- Tuned against pallets/click and psf/requests: fewer false positives in ERR001, RES001, FN002 and LIT001; DRY001 about 3x faster; deterministic finding order. Evidence: docs/audits/2026-10-27_programmer-1.0.0-evidence.md.
