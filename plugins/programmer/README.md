# programmer

Finds code that breaks book-derived principles, and proves each finding.

A deterministic Python scanner checks 20 detected rules taken from The Pragmatic Programmer, Clean Code, Clean Architecture, Refactoring and other books in the corpus. Each rule cites its book and tip, and fixture tests prove it fires on a seeded violation and stays quiet on clean code. A read-only model judge covers what code cannot decide (names, responsibilities, domain language, contracts, tests) and must cite the line it read.

Part of the [tech-tools marketplace](https://github.com/w159/tech-tools).

## Install

```text
/plugin marketplace add w159/tech-tools
/plugin install programmer@tech-tools
```

Developing in place:

```bash
claude --plugin-dir ./plugins/programmer
```

## What ships

| Component | Name | Purpose |
|---|---|---|
| Skill | `review` | Runs the scanner, then the judge, and writes a ranked report with `file:line`, principle, book and fix. |
| Skill | `principles` | Advisor: names the 1-4 principles that apply to the code or decision in front of you. |
| Agent | `principles-judge` | Read-only judge for one batch of files; returns strict JSON. |
| Hook | `scan_on_edit.py` | Opt-in. After an Edit or Write to a `.py` file, reports error-level findings to Claude. |
| CLI | `scripts/principles` | The scanner. Python 3.9+ standard library only (config files need 3.11+). |

## The 20 detected rules

| Rule | Severity | Title |
|---|---|---|
| DRY001 | warning | Duplicated logic (near-miss functions and repeated blocks) |
| FN001 | warning | Function too long |
| FN002 | warning | Long parameter list |
| FN003 | warning | Flag argument |
| FN004 | warning | Deep nesting |
| FN005 | warning | High cyclomatic complexity |
| ERR001 | error | Swallowed or over-broad exception |
| DEM001 | warning | Message chain (Law of Demeter) |
| STATE001 | warning | Mutable global state |
| RES001 | warning | Resource not paired with release |
| SEC001 | error | Query built from strings |
| SEC002 | error | Secret in source |
| CFG001 | warning | Hardcoded endpoint |
| ARCH001 | warning | Dependency rule violation |
| ARCH002 | warning | Import cycle |
| OO001 | warning | Large class |
| OO002 | warning | Deep inheritance |
| CQS001 | warning | Query that mutates |
| LIT001 | note | Magic number |
| WIN001 | note | Broken window (TODO/FIXME/XXX) |

Principles, sources and thresholds for each rule: `skills/principles/references/catalog.md` (generated from `scripts/principles/catalog.py`), or `python3 scripts/principles explain DEM001`.

## Usage in Claude Code

```text
/programmer:review src/
/programmer:review . --diff main
/programmer:review src/ --no-judge
/programmer:review . --profile pragmatic --report review.md
```

The review skill runs the scanner first and keeps its JSON as the source of truth for detected findings. It then dispatches `principles-judge` in parallel batches (8 files per batch, 4 batches max). Judge findings whose evidence does not match the cited line are dropped. Scanner findings the judge disputes stay in the report under "Disputed". The report goes to `.principles-report.md` unless `--report` is given.

Ask "which principle applies here?" or "is this DRY?" and the `principles` skill answers with 1-4 principles, each with its source and a pointer into your code.

## Usage as a CLI

```bash
python3 plugins/programmer/scripts/principles scan src/
python3 plugins/programmer/scripts/principles scan . --format sarif -o principles.sarif
python3 plugins/programmer/scripts/principles scan . --diff origin/main --fail-on warning
python3 plugins/programmer/scripts/principles rules
python3 plugins/programmer/scripts/principles explain SEC001
```

| Option | Effect |
|---|---|
| `--format text\|json\|sarif\|md` | Output format. SARIF 2.1.0 works with GitHub code scanning. |
| `-o FILE` | Write output to a file. |
| `--rules A,B` / `--skip A,B` | Restrict which rules run. |
| `--diff [REF]` | Only lines changed vs REF (default `HEAD`), plus untracked files. |
| `--no-tests` | Skip test files entirely. |
| `--fail-on error\|warning\|note\|never` | Exit 1 at or above this severity. Default `error`. |
| `--baseline FILE` / `--write-baseline FILE` | Adopt on a legacy repo: record current findings, report only new ones. |

Exit codes: 0 clean, 1 findings at or above `--fail-on`, 2 usage or git error.

## Configuration

`.principles.toml` at the scan root, or `[tool.principles]` in `pyproject.toml`:

```toml
disable = ["LIT001"]
exclude = ["migrations/*"]        # globs on paths relative to the scan root
exclude_dirs = ["vendor"]        # directory names skipped anywhere

[rules.FN002]
max_params = 5

[rules.ARCH001]
inner_dirs = ["core"]
```

## Suppression

```python
cur.execute(sql)  # principles: ignore[SEC001] sql is a constant from queries.py
```

`# principles: ignore-file[RULE]` near the top of a file suppresses that rule for the whole file. Write the reason after the bracket.

## Opt-in edit hook

Set `PROGRAMMER_SCAN_ON_EDIT=1` before starting Claude Code. After each Edit or Write to a `.py` file, the hook scans that file and passes up to 5 error-level findings back to Claude. It never blocks a tool call and is silent when off, on clean files, and on files that do not parse.

## Tests

```bash
cd plugins/programmer && python3 -m unittest discover -s tests -v
```

The suite proves each rule fires on its `bad` fixture and stays quiet on its `good` fixture, replaces every check with a no-op to prove the fixture test catches it, scans a clean sample project for zero findings, and checks that the docs, manifests and skills match what the code ships.

## Book corpus

`skills/principles/references/books.md` maps each of the 30 books to its principles. `skills/principles/references/concepts/` holds 89 Pragmatic Programmer concepts with tip numbers in their frontmatter.

## Limits

- The scanner reads Python only. Other languages get the judge, not detected rules.
- Detected rules are heuristics with fixed thresholds. Tune them in config or suppress with a reason.
