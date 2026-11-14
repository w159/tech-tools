# Changelog

## 1.0.5 - 2026-11-14

### Fixed

- LIT001: the octal check no longer re-splits the file per literal. An 8000-line file scans in 1 s instead of 44 s, so the edit hook stays inside its timeout.
- CFG001: loopback and test-only hosts, documentation links (`docs_url`, `install_cmd`) and env/config fallback defaults are no longer reported as hardcoded endpoints. 84% of findings on the atlas corpus were false positives before; findings went from 25 to 6.
- SEC001: string constants, loops over literal table or column tuples, constant if/else values and joins of constant tuples are no longer reported as SQL built from strings (70 to 42 findings).
- DEM001: str/dict value methods and `unittest.mock` attributes no longer count as message-chain links (15 to 0 findings, all false before).
- WIN001: flags only marker comments (leading or tagged TODO/FIXME/HACK/XXX, not prose) and treats `print()` in `#!` scripts as program output. On the Atlas corpus WIN001 findings drop from 14 (all false) to 0. 2 tests failed before; 126 pass after.

## 1.0.4 - 2026-11-14

### Fixed

- The edit hook reports only the error-level findings an Edit or MultiEdit introduced; before, every finding already in the file was sent back after each edit. A Write, or an edit the hook cannot place, still reports all of them. A crash in the hook now prints its error instead of failing silently.
- SEC001 no longer flags interpolated ints or `?` placeholder lists, and now also flags `os.system`/`os.popen` and `subprocess(..., shell=True)` with a non-constant command, `eval`/`exec` on a non-literal, `pickle`/`marshal` loads, `yaml.load` without a SafeLoader, and `verify=False` on HTTP calls.
- STATE001 flags mutable (list, dict, set) default arguments.
- RES001 accepts a resource assigned to a name and then entered with `with name:`.
- LIT001 skips octal `0o` mode masks. DRY001 no longer reports a block nested inside another reported duplicate.
- Still 20 rules; no rule id added or removed. Tests: 108 passed, 83 subtests (was 92).

## 1.0.3 - 2026-11-03

### Fixed

- `--diff` no longer drops findings after a `++ ` line.
- SEC002 catches walrus assignments, tuple unpacking and long uppercase secrets.
- SEC001 follows `+=` concatenation and no longer flags prose containing a SQL word.
- STATE001 counts posonly, `*args` and `**kwargs` parameters as locals.
- RES001 requires `close()` on the resource itself.

## 1.0.2 - 2026-11-02

### Fixed

- Scanner files with a BOM are scanned; FN004 depth is computed iteratively; a rule that crashes on a file is reported per file.
- Precision fixes for SEC001, SEC002, RES001, CFG001, CQS001, STATE001, ERR001, LIT001 and WIN001.
- ERR001 treats reporting methods on any receiver as handling and matches `.log` receivers by whole token; SEC001 recognises PRAGMA/EXEC/WITH/MERGE/REPLACE/TRUNCATE; WIN001 ignores `print(file=sys.stderr)`.
- Project-root test classification is shared with the hook.
- `--write-baseline` keeps exit 2 on parse errors.
- The scanner's own crash handler and baseline exit stay clean under its rules.
- `review` skill documents the exit codes; `__version__` matches `plugin.json`.

### Tests

- New `tests/conftest.py` and `tests/test_scanner_fixes.py`.

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
