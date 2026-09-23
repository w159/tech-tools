---
name: atlas-strategy
description: Product strategy anchor - ports CE ce-strategy as a one-question-at-a-time interview (purpose, positioning, users, metrics, tracks, stress test, boundaries, optional milestones/brand) that writes or refreshes the durable strategy doc at docs/architecture/product-strategy.md (or adapts an existing repo-root STRATEGY.md in its own shape). Grounded by an atlas:explorer dispatch building a repo model - what the product is and where attention is going - used only to sharpen questions and seed proposals the user confirms or corrects, never to silently derive strategy. Runs a pushback pass on weak answers, a stress test that checks the strategy actually decides things, and a drift-aware update run that preserves every other section. Output is citable by atlas-brainstorm and atlas-plan as optional grounding input. Never writes product code, never edits the tracker or roadmap.
when_to_use: starting a product, adding a strategy doc, or changing direction or roadmap
allowed-tools: Read, Glob, Grep, Bash, Edit, Write
argument-hint: '[optional: section to revisit, e.g. metrics, positioning, tracks]'
---



# atlas-strategy

Apply the Operating Contract to this entire task. It is injected below.

```!
cat "${CLAUDE_PLUGIN_ROOT}/references/operating-contract.md"
```

If the contract did not load above, read `${CLAUDE_PLUGIN_ROOT}/references/operating-contract.md` and apply it before proceeding.

## Why this skill exists

Atlas plans and executes well, but nothing captures *what the product is and why* - the anchor that makes "is this work on-strategy?" answerable. This skill is a port of CE's `ce-strategy` (the STRATEGY.md anchor) with atlas's conventions: the durable artifact lives under `docs/` per `${CLAUDE_PLUGIN_ROOT}/skills/atlas-loop/references/docs-ssot.md` instead of a repo-root `STRATEGY.md` convention atlas does not have, grounding runs through the `atlas:explorer` agent instead of ad-hoc reads, and verification runs through `atlas:verifier`. Rumelt's kernel (diagnosis / guiding policy / coherent action) structures the interview: Purpose, Positioning, Tracks - plus Users, Key metrics, Stress test, and Boundaries.

**Boundaries (non-negotiable, inherited from CE):**

- **Anchor, not plan.** Strategy is what the product is and why. Features belong in `atlas-brainstorm`, schedules and prioritization in `docs/ROADMAP.md`, implementation plans in `atlas-plan`. Do not let them creep into the doc; do not update the tracker or reconcile in-flight work.
- **The user answers; the repo only grounds the question.** The repo model is used to ask a sharper question and to *seed a proposed answer the user confirms or corrects* - it is never silently written into a section. Where the user is absent or declines to answer, a section may be written from repo+market signals only if explicitly labeled `_Repo-derived - needs owner review._` in the doc and named in chat as worth revisiting. That is a completed run, not a fabrication.
- **Short is a feature.** Push back on expansion rather than adding sections.
- **Record which metrics matter and where they live**, not what they read today.
- **Meaning is the contract; the shape belongs to whoever created the doc.** See `references/update-run.md` before editing any existing strategy doc.

Reference map (read each when its phase says so):

| Reference | Read when |
|---|---|
| `references/grounding.md` | Phase 0 - before building the repo model; legacy-sibling and focus-hint rules |
| `references/interview.md` | Phase 1 before the first question; revisited per-section in Phase 2 |
| `references/strategy-template.md` | Phase 1, after the interview - the literal file shape |
| `references/update-run.md` | Phase 2 - before reading, questioning, or editing any existing doc |

## Artifact location

The strategy doc is **living state**, so per the docs-ssot naming rules (enforced by `${CLAUDE_PLUGIN_ROOT}/scripts/lint_docs_names.py`) it takes a bare slug, not a date prefix - the revision date lives in the doc's frontmatter (`last_updated`):

- **Default target:** `docs/architecture/product-strategy.md`.
- If the target project already carries strategy at a **repo-root `STRATEGY.md`** (or legacy sibling `VISION.md`/`PRODUCT.md`): do NOT duplicate it. Follow `references/grounding.md` - either adapt that file in its own shape (respecting the ownership test) or write the atlas doc as a separate file that links to it. Never edit a doc the user does not own.
- A doc solely authored by this skill is maintained in house format (`references/strategy-template.md`) on every write.

## Phase 0 - Ground and route

Read `references/grounding.md` first - a non-optional load; it carries the source list, the disagreement-question wording, legacy-sibling handling, and focus-hint rules.

Build the **repo model** - a 3-5 line working understanding of what the product is, who it serves, and where attention has gone, each line with its source named - from two inputs: stated intent + structure (what the product is) and recent commits/PRs (what is getting attention). Dispatch **one** `atlas:explorer` (read-only, per `${CLAUDE_PLUGIN_ROOT}/skills/atlas-orchestrate/references/subagent-kit.md`) to collect it; lightweight or empty-repo cases may substitute direct reads of README/docs. Positioning that needs an external check may use a bounded web search for competitor/market context - clearly labeled as market signal, never written into a section unlabeled.

Show the model in chat and invite correction. If it did not supply the product's name, ask for it here. A repo with no substantive content is a normal path: say so in one line and run the interview ungrounded.

Route in one line by file state: no strategy doc -> Phase 1 ("No strategy doc found - let's write it."); one exists -> Phase 2 ("Found an existing strategy - let's review and update.").

## Phase 1 - First-run interview

Read `references/interview.md` before the first question - a non-optional load. The opening questions, pushback rules, anti-pattern examples, quality bar, blocking-question rules, two-round cap, and the stress test live there; improvising from memory produces a passive transcription instead of a strategy doc.

Run the interview in this order (Boundaries is asked after the stress test, where its content comes from):

1. Purpose
2. Positioning
3. Users
4. Key metrics
5. Tracks
6. Stress test
7. Boundaries (always written)
8. Milestones (optional)
9. Brand (optional)

When every section is captured, read `references/strategy-template.md`, fill it in, present the full draft in chat, offer one round of edits, then write the doc - through `atlas:docs-curator` per the docs-ssot ownership boundary (you assemble, it writes), unless the host has no subagent dispatch, in which case write directly and say so in the report.

## Phase 2 - Update run

Read `references/update-run.md` first - a non-optional load, before the summary, the drift check, or any question. It decides how drift candidates are raised, which section is revisited, and what is preserved untouched. Summarize the file's current state in 3-5 lines, name sections the repo model suggests are stale as candidates (never verdicts), then revisit the section the argument named (focus hint) or the one the user picks. Every other section's content is left untouched; placement follows the ownership test. Questions and pushback come from `references/interview.md`, applied as if this were a first run - existing weak content is not rubber-stamped because it is already written.

## Phase 3 - Verification and downstream handoff

- **Verification:** dispatch `atlas:verifier` (fresh context, read-only) to check: the doc exists at the right path in template shape, no placeholder or TBD survives, repo-grounded claims trace to real files, and any repo-derived section is explicitly labeled. Stamp the verdict into `.atlas/.run/findings.json` per `${CLAUDE_PLUGIN_ROOT}/skills/atlas-orchestrate/references/verification-and-grounding.md`:

```
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/atlas_finding.py" --id strategy-<YYYY-MM-DD> \
  --status verified --title "strategy doc authored/refreshed (<section scope>)" \
  --evidence docs/architecture/product-strategy.md --category strategy
```

- **Downstream handoff (one line):** name the doc path and that **`atlas-brainstorm` and `atlas-plan` pick it up as an optional grounding input** on their next run (cite it as `docs/architecture/product-strategy.md#<section>` when a requirement or plan claims strategy alignment). If neither has run in this project yet, suggest `atlas-brainstorm` as a natural next step for the first piece of on-strategy work.

## Boundary

atlas-strategy owns: the repo model, the interview, the stress test, and the strategy doc. It does NOT own: features/requirements (`atlas-brainstorm`), implementation planning (`atlas-plan`), execution (`atlas-orchestrate` + atlas agents), the roadmap or issue tracker, telemetry facts (`atlas-pulse` reads the doc for product name and metrics but owns its own reports), or any git action - it never commits, pushes, or opens a PR.
