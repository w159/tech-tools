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

## DURING - work is tracked in ROADMAP

While the work runs, each task lives as a ROADMAP.md item moving through its status
(`Backlog -> In Progress -> Done`) per `docs-ssot.md`. Evidence lands under
`docs/evidence/` at the moment of proof, as the rest of the skill already requires.

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

This is the same docs-current condition the atlas-engine completion gate already enforces;
the END flow is how that gate is satisfied, not a second gate.
