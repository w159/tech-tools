# Reporting protocol

How the synthesis-reporter turns evidence into deliverables, what the headline metric is, and
the two gates that keep a report honest. Every deliverable is template-driven (templates in
`docs/claude_testers/templates/`) so runs stay comparable over time.

## Headline metric: completion rate

completion_rate = (personas meeting G1) / (total personas), reported as a percentage with the
raw fraction, e.g. `completion rate 9/24 (37.5%)`.

A persona meets G1 (client-surface success) ONLY when the profile/setup-status surface the
client reads returns a fully populated record (salary, filing/tax, net worth, debt, household)
AND, in standard+/full tiers, a screenshot shows the dashboard calc cards resolving. HTTP 200
on a write is necessary, never sufficient. This is the binary task-completion measure: a
persona who got from signup to a fully populated, resolving dashboard. It leads the run summary.

Do not average ordinal success labels into a single number. Report counts per level
(complete / minor issue / major issue / failure) alongside the completion rate.

## Deliverable shapes

All written under `RUN_DIR/reports/`:
- `results.csv` - every `*.rows.csv` concatenated, single header, schema per
  `templates/RESULTS-SCHEMA.md`. Every evidence_ref must resolve to a file on disk.
- `bug-log.md` - one entry per `templates/bug-report.md`, ordered Blocker > Major > Minor >
  Cosmetic, deduplicated across agents, each carrying the G2 required fields
  (`references/evidence-severity.md`).
- `feature-backlog.md` - per `templates/feature-request.md`, deduplicated, ranked by how many
  personas asked and rank seniority, tagged free-tier vs premium. Test-infrastructure asks
  (test logins, automation bypasses) listed separately, never in the product backlog.
- `user-stories.md` - one story per persona per flow, per `templates/user-story.md`, with
  acceptance verdicts carried from the persona reports.
- `ux-friction.md` and `user-feedback.md` - recurring confusion points with their personas and
  screens, and the in-voice complaints worth a developer's attention.
- `coverage-report.md` - every untested route and field named, with reason.
- `RUN-SUMMARY.md` - per `templates/run-summary.md`, leads with the completion rate.

## Count-reconciliation gate

Every claimed total in every report MUST equal the count of matching artifacts on disk:
- personas executed == count of `<persona_id>.json` evidence files.
- bugs logged == entries in `bug-log.md` (after G2 rejection).
- figures verified == rows across `*-verify.rows.csv`.
- screenshots referenced == files that exist under `RUN_DIR/evidence/`.

`aggregate_results.py` asserts this. If a claimed number does not match the on-disk count, the
run verdict is INCOMPLETE and the report names the discrepancy. Never write a total the files
do not support. Never round 96% up to "fully tested." A scenario that failed to run is reported
as failed-to-run, not omitted and not passed.

## Coverage gate

Read the run-local matrices and compute: routes visited / total, fields `tested-*` / total,
fields fuzzed / total, seed personas executed / assigned. Any untested item makes the verdict
INCOMPLETE; state which wave (scripted / browser / fuzz / verify) closes each gap.

## Timing rollup

From `RUN_DIR/notes/timing.json` produce a per-phase table and total wall-clock:

```
phase            start(epoch)   end(epoch)   duration(s)   status
0 discover       ...            ...          ...           done
1 generate       ...            ...          ...           done
2 enter-data     ...            ...          ...           done
3 walk-ui        ...            ...          ...           done
4 fuzz           -              -            -             skipped (tier=standard)
5 verify         ...            ...          ...           done
6 synthesize     ...            ...          ...           done
TOTAL            ...            ...          ...
```

Phases with no work for the chosen coverage tier show `skipped` with the reason, never absent.

## Verdict

A run is COMPLETE only when G1 (completion rate reported and reconciled), G2 (every bug entry
evidence-complete), G3 (every figure recomputed, zero mismatches beyond 1 cent), the
count-reconciliation gate, and the coverage gate all pass with zero unresolved Blockers.
Otherwise INCOMPLETE, with each gap and the wave that closes it named.
