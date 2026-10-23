# findings.json schema - the atlas evidence ledger

The findings ledger is an append-only list of verdicts, one entry per checked claim, kept at `.atlas/.run/findings.json`. This document is derived from `plugins/atlas/scripts/atlas_finding.py`, the only CLI the plugin sanctions for writing to it. Names in parentheses are functions or constants in that script; line numbers are left out because they drift.

## Purpose and writer

`atlas_finding.py` appends one verdict per invocation. It exists because the completion gate's condition (b) requires an entry with status `verified` in the ledger, but the `atlas:verifier` agent runs with Write and Edit blocked. Bash is its only write path, so this CLI is the ledger's writer.

The ledger records verdicts and evidence only: file and line references, test ids, and commands. It should never contain secrets. If a finding has to mention configuration, name the environment variable (for example `ATLAS_ENV_FILE`), never its value.

## Location and root detection

- Fixed relative path: `.atlas/.run/findings.json` (`RELPATH`).
- The project root is the nearest ancestor holding `docs/` or `.atlas/` (`find_root`); `--root` overrides detection.

## Entry schema

One JSON object per verdict, built by `build_entry()`. Defaults come from the argparse definitions in `main()`:

| Field | Type | Default |
|---|---|---|
| `id` | string | required (`--id`) |
| `surface` | string | `"backend"` (`--surface`) |
| `category` | string | `"correctness"` (`--category`) |
| `severity` | string | `"medium"` (`--severity`) |
| `title` | string | required (`--title`) |
| `evidence` | string[] | `[]` (repeatable `--evidence`: path, test id, log) |
| `doc_refs` | string[] | `[]` (repeatable `--doc-ref`) |
| `reproduction` | string | `""` (exact command that demonstrates it) |
| `proposed_fix` | string | `""` (`--proposed-fix`) |
| `blast_radius` | string | `"module"` (`--blast-radius`) |
| `status` | enum | required (`--status`) |
| `verified_at` | string | UTC ISO-8601, seconds precision, stamped at write time |
| `verified_by` | string | `"atlas:verifier"` (`--by`) |

The `status` enum is `verified | rejected | needs-evidence | open` (`STATUSES`). Only `verified` satisfies the completion gate.

## The verified stamp

Every appended entry carries two fields set at write time, not by the caller: `verified_at` (UTC timestamp) and `verified_by` (writer identity, default `atlas:verifier`). An entry with `status: "verified"` plus its stamp is the machine-checkable proof the completion gate consumes.

## Append-only intent

`main()` takes a file lock, loads the existing ledger, appends the new entry and saves. Existing rows are never edited or removed; a correction is a new entry. `save()` writes to a temp file in the same directory and then calls `os.replace`, so a crash mid-append cannot truncate the ledger. Treat the file as append-only: do not hand-edit, reorder or prune rows.

## File shape and tolerance

The ledger is a JSON array. `load()` also unwraps a `{"findings": [...]}` wrapper and starts an empty ledger when the file is missing. A file that exists but is corrupt or not a ledger is moved aside (`_quarantine`) with a warning on stderr instead of being overwritten.

## Example entry

A synthetic entry in the shape `atlas_finding.py` writes today:

```json
{
  "id": "S3",
  "surface": "backend",
  "category": "correctness",
  "severity": "medium",
  "title": "budget read path sums all income rows",
  "evidence": [
    "backend/tests/test_budget.py::test_multi_income",
    "pytest backend/tests/test_budget.py -q -> 14 passed"
  ],
  "doc_refs": ["docs/specs/budget.md"],
  "reproduction": "pytest backend/tests/test_budget.py -q",
  "proposed_fix": "",
  "blast_radius": "module",
  "status": "verified",
  "verified_at": "2026-01-15T10:42:07+00:00",
  "verified_by": "atlas:verifier"
}
```

Older ledgers may hold a different shape (for example `batch`, `claim`, `verifier`, a single `evidence` string). `load()` round-trips them unchanged; new entries use the table above.

## Writer usage

```bash
python3 atlas_finding.py --id S3 --status verified \
    --title "budget read path sums all income rows" \
    --evidence "backend/tests/test_budget.py::test_multi_income" \
    --reproduction "pytest backend/tests/test_budget.py -q"
```

The command exits 0 on success and prints the written entry. It exits 1 on a bad status, a missing project root, or an unwritable path, because a silent failure here would let a run pass the gate without a recorded verdict.
