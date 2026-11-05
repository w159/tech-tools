---
name: atlas-doctor
description: "Atlas self-improvement loop: mines cross-session findings from atlas.db, applies accepted changes to atlas itself, records a baseline. Use when atlas telemetry has accumulated or before changing a skill, hook or agent."
when_to_use: "atlas self-improve, remeasure baseline, apply atlas findings, stale lesson citations"
allowed-tools: Read, Glob, Grep, Bash, Edit, Write, AskUserQuestion
argument-hint: (no args; run periodically or after a heavy session)
---

# atlas-doctor

Six phases, always in order: **enrich -> mine -> decide -> apply -> measure -> refresh**.
The user decides what happens to every finding; nothing gets edited without an
explicit accept. This is what distinguishes atlas-doctor from atlas-audit's
`self` mode (which only reports) - atlas-doctor closes the loop: findings that
the user accepts get applied in this session, and the next /atlas-doctor run
remeasures whether they actually helped.

**Provenance.** The REFRESH phase and the measurement-first gate in MEASURE are
folded into atlas-doctor (not separate skills) because it already owns the
measure-and-self-improve role over atlas.db telemetry; a standalone counterpart
would compete for the same trigger and split the loop. Lineage: `skills/PROVENANCE.md`.

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

## Contents

- [Phase 1 - ENRICH](#phase-1---enrich)
- [Phase 2 - MINE](#phase-2---mine)
- [Phase 3 - DECIDE](#phase-3---decide)
- [Phase 4 - APPLY](#phase-4---apply)
- [Phase 5 - MEASURE](#phase-5---measure)
- [Phase 6 - REFRESH](#phase-6---refresh)
- [Display checks](#display-checks)
- [Report](#report)

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
judged columns back with the deterministic CLI (the judgment stays yours; the
write is a validated call, unknown columns and bad JSON exit 2):

```
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/atlas_doctor.py" --enrich-facet <session_id> \
  '{"primary_success":"...","brief_summary":"...","outcome":"..."}'
```

`--enrich-facet` stamps `enriched_at` itself when the JSON omits it - that stamp
is what retires the row from `--pending-facets`, so do not add it by hand (a
caller-supplied `enriched_at` is still honored). Batch in groups of ~10-20
sessions per pass so the doctor stays cheap on a heavy backlog; run this loop
until `--pending-facets` returns empty.

## Phase 2 - MINE

Run every registered miner and upsert findings (fingerprinted, so a re-run
updates instead of duplicating):

```
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/atlas_doctor.py" --mine --json
```

Before triaging the mined findings, read `${CLAUDE_SKILL_DIR}/references/mine-details.md`: the `MINERS` registry (the extension point for new detectors), what `tool_error_rate_high:*` and `gate_block` evidence mean, and the optional reply-quality loop (`turn_quality` miner, needs `TYPESAFE_API_KEY`, `ATLAS_TYPESAFE_SCORING=off` disables it).

Then list what is open:

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

If the target of an accepted finding is a skill, hook, or agent file, the
pre-change baseline required by the measurement-first gate (Phase 5) must
already be captured at DECIDE time - before this edit lands. No baseline, no
edit.

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

### Measurement-first gate

Do not apply a change you cannot measure; define the metric and baseline first. Read `${CLAUDE_SKILL_DIR}/references/measurement-gate.md` for the full detail.

## Phase 6 - REFRESH

Audit `docs/lessons/*.md` (excluding `README.md`) against the current tree, in this same
session after MEASURE, at least every few runs: a lesson's cited `file:line` evidence goes
stale after refactors and the store starts lying. Read
`${CLAUDE_SKILL_DIR}/references/refresh-lessons.md` for the procedure (candidates, evidence
extraction, HOLD / DRIFTED / GONE verification, Apply / Skip / Modify decision). Never edit
the product code a lesson points at to make a citation true; a contradiction is its own
finding for Phase 3.

## Display checks

`atlas_doctor.py` also answers "why do I not see the TODO tree, Subagents block,
mission control band or status line?". These rows are WARN severity (user
configuration, not plugin damage), run in every mode, and are repaired by
`--fix` where the repair is safe. The settings file is
`$CLAUDE_CONFIG_DIR/settings.json` (default `~/.claude/settings.json`).

Check ids (concern and `--fix` behavior per id in `references/display-checks.md`; read it
when one of them is WARN): `display-todo-tools`, `display-mod`, `display-todo-mirror`,
`display-statusline`, `display-harness`, `display-omp-todo`, `display-hud`,
`display-renderer`.

## Report

At the end of a run, tell the user in one dense block: how many facets were
enriched, how many findings were mined (new vs. updated), the decision for
each (applied / accepted-manual / skipped / rejected), the verdict of any
remeasured improvement from a prior run, and - when Phase 6 ran - the
lesson-refresh tally (how many lessons held, drifted, or retired). Close with:

> Restart your Claude Code session(s) to pick up the applied changes.

No prompts to hand off, no "run this yourself" - the changes are already in
the files.
