# pytest Coverage

Sourced from the pytest-coverage skill. Run pytest with coverage, identify uncovered lines,
and drive coverage to 100%.

## When to Load This Reference

- When a subagent needs to run pytest with coverage reporting
- When improving test coverage on a Python project
- When identifying lines not covered by the test suite

## Core Workflow

### Generate a Coverage Report

```bash
pytest --cov --cov-report=annotate:cov_annotate
```

For a specific module:
```bash
pytest --cov=your_module_name --cov-report=annotate:cov_annotate
```

For specific tests:
```bash
pytest tests/test_your_module.py --cov=your_module_name --cov-report=annotate:cov_annotate
```

### Read the Annotated Report

Open the `cov_annotate/` directory. There is one file per source file.

- If a file shows 100% coverage, all lines are covered -- no action needed.
- For files with less than 100% coverage: find the matching file in `cov_annotate/` and
  review it.
- Lines starting with `!` (exclamation mark) are not covered by any test.

### Iterate

Add tests to cover the missing lines (those marked `!`).
Re-run until all lines are covered:

```bash
pytest --cov --cov-report=annotate:cov_annotate
```

Repeat until no files have `!`-marked lines.

## Notes for Orchestrator

When dispatching a test-coverage task:
- The subagent should run the annotated report, identify uncovered files, read those files,
  and write targeted tests before re-running.
- Do not ask the subagent to achieve 100% in one shot on a large codebase -- dispatch per
  module or per file cluster.
- Evidence of completion: re-running the coverage command and confirming no `!` lines remain
  in the targeted scope.
