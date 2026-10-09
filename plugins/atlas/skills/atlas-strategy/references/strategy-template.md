# Strategy template

Loaded by `SKILL.md` after the interview is complete. Fill it in using the captured answers and write to the artifact per the artifact-location rules in `SKILL.md` (default `docs/architecture/product-strategy.md`; through `atlas:docs-curator` when subagent dispatch is available).

## Rules for filling in

- Use the user's own language where possible. Do not paraphrase into generic PM-speak.
- Sections this skill writes stay compact - together they should read in under 5 minutes.
- Write the sections below in this order. Optional sections (Milestones, Brand): delete entirely if unused. Do not leave empty headers. Boundaries is always present.
- Set `last_updated` in the YAML frontmatter to today's ISO date (YYYY-MM-DD). Do not duplicate the date in prose - the doc is a living artifact under `docs/architecture/` (bare slug per the docs-ssot naming rules; the linter rejects date-first names for living docs).
- Set `product` in the frontmatter to the product or initiative name (the same value used in the H1 title).
- A section written from repo+market grounding without a user answer MUST carry the label `_Repo-derived - needs owner review._` directly under its heading.

## Template

The block below is the literal file to write (minus this line and the fences). Replace every `{{placeholder}}` with the captured answer. Delete any optional section whose placeholder wasn't answered.

~~~markdown
---
product: {{product_name}}
last_updated: {{YYYY-MM-DD}}
---

# {{product_name}} Strategy

{{If the project keeps a separate strategy home - a repo-root STRATEGY.md or legacy VISION.md/PRODUCT.md the user chose to link rather than fold - one line here pointing to it, e.g. "See STRATEGY.md for the project's principles; this document carries direction." Then do not restate what that doc already says. Omit the line when none exists.}}

## Purpose

{{1-2 sentence diagnosis. Names the user situation and the crux that makes it hard, and so why the product exists. No solution language.}}

## Positioning

{{1-2 sentence guiding policy. The choice this product commits to that a neighboring product could not truthfully claim, so that the purpose becomes tractable.}}

## Users

**Primary:** {{Persona name}} - {{one-sentence JTBD, e.g. "They're hiring {{product_name}} to..."}}

<!-- Duplicate the block above for additional personas only if truly necessary. Fewer is better. -->

## Boundaries

- {{one line per item the team is tempted by and has decided against; "Nothing named yet." if none}}

_Resist a change when:_ {{one line, from the proposals the user resisted in the stress test; omit the line if none}}

<!-- Always present. Things the team keeps being tempted by, plus the resist test. Not a blocker list. -->

## Key metrics

- **{{metric 1 name}}** - {{one-line definition; where it's measured}}
- **{{metric 2 name}}** - {{...}}
- **{{metric 3 name}}** - {{...}}

<!-- 3-5 total. Stop at 5. -->

## Tracks

### {{Track 1 name}}

{{One line: what this track is - the investment area, not a feature list.}}

_Why it serves the approach:_ {{one line}}

<!-- Duplicate the block above for 2-4 tracks total. If you can't keep it to 4, something is wrong - fold related tracks together. -->

## Milestones

- **{{YYYY-MM-DD}}** - {{milestone}}

<!-- Optional. Delete the section if unused. Only externally visible milestones: launches, fundraises, conferences, renewals. -->

## Brand

**One-liner:** {{single-sentence pitch}}

**Key message:** {{2-3 lines if useful}}

<!-- Optional. Delete the section if unused. -->
~~~

## Post-write checklist

Before confirming the write, scan the draft for:

- [ ] Frontmatter present at the top with `product` and `last_updated` keys.
- [ ] `last_updated` carries today's date in ISO format (YYYY-MM-DD).
- [ ] No section has more than 4 sentences except Tracks (where each track has its own short block).
- [ ] No placeholders remain (`{{...}}`).
- [ ] Optional sections (Milestones, Brand) with no content have been deleted, not left empty; Boundaries is present.
- [ ] Metric count is between 3 and 5 and track count between 2 and 4.
- [ ] Purpose and Positioning are connected - one clearly responds to the other.
- [ ] Every repo-derived section is labeled `_Repo-derived - needs owner review._`
- [ ] No features, schedules, or in-flight work reconciliation crept in - the doc is an anchor, not a plan.
