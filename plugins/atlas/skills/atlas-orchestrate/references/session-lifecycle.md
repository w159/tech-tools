# Session lifecycle - reconcile at start, curate at end

This file makes the docs/ lifecycle explicit at the two session boundaries. It does
not redefine the docs/ layout or the "move done items" convention - those live in
`docs-ssot.md`. Read this for *when* the reconcile and curate happen; read
`docs-ssot.md` for *where* each file lives and *how* a completed item moves.

## START - reconcile before new work

On session boot or resume, before planning or dispatching any new work:

1. **Recall recent work.** Query `claude-mem` (`mem-search`) for the last sessions,
   decisions, and errors, and `ctx_search` for indexed session memory. These tell you
   what actually happened recently, independent of what the docs claim.
2. **Diff recall against docs/.** Compare that recalled reality to `docs/CHANGELOG.md`,
   `docs/ROADMAP.md`, `docs/AGENTS.md`, and the durable subfolders. Look for docs that
   describe a state the recent work has already changed or invalidated.
3. **Correct what is now wrong.** For each drifted doc, fix it and cite the evidence
   (a `mem-search` hit, a `ctx_search` chunk, or a `file:line` / command result) that
   proves the correction. Do not assert a correction you cannot ground.
4. **Archive, never delete, the outdated.** Move a superseded doc to
   `docs/archive/<area>/`, or mark it `superseded YYYY-MM-DD` in place with a pointer to
   what replaced it. History is preserved; the active tree tells the truth.
5. **Confirm ROADMAP and CHANGELOG reflect reality.** Anything already done but still
   sitting in ROADMAP moves to CHANGELOG per the move convention in `docs-ssot.md`;
   anything CHANGELOG claims that did not actually ship is corrected.
6. **Only then proceed.** Once docs/ reflect truth, clear or checkpoint context for the
   new task and start the loop (Orient onward).

**Graceful degradation:** if `claude-mem` and `context-mode` are both absent, reconcile
against `git log` plus the docs/ tree alone. The diff-and-correct steps are unchanged;
only the recall source is narrower.

## RESUMING ACROSS SESSIONS - a multi-wave run picks up where it stopped

A large audit, refactor, or migration that spans waves will outlive a single session.
For that in-flight work the orchestrator maintains a durable run-state under `.atlas/.run/`
so the next session continues from the next pending stage instead of re-planning from
scratch. This is a specialization of the START reconcile above, not a second flow.

1. **The durable run-state the orchestrator keeps.** While a multi-wave task is in flight,
   the orchestrator keeps these current (paths and roles per `docs-ssot.md`):
   - `.atlas/.run/STATE.md` - the live map of the run: the current wave, the stages already
     completed, the stages still pending, and, for each stage, its verdict (`verified` or
     `rejected`) mirrored from `findings.json`. STATE.md is the at-a-glance answer to
     "where did we stop and what is left".
   - `.atlas/.run/findings.json` - the authoritative per-stage findings and verdicts (schema
     in `scaffolding.md`). STATE.md mirrors its verdicts; on any disagreement
     `findings.json` wins, because the verdict there was written by an independent verifier.
   - `.atlas/.run/work-log.md` - an append-only log of what each wave dispatched, what it
     proved, and what it decided. It is never rewritten, only appended, so the trail of a
     long run stays intact across sessions.

2. **The resume protocol on boot or resume.** When a session opens onto an in-flight run:
   - **Read the run-state first.** Re-read `.atlas/.run/work-log.md`, then `STATE.md`, then
     `findings.json` - the same order `docs-ssot.md` requires before dispatching anything.
   - **Reconcile it against reality.** Confirm the run-state matches the actual repo and
     docs/ state: a stage STATE.md calls done must be backed by a `verified` entry in
     `findings.json` and by the real artifact on disk (`file:line`, a passing test, a
     committed change). Where the run-state and reality disagree, reality wins - correct the
     run-state and cite the evidence, exactly as the START flow corrects drifted docs.
   - **Continue from the next pending stage.** Resume at the first stage STATE.md lists as
     pending (respecting stage dependencies in `multi-stage-planning.md`). Do not re-plan
     the whole task and do not re-run stages already `verified`; a `rejected` stage is
     re-attempted, not skipped.

3. **Archive on completion so history persists.** When the run finishes, copy the final
   `STATE.md` and `findings.json` into a committed, per-run archive under
   `.atlas/archive/<YYYY-MM-DD>-<slug>/` (use the run id or a `<YYYY-MM-DD>-<slug>`,
   filesystem-safe per the slug rule in `docs-ssot.md` "Naming conventions" -
   no colon/slash/space, or Windows cannot check out the repo) - so the decisions and
   verdicts of the run survive after `.atlas/.run/` is cleared for the next task. The
   durable narrative still lands in CHANGELOG and the affected subfolders via the END
   curate flow below; the archive preserves the raw run record those entries were drawn from.

**Durable vs ephemeral - the intended reading.** `docs-ssot.md` classifies `.atlas/.run/` as
the one ephemeral, gitignored subtree (except the durable `findings.json` ledger, re-included
per `docs-ssot.md`). The run-state is durable in a different sense - it is intentionally kept
on disk, intact, across sessions for the lifetime of one in-flight multi-session run, which is
exactly what makes resume possible. Completion resolves the two: `.atlas/.run/` is cleared
(ephemeral as promised), the committed `.atlas/archive/<YYYY-MM-DD>-<slug>/` archive carries the
history forward, and the SSOT durable subfolders carry the outcome. There is no contradiction -
the gitignored scratch lives long enough to finish the job, then its record is archived and the
scratch is reset.

## DURING - work is tracked in ROADMAP

While the work runs, each task lives as a ROADMAP.md item moving through its status
(`Backlog -> In Progress -> Done`) per `docs-ssot.md`. Evidence lands under
`.atlas/evidence/` at the moment of proof, as the rest of the skill already requires.

## END - curate before the session is complete

Before the session is considered finished, dispatch an `atlas:docs-curator` subagent to
bring docs/ current:

1. **Update the durable record.** The curator updates the durable subfolders, `README.md`,
   `docs/CHANGELOG.md`, and `docs/ROADMAP.md`.
2. **Move every completed task.** Each ROADMAP task finished this session MOVES to
   CHANGELOG.md with its date and the concrete result/evidence (the move convention in
   `docs-ssot.md`), and is dropped from ROADMAP. ROADMAP holds only what is still open.
3. **Confirm before writing.** The curator confirms each claim is true - `file:line` or a
   command result - before recording it. An unverifiable claim is not written.

This is the same docs-current condition the atlas-orchestrate completion gate already enforces;
the END flow is how that gate is satisfied, not a second gate.
