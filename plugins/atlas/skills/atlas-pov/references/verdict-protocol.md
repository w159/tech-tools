# Verdict protocol

The spine of atlas-pov: framing, grounding, the evidence floor, the verdict, reconciliation,
and grading. Peer dispatch is deliberately NOT here - it lives in `peer-dispatch.md` and only
runs on explicit request after the verdict exists.

Throughout: `<run-dir>` is `.atlas/evidence/<YYYY-MM-DD>-<slug>/` (docs-SSOT naming; slug is
filesystem-safe kebab-case). Create it at Phase 0 and keep every artifact referenced from the
final report.

## 1. Frame the decision (Phase 0)

Read the user's ask and produce a framing packet. If any field is genuinely unknowable from
the conversation or the repo, ask ONE bounded round of questions (max three) before
proceeding; otherwise state the assumption and continue.

The framing packet has five fields, written to `<run-dir>/pov-scope.md`:

- **Decision**: one sentence, phrased as a choice ("X over Y", "adopt Z or not", "A or B").
- **Options on the table**: every option the user or the conversation has named, plus any
  option the framing itself makes obvious. An option list of one is a red flag - either the
  decision is not actually a decision, or an option is missing.
- **Constraints**: performance, compat, licensing, team skill, deadline, regulatory,
  existing-pattern constraints - anything that narrows the choice.
- **What would change the answer**: the specific facts that, if true or false, flip the
  verdict. This list drives the scout and makes the verdict falsifiable.
- **Repo-state digest** (immutable once written): branch, HEAD SHA, `git status --porcelain`
  summary (dirty files + untracked count). CE requires the panel to receive an immutable
  scope including dirty/untracked state; atlas requires the same for its own verdict, so the
  recommendation is anchored to a named revision.

## 2. Grounding scout (Phase 1)

Dispatch `atlas:explorer` as the scout. It replaces CE's bespoke scout script with atlas's
existing read-only structural agent; the dossier it returns has three sections, and the
orchestrator persists it to `<run-dir>/grounding-dossier.md` (explorer is read-only and
returns its dossier as its final report).

Use the subagent-kit dispatch shape (ROLE/GOAL/CONTEXT/TOOLS/DELIVERABLE/SUCCESS
CRITERIA/OUT OF SCOPE/STOP CONDITIONS/REPORT BACK), with:

- GOAL: build the evidence dossier for the framed decision - not to answer the decision.
- CONTEXT: the framing packet fields (paste the five fields; they are short and the scout
  cannot derive the decision context itself).
- TOOLS: the standard batched ToolSearch line, plus `web_search` and Context7
  (`mcp__context7__resolve_library_id` / `mcp__context7__query_docs`) so the scout can gather
  external evidence in the same pass. Add claude-mem `search`/`timeline`/`get_observations`
  for precedent.
- TOOLS FORBIDDEN: Write, Edit, git push (standard read-only scout boundary).
- SUCCESS CRITERIA: every claim carries `file:line` (repo facts) or a URL (external facts);
  all three sections present (external marked `n/a` with one line of why when the question
  is repo-internal).

Dossier sections:

1. **Project grounding** - what this repo actually does today that bears on the decision:
   relevant code paths with `file:line`, the existing pattern this decision would extend or
   conflict with, config/manifest facts (dependency versions, build/test wiring), and the
   blast radius of each option.
2. **Precedent/activity** - prior art: `.atlas/findings/INDEX.md`, `docs/lessons/`,
   `docs/decisions/` ADRs, claude-mem timeline for prior work in the involved areas, and git
   churn on the files each option would touch. A decision that repeats a lesson in
   `docs/lessons/` without citing it is invalid.
3. **External evidence** - gathered ONLY when the decision depends on facts outside the repo
   (library capabilities, ecosystem adoption, upstream behavior, benchmarks, vendor docs).
   Use `web_search` for adoption/behavior/known-issues evidence and Context7 for authoritative
   API docs; prefer primary sources (official docs, release notes, changelogs). Record each
   item as a URL plus the specific claim it supports. If the question is fully answerable
   from the repo, write `external-evidence: n/a - decision is repo-internal` and one line of
   why. Do not pad the dossier with decorative links.

## 3. Evidence floor (Phase 2) - hard gate

Before forming any verdict, check the dossier against the floor:

- **Project-grounding floor (always required):** concrete `file:line` facts about the code
  paths, patterns, and config the decision touches. "The codebase uses Express" is not
  grounding; `server/routes.ts:41-58 defines the route table the change must extend` is.
- **External floor (conditional):** if the framing's "what would change the answer" includes
  any fact that lives outside the repo, external evidence must exist and directly address
  that fact. A library-capability decision grounded only in memory is below the floor.

If the floor is unmet: return to the scout (or run `web_search` yourself) to fill the gap. If
the gap cannot be closed - the repo holds nothing relevant and web access adds nothing - the
verdict is **"insufficient evidence"** with the exact missing items listed, and the skill
stops there. Refusing to answer is a correct outcome; guessing is a defect.

## 4. Form the atlas verdict (Phase 3)

The host forms ONE verdict, alone, and records it before any peer dispatch. Not a draft to
be averaged later - the finished position. Write it to `<run-dir>/atlas-verdict.md` (or state
it in chat if the run is staying ephemeral). Shape:

- **Position**: the choice, stated plainly.
- **Confidence**: one of the 0/25/50/75/100 anchors (same anchors as CE findings): 0/25 =
  would not act, 50 = lean, 75 = would act, 100 = proven in this repo.
- **Evidence**: each item a `file:line` or URL from the dossier, and what it supports.
- **What would flip it**: restated from the framing, now answered - which of those facts
  resolved which way.
- **Preliminary grade** per the rubric in §7.

Per the atlas dispatch rules, do NOT dispatch this as a fork that would carry the session's
conclusions into an "independent" voice - the host verdict is allowed to use session context
(the user asked this session's opinion); the peers in Phase 4 are the independent voices and
must be fresh.

## 5. Reconcile (Phase 5)

Peers are evidence, not votes. For each peer answer (schema in `peer-dispatch.md`):

- **Agreement** is corroboration, not permission. It raises confidence; it authorizes
  nothing. Record it as evidence in the final report, never as a vote count.
- **Disagreement** is input. Classify it: (a) the peer cites evidence the dossier missed ->
  verify that evidence yourself (re-open the cited lines, run the check); if it holds, the
  verdict MAY move, and the report must name exactly which new evidence moved it - never
  "the peer said so"; (b) the peer found a dossier error -> fix the dossier, re-evaluate;
  (c) the disagreement rests on preference or assertion with no evidence -> held.
- **Movement record**: `movement: held` (with the reason the disagreement did not move it)
  or `movement: moved` (with the new evidence item). Unrecorded movement is a defect.
- **Atlas remains the decider.** Even unanimous peer disagreement does not transfer the
  verdict; it transfers the burden - the report must answer every substantive peer argument
  or move.
- A peer that fails, times out, or returns unusable output is recorded as unavailable and
  never silently retried or replaced with an invented voice (CE rule: peer failure produces
  a solo verdict plus an availability note).

## 6. Grade (Phase 6)

Grade the final recommendation on the CE scale, adapted to atlas's evidence floor:

| Grade | Meaning | Bar |
|---|---|---|
| **Adopt** | Evidence supports it now | Fits existing repo patterns; both floors met at 75+ confidence; cost/risk dominated by alternatives; no open "what would flip it" item |
| **Trial** | Plausible, unproven here | Fits patterns but no in-repo proof; time-boxed pilot with explicit success criteria and a named owner |
| **Hold** | Promising, not ready | A floor gap remains, or an external fact (version, adoption, upstream fix) blocks it; name the trigger that reopens the question |
| **Reject** | Evidence contradicts it | Conflicts with existing architecture/patterns, evidence favors an alternative, or costs dominate |
| **Not-our-problem** | Outside atlas's boundary | The question's deciding facts belong to vendor behavior, org policy, hardware, or another team's contract; answer only the part that is ours |

Hard rule: **a grade without at least one dossier citation is invalid.** The grade is the
one-line takeaway; the citation is what makes it trustworthy.

## 7. Deliver and record (Phase 6 continued)

- **Default**: report in chat - framing, dossier summary, verdict, (optional) peer
  reconciliation, grade. Read-only; nothing else.
- **Durable record** (when the decision is worth keeping): write
  `docs/decisions/<YYYY-MM-DD>-<slug>.md` - date-first per the docs SSOT naming rules
  (`lint_docs_names.py` enforces this). Contents: framing packet, verdict, evidence list,
  peer reconciliation with movement records, grade with citations. Dispatch
  `atlas:docs-curator` for the write when available; otherwise write it directly
  (curator pass is overkill for a single decision record).
- **Stamp the ledger**: when the durable record exists, append the verdict to
  `.atlas/.run/findings.json` so the pipeline and completion gate see it:

  ```bash
  python3 "${CLAUDE_PLUGIN_ROOT}/scripts/atlas_finding.py" --id pov-<slug> --status verified \
      --title "<decision> -> <grade>: <position>" \
      --evidence "<run-dir>/atlas-verdict.md + <key file:line citation>"
  ```

  Carry the typed envelope fields (voice, position, confidence, external-check status,
  protected_subject, movement, grade - see `peer-dispatch.md` §schema) into the durable
  record so the entry is self-contained without the evidence dir.
- **No git operations.** The report, the evidence dir, and the durable record are the entire
  output. Commit/push/PR are never part of this skill.