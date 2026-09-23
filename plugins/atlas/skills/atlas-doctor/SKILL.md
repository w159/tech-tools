---
name: atlas-doctor
description: Closes atlas's self-improvement loop interactively - mine cross-session findings from atlas.db, ask the user how to handle each one (apply / skip / modify), apply what they accept, and record a measurable baseline that a later run remeasures. Also refreshes docs/lessons/ citations that have drifted from current code, and enforces measurement-first discipline on any change to atlas's own skill/hook/agent corpus. Not a report generator and not a prompt vending machine - the changes land in this run.
when_to_use: after a batch of sessions have accumulated telemetry, when the user wants atlas to self-improve rather than just report on itself, to check on/remeasure improvements applied by a previous /atlas-doctor run, after a refactor that moved or deleted code that docs/lessons/ cites, or before accepting any claimed improvement to a skill/hook/agent file
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

**Provenance.** The REFRESH phase and the measurement-first gate in MEASURE
fold two compound-engineering skills into atlas-doctor: `ce-compound-refresh`
(learning-store maintenance - auditing captured learnings against current code)
and `ce-retune` (measurement-first retuning of the skill corpus). They are
deliberately not separate skills here: atlas-doctor already owns exactly this
measure-and-self-improve role over atlas.db telemetry, and a standalone
counterpart would compete for the same trigger and split the loop this skill
exists to close.

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

### Measurement-first gate (ported from CE's `ce-retune`)

The baseline/remeasure loop above only means something if it is disciplined.
Before any accepted change to a skill, hook, or agent file may be claimed as
an improvement:

1. **Baseline from the archive, before the edit.** Historical sessions in
   `~/.atlas/atlas.db` are a free baseline - usually larger than any
   experiment you could run now. At DECIDE time, before Phase 4 touches the
   file, measure the specific friction the finding targets from existing
   telemetry: re-run the same miner that surfaced the finding over the
   pre-change window and keep that number with the finding. `--baseline` then
   registers the metric, target, and `--after` as before. A value recorded
   after the edit is not a baseline.
2. **No baseline, no claimed improvement.** If the friction is not observable
   in telemetry - no facet column or friction event captures it - say so
   plainly: the finding is accepted-but-unmeasurable until instrumented.
   Instrumenting first is the real fix. Auditing the skill and presenting the
   result as retuning is not.
3. **Register the bar in writing before the change exists.** Choose metric,
   target, and `--after` before seeing any post-change data. A bar chosen
   after seeing results is not a bar.
4. **Remeasure with the identical method.** `--remeasure` re-runs the same
   miner. Never change the metric definition, the miner, or the window
   semantics between baseline and remeasure - if the instrument must change,
   the comparison is void and the improvement claim resets to unproven.
5. **State the counter-argument.** For a corpus-wide retune (one pass touching
   more than one skill/hook/agent file), run the change-proposing and
   change-defending passes in independent contexts before applying; for a
   single-file change, the DECIDE question must state what the change might
   break, not only what it fixes.

The harness check ce-retune performs has a direct atlas analog, and it gates
the same way: the run archive is the ingested session telemetry; the build
selector is the plugin source in-repo (changes land in-tree, and sessions
before and after a change are the A/B); the repeatable task is the recurring
session work the friction appears in. If any of the three is missing for a
proposed corpus change, stop and name what to build instead of retuning blind.

## Phase 6 - REFRESH

A lesson in `docs/lessons/` only compounds value while its evidence still
holds. A lesson citing `plugins/atlas/hooks/completion_gate.py:88-104` was
true when written; after the next refactor the citation may point at nothing.
Trusted silently forever, the store starts lying. This pass - ported from CE's
`ce-compound-refresh` and folded into this skill rather than shipped
standalone (see Provenance) - audits the store against the current tree.

Run it in this same session, after MEASURE, at least every few runs (it is
cheap next to mining):

1. **Candidates.** Every `docs/lessons/*.md` (date-first naming per the docs
   SSOT), excluding `README.md`. A scope hint in the invocation narrows it; a
   hint matching nothing never widens it.
2. **Extract evidence.** Every repo path the lesson cites: bare paths,
   `file:line` and `file:N-M` spans, evidence files, and any guidance file the
   lesson names or links. Compare only guidance the lesson names - never
   search the guidance layer for one.
3. **Verify against the current tree.** For each citation, one of:
   - **HOLD** - the file exists and a cited span still locates the claimed
     content. Read the span and spot-check that it still says what the lesson
     claims; this is an LLM judgment call in the same tier as Phase 1
     enrichment, not DB work, so no miner is required.
   - **DRIFTED** - the file exists but the span no longer locates the content
     (lines moved, symbols renamed). Find where the evidence lives now and
     propose the corrected citation.
   - **GONE** - the file or the evidence is deleted. Propose re-grounding the
     lesson in new evidence or retiring it; never leave the dead citation.
4. **Decide.** Route every non-HOLD lesson through the same Apply / Skip /
   Modify verdict as Phase 3. Apply rewrites the lesson in this run - update
   the citation, or rewrite the lesson against current code. Skip leaves it
   stale; the next refresh scan re-surfaces it deterministically, so no
   fingerprint machinery is needed. A lesson that cannot be verified this
   session is flagged drifted-pending, never deleted: unverifiable is not
   false.

This skill never edits the product code a lesson points at to make the
citation true. If current code contradicts a lesson's guidance, the
contradiction is a potential product regression - report it as its own
finding and let Phase 3 decide, exactly as the refresh would report a skill
contradicting its own lessons.

## Report

At the end of a run, tell the user in one dense block: how many facets were
enriched, how many findings were mined (new vs. updated), the decision for
each (applied / accepted-manual / skipped / rejected), the verdict of any
remeasured improvement from a prior run, and - when Phase 6 ran - the
lesson-refresh tally (how many lessons held, drifted, or retired). Close with:

> Restart your Claude Code session(s) to pick up the applied changes.

No prompts to hand off, no "run this yourself" - the changes are already in
the files.
