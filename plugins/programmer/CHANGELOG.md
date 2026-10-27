# Changelog

## 1.0.1 - 2026-10-27

Fixes from the review of PR #49, which merged before they landed.

### Fixed

- DRY001 no longer crashes on Python 3.9 (`bisect` `key=` needs 3.10).
- `--diff` handles non-ASCII and space-containing paths, user git config (prefixes, external diff), single-file targets and untracked files with spaces (NUL-separated `ls-files`); refs starting with `-` are rejected.
- A suppression comment with a malformed bracket list suppresses nothing, rule ids match case-insensitively, and a trailing comment on the previous line no longer suppresses the next line.
- Baseline fingerprints carry an occurrence index, so a new identical copy of a baselined finding is reported; a malformed baseline exits 2 with a message.
- Parse errors now exit 2 and appear in SARIF `invocations[0].toolExecutionNotifications`.
- The edit hook always exits 0 on malformed input and loads config from the project root.
- Corrected the concept path in `pragmatic-profile.md` and `LICENSE`.

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
