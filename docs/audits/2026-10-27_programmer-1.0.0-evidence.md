# programmer 1.0.0: before and after evidence

Date: 2026-10-27. Branch: claude/programmer-rebuild-principles. Base: main 9c20c37 (programmer 0.2.1).

## Before (0.2.1)

| Check | Result |
|---|---|
| `code-review` skill | Dispatched 6 `code-review-*` agents that did not exist; only `tpp-auditor` shipped. |
| `tpp-auditor.md` | Frontmatter failed `yaml.safe_load` ("mapping values are not allowed here"). |
| Manifests | Claimed 7 agents and a nudge hook; `hooks.json` was `{}`. |
| `books.md` | Said 31 books, listed 30. |
| `plugins/programmer/Books` | Gitlink (mode 160000) with no `.gitmodules`. |
| Tests | 7, all for a hook that was not wired. |
| Headless `/programmer:code-review` on a seeded file, run 1 | 22 findings, $0.41, 70s, ran inline because the agents were not registered. |
| Same, run 2 | 44 findings, $1.09, 79s. Different results from the same input. |
| Seeded violations missed by both runs | 8-parameter signature, 4-level nesting, 4-link message chain, mutated module global. |

## After (1.0.0)

Scanner on the same seeded file:

```
$ python3 plugins/programmer/scripts/principles scan seeded/src/orders.py
14 findings (2 error, 8 warning, 4 note), exit 1, 0.11s
SEC001 :13  ERR001 :28  CFG001 :4  FN002 :10  RES001 :11  FN004 :19 :39
DEM001 :30  STATE001 :31  DRY001 :34  LIT001 x4
```

All four violations the old skill missed are reported. Same input, same output on every run.

| Surface | Command | Result |
|---|---|---|
| Unit tests | `cd plugins/programmer && python3 -m unittest discover -s tests -v` | 33 tests OK |
| Plugin validator | `claude plugin validate plugins/programmer` | Passed (icon warning only) |
| Frontmatter | `yaml.safe_load` on the agent and both skills | OK |
| Review skill, scanner only | `claude -p "/programmer:review src/orders.py --no-judge" --plugin-dir plugins/programmer` | 14 findings, $0.34, 27s; `${CLAUDE_PLUGIN_ROOT}` resolved |
| Review skill with judge | `claude -p "/programmer:review src/orders.py" --plugin-dir plugins/programmer` | 14 detected + 7 judged, 0 disputed, $0.32; judge found the SQL row used as an object (`user.address` on a tuple) |
| Edit hook | `PROGRAMMER_SCAN_ON_EDIT=1 claude -p "...write q.py..." --include-hook-events` | PostToolUse returned `q.py:2 SEC001 ...` as additionalContext; Claude quoted it back |

Tests cover: each of the 20 rules fires on its `bad` fixture and is quiet on its `good` fixture; each check replaced with a no-op makes its fixture test fail; a clean sample project has zero findings; CLI exit codes, JSON and SARIF shape, suppression, config, baseline, diff mode and error paths; the hook; and docs-versus-code contracts (counts in manifests and README, skills dispatch only agents that exist, no gitlink, hook paths exist). SARIF output was validated against the OASIS 2.1.0 schema.

## Real repositories

Shallow clones: pallets/click 2247b35, psf/requests 3c7baaa. Command: `python3 -I plugins/programmer/scripts/principles scan <repo> --format json --fail-on never`.

| Repo | First run | After tuning | Time first / after |
|---|---|---|---|
| click (91 files) | 345 | 298 (17 error, 208 warning, 73 note) | 12.4s / 4.6s |
| requests (37 files) | 184 | 114 (0 error, 70 warning, 44 note) | 3.0s / 1.9s |

False-positive classes found by reading the flagged code, each fixed with a test that fails without the fix:

| Rule | Case | Fix | Removed |
|---|---|---|---|
| ERR001 | `except Exception: pass` inside `__del__` (click `_compat.py:77`) | Skip `__del__` | 1 |
| ERR001 | `except Exception: return False` probe reported as "failure disappears" | Separate message for fallback handlers; still an error | 0 (message only, 10 findings) |
| RES001 | `open(path, mode).close()` (click `utils.py:141`) | Skip a resource closed in the same expression | 2 |
| FN002 | pytest test functions and fixtures with injected parameters | Skip `test_*` and `@fixture` functions in test paths only | 26 |
| LIT001 | Numbers in module-level tables (requests `status_codes.py`, click ANSI color table) | Module-level dict, list, tuple and set literals name their numbers | 88 |

Speed: DRY001 re-tokenized each file once per function. Tokens are now cached per module; output was byte-identical to the old algorithm under a fixed hash seed. Finding order now includes the message, so output is byte-identical across hash seeds (checked with 3 seeds on click).

Final counts per rule:

| Rule | click | requests |
|---|---|---|
| ARCH002 | 1 | 0 |
| CQS001 | 1 | 0 |
| DRY001 | 58 | 12 |
| ERR001 | 17 | 0 |
| FN001 | 16 | 8 |
| FN002 | 42 | 9 |
| FN003 | 35 | 4 |
| FN004 | 9 | 6 |
| FN005 | 30 | 13 |
| LIT001 | 72 | 35 |
| OO001 | 7 | 7 |
| OO002 | 3 | 0 |
| RES001 | 4 | 10 |
| STATE001 | 2 | 1 |
| WIN001 | 1 | 9 |

Hand-checked examples that hold up: click `core.py:1065` `__init__` with 12 parameters; click `_compat.py:518` import cycle `_compat -> _winconsole -> _compat`; click `core.py:1252` `get_help_option` pops from `self.params`; requests `cookies.py:310` `list_paths` repeats 97% of `list_domains`; requests `sessions.py:186` `resolve_redirects` at complexity 15 and 51 statements.

Known noise left in place: FN001 and OO001 fire on long test functions and test classes (requests `TestRequests` has 186 methods); DRY001 reports identical small `__init__` bodies across unrelated classes. Use `--no-tests`, config thresholds or suppression comments.
