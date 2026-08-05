---
name: atlas-doctor
description: Closes atlas's self-improvement loop interactively - mine cross-session findings from atlas.db, ask the user how to handle each one (apply / skip / modify), apply what they accept, and record a measurable baseline that a later run remeasures. Not a report generator and not a prompt vending machine - the changes land in this run.
when_to_use: after a batch of sessions have accumulated telemetry, when the user wants atlas to self-improve rather than just report on itself, or to check on/remeasure improvements applied by a previous /atlas-doctor run
allowed-tools: Read, Glob, Grep, Bash, Edit, Write, AskUserQuestion
argument-hint: (no args; run periodically or after a heavy session)
---

# atlas-doctor

Five phases, always in order: **enrich -> mine -> decide -> apply -> measure**.
The user decides what happens to every finding; nothing gets edited without an
explicit accept. This is what distinguishes atlas-doctor from atlas-audit's
`self` mode (which only reports) - atlas-doctor closes the loop: findings that
the user accepts get applied in this session, and the next /atlas-doctor run
remeasures whether they actually helped.

All deterministic work (mining, fingerprinting, baseline, remeasure) is
machinery in `${CLAUDE_PLUGIN_ROOT}/scripts/atlas_doctor.py`, not improvised SQL in this file. Call
it via the CLI flags below; never hand-roll a query atlas_doctor.py already
exposes.

```!
cat "${CLAUDE_PLUGIN_ROOT}/references/operating-contract.md"
```

If the contract did not load above, read
`${CLAUDE_PLUGIN_ROOT}/references/operating-contract.md` and apply it before
proceeding.

## Phase 1 - ENRICH

Fill the LLM-judged columns on every facets row still pending
(`enriched_at IS NULL`). This is cheap, batched, and resumable - it never
redoes a row once `enriched_at` is set.

```
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/atlas_doctor.py" --pending-facets 50
```

For each row returned, read whatever `session_logs`/`messages`/`user_prompts`
already recorded for that `session_id` (already ingested - do not re-parse the
raw transcript) and judge: `underlying_goal`, `outcome`, `session_type`,
`primary_success`, `friction_detail`, `brief_summary`, `goal_categories_json`,
`friction_counts_json`, `user_satisfaction`, `claude_helpfulness`. Write the
judged columns back with `atlas_db.upsert_facet(conn, session_id, enriched_at=<now>, **judged)`
via a short inline Python call (there is no CLI flag for this step because it
is inherently an LLM judgment call, not deterministic logic - `--pending-facets`
is the only machinery this phase needs). Batch in groups of ~10-20 sessions per
pass so the doctor stays cheap on a heavy backlog; run this loop until
`--pending-facets` returns empty.

## Phase 2 - MINE

Run every registered miner and upsert findings (fingerprinted, so a re-run
updates instead of duplicating):

```
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/atlas_doctor.py" --mine --json
```

The miner registry lives in `${CLAUDE_PLUGIN_ROOT}/scripts/atlas_doctor.py`'s `MINERS` dict - one
function per miner, each reading facets + friction_events + metrics +
tool_calls (or, for a couple of static-code miners, the plugin's own source).
That dict is the extension point: to add a new class of defect detection,
write a `mine_*(conn, root)` function returning `_finding(...)` dicts and
register it there. Nothing else needs to change - `mine()` fingerprints,
upserts, and dedupes generically for every registry entry.

```
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/atlas_doctor.py" --list-findings --status open --json
```

## Phase 3 - DECIDE

Present the open findings to the user with `AskUserQuestion`, clustered by
`dimension` so a heavy backlog never turns into 20 separate prompts - max
~4 questions per round. Each question's text must carry enough evidence
(counts, session ids, file:line, the finding's `detail` field) that the user
can decide without going to read the DB themselves.

Every option is one of exactly three verdicts, never more:

- **Apply** - make the change now (Phase 4 does it in this same run).
- **Skip** - leave it `open`; it resurfaces (with fresh evidence) on the next
  `--mine` if the underlying pattern still exists.
- **Modify** - the user describes a variant; capture their wording, and treat
  it as an "apply" with the user's edit substituted for the proposed_action.

Record every decision immediately so a later phase never re-asks:

```
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/atlas_doctor.py" --set-status <finding_id> accepted
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/atlas_doctor.py" --set-status <finding_id> rejected
```

## Phase 4 - APPLY

For every finding set to `accepted`, make the real edit now - a rule file, a
hook constant, a skill body, a CLAUDE.md section, a settings value. The
finding's `target_path` and `proposed_action` columns name where and what;
read the target file first, make the minimal diff, and verify it (syntax
check, run the relevant test file) before marking it done:

```
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/atlas_doctor.py" --set-status <finding_id> applied
```

If a finding cannot be safely auto-applied (the edit is ambiguous, touches
something outside this repo, or needs a human call), never claim `applied`.
Instead:

```
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/atlas_doctor.py" --set-status <finding_id> accepted
```

and tell the user plainly: accepted but manual, with the exact edit needed
spelled out so they (or a future run) can do it. Saying "applied" when it was
not is the one failure mode this skill exists to prevent.

## Phase 5 - MEASURE

For every finding just marked `applied`, record a baseline **now** (the metric
is measured from the live DB at this moment, not guessed):

```
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/atlas_doctor.py" --baseline <finding_id> \
  --metric <short_metric_name> --target <target_value> --after <runs_to_wait>
```

`--after` is how many runs must elapse before this is remeasured - default 5;
lower it for something that should show a signal fast (e.g. a friction-count
finding fed by every session) and raise it for something that only a
heavier task exercises (e.g. verifier coverage).

At the **start** of every future `/atlas-doctor` invocation (including this
one, before mining again), remeasure anything due:

```
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/atlas_doctor.py" --remeasure --json
```

This recomputes each due improvement's metric by re-running the same miner
that produced the finding, and records `remeasured_value` +
`improved|no_change|regressed`. Report these verdicts to the user plainly -
this is what makes an improvement measured rather than aspirational. A
`regressed` verdict is itself worth a fresh finding on the next `--mine` pass
if the regression is real and ongoing.

## Report

At the end of a run, tell the user in one dense block: how many facets were
enriched, how many findings were mined (new vs. updated), the decision for
each (applied / accepted-manual / skipped / rejected), and the verdict of any
remeasured improvement from a prior run. Close with:

> Restart your Claude Code session(s) to pick up the applied changes.

No prompts to hand off, no "run this yourself" - the changes are already in
the files.
