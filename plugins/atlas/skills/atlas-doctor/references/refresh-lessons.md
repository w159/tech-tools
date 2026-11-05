# Phase 6 - REFRESH: procedure

Read at Phase 6, after MEASURE.

A lesson in `docs/lessons/` only compounds value while its evidence still
holds. A lesson citing `plugins/atlas/hooks/completion_gate.py:88-104` was
true when written; after the next refactor the citation may point at nothing.
Trusted silently forever, the store starts lying. This pass (folded into this skill, see
Provenance) audits the store against the current tree.

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
