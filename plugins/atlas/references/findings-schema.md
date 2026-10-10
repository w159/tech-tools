# findings.json schema — the atlas evidence ledger

This document is derived 1:1 from `plugins/atlas/scripts/atlas_finding.py`, the only
CLI the plugin sanctions for writing verdicts to `.atlas/.run/findings.json`.
Every field below cites the script line that produces it.

## Purpose and writer

`atlas_finding.py` appends one verdict per invocation to `.atlas/.run/findings.json`
(`atlas_finding.py:2`). It exists because the completion gate's condition (b) requires
an entry with status `verified` in the ledger, but the `atlas:verifier` agent runs with
Write/Edit blocked — Bash is its only write path, so this CLI is the ledger's writer
(`atlas_finding.py:4-10`).

Compliance framing (FTC Safeguards / GLBA / SEC Reg S-P contexts): the ledger is an
evidence artifact. It records verdicts and file:line or command evidence only — never
connector secrets. If configuration is ever mentioned in a finding, name the
environment variable (`ATLAS_ENV_FILE`) — never its value.

## Location and root detection

- Fixed relative path: `.atlas/.run/findings.json` (`atlas_finding.py:39`).
- Project root is the nearest ancestor holding `docs/` or `.atlas/` (`atlas_finding.py:42-47`);
  `--root` overrides detection (`atlas_finding.py:105`).

## Entry schema

One JSON object per verified verdict, written by `build_entry()`
(`atlas_finding.py:73-88`). Fields, types, and defaults (defaults come from the
argparse definitions at `atlas_finding.py:93-105`):

| Field | Type | Default | Script lines |
|---|---|---|---|
| `id` | string | required (`--id`) | `:75`, `:93` |
| `surface` | string | `"backend"` (`--surface`) | `:76`, `:100` |
| `category` | string | `"correctness"` (`--category`) | `:77`, `:101` |
| `severity` | string | `"medium"` (`--severity`) | `:78`, `:102` |
| `title` | string | required (`--title`) | `:79`, `:95` |
| `evidence` | string[] | `[]` (repeatable `--evidence`: path, test id, log) | `:80`, `:96` |
| `doc_refs` | string[] | `[]` (repeatable `--doc-ref`) | `:81`, `:99` |
| `reproduction` | string | `""` (exact command that demonstrates it) | `:82`, `:97` |
| `proposed_fix` | string | `""` (`--proposed-fix`) | `:83`, `:98` |
| `blast_radius` | string | `"module"` (`--blast-radius`) | `:84`, `:103` |
| `status` | enum | required (`--status`) | `:85`, `:94` |
| `verified_at` | string | UTC ISO-8601, seconds precision, stamped at write time | `:86` |
| `verified_by` | string | `"atlas:verifier"` (`--by`) | `:87`, `:104` |

The `status` enum is `verified | rejected | needs-evidence | open` (`STATUSES`,
`atlas_finding.py:38`); only `verified` satisfies the completion gate (module
docstring, `atlas_finding.py:4-5`).

## The verified stamp

Every appended entry carries two stamp fields set at write time, not by the caller:
`verified_at` (UTC timestamp, `atlas_finding.py:86`) and `verified_by` (writer
identity, default `atlas:verifier`, `atlas_finding.py:87`). An entry with
`status: "verified"` plus its stamp is the machine-checkable proof the completion
gate consumes.

## Append-only intent

`main()` loads the existing ledger, appends the new entry, and saves
(`atlas_finding.py:118-120`). Existing rows are never edited or removed; a correction
is a new entry. The save is atomic — write to a temp file in the same directory, then
`os.replace` — so a crash mid-append cannot truncate the durable ledger
(`atlas_finding.py:65-70`). Treat the file as append-only evidence: do not hand-edit,
reorder, or prune rows.

## File shape and tolerance

The ledger is a JSON array. `load()` also unwraps a legacy `{"findings": [...]}`
wrapper and starts an empty ledger when the file is missing or unreadable
(`atlas_finding.py:50-63`).

## Real entry from this workspace's ledger

Verbatim from `.atlas/.run/findings.json` (this repo's own run history). It uses the
older batch/claim shape that earlier tooling wrote; the schema table above is what
`atlas_finding.py` writes today, and `load()` round-trips both. No secrets appear in
ledger entries — evidence is test commands and summaries.

```json
{
  "batch": "batch-1",
  "claim": "5 HIGH defects fixed: atlas_db is_shipping_agent + _dispatch_coverage_counts for Law 5 (g); atlas_context_optimizer used-set no longer fails-open; auto_skill surfaces skill_factory errors to stderr and exits 0 fail-open (observable on stderr); memory_capture multi-session orbit via _resolve_scope/_in_clause; operating-contract.md promoted to plugin-level with 14 SKILL.md updates.",
  "status": "verified",
  "verifier": "atlas:verifier (fresh)",
  "evidence": "python3 -m unittest discover -s plugins/atlas/hooks -p \"test_*.py\"  -> Ran 67 tests, OK (0 failures); python3 -m unittest discover -s plugins/atlas/scripts -p \"test_*.py\" -> Ran 129 tests, OK (0 failures); ruff check plugins/atlas/hooks plugins/atlas/scripts -> All checks passed (0 errors)"
}
```

## Writer usage

From the module docstring (`atlas_finding.py:17-21`):

```bash
python3 atlas_finding.py --id S3 --status verified \
    --title "budget read path sums all income rows" \
    --evidence "backend/tests/test_budget.py::test_multi_income" \
    --reproduction "pytest backend/tests/test_budget.py -q"
```

Exits 0 on success and prints the written entry; exits 1 on a bad status or an
unwritable path — a silent failure here would recreate the bug this file fixes
(`atlas_finding.py:22-24`).
