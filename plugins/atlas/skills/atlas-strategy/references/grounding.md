# Grounding the strategy work

Required read at the start of Phase 0, before the repo model is built.

## The repo model

Build a working understanding of what this product is from two inputs with different jobs:

- **What the product is.** Stated intent (README, `docs/`, an existing strategy doc, sibling docs such as `PRODUCT.md` or `VISION.md`, `CONCEPTS.md`) and structure (what the code is organized around, what is public, what is tested) - the authority for the problem, approach, and persona questions. Bound the read to "what is this and who is it for"; do not profile the whole repo.
- **What is getting attention now.** Recent commits or PRs, plus plans under `docs/plans/` and findings under `.atlas/findings/INDEX.md`. Attention informs only the Tracks question and staleness in an update run. A burst of recent work is a fact about the last few weeks, not about what the product is; where it disagrees with stated intent, that is a question for the user - never a conclusion.

**Collecting it:** dispatch one `atlas:explorer` (read-only, per `plugins/atlas/skills/atlas-orchestrate/references/subagent-kit.md`) with the CONTEXT naming exactly the sources above and the bound ("what is this and who is it for", recent activity). For lightweight or near-empty repos, direct reads of the README and 1-2 doc files are an acceptable substitute - say which path you took.

**Market signal (optional, bounded):** when the Positioning question needs an external check - "who else does this, and what would the nearest competitor truthfully claim?" - run a bounded web search for the problem space and named competitors. Market findings are labeled as market signal in chat and cited with sources; they ground pushback and seed proposals exactly like repo findings do: proposed, confirmed or corrected by the user, never silently written.

## Showing the model

Show the repo model in chat before the first question: three to five lines on what you take the product to be, who it seems to serve, and where attention has gone, each with its source named. Invite correction. On a first run the interview then runs in full; an update run still revisits only the section Phase 2 settles on. If the model did not supply the product's name, ask for that here - the template's frontmatter and title need it.

A repo with no substantive content is a normal path: say so in one line and run the interview ungrounded.

## A repo-root strategy doc or legacy sibling

Atlas has no repo-root `STRATEGY.md` convention, but a target project may have one (or a legacy sibling `VISION.md`/`PRODUCT.md` from another tool). When one exists:

- **Adapt in place:** if the user treats that file as the project's strategy home, treat it as the artifact. Read it by meaning, apply the ownership test in `references/update-run.md`, and edit only in its own shape - never restructure a doc you did not author.
- **Fold:** on a first run with a legacy sibling and no atlas doc, offer the user the choice of folding it in or linking to it. Folding: carry the sibling's meanings into the new doc in the author's words, put contradictions to the user, say the sibling is now redundant - and leave its removal to the user (this skill never deletes a user's file). Linking: leave the sibling where it is and point to it from the new doc's opening line; do not restate what it says.
- **Never edit a doc the user does not own.** A section carrying an author-approved marker (e.g. `<!-- <tool>: author-approved 2026-07-10 -->`) is not edited at all - report the conflict, or write a separate file that links to it.

## Focus hint

Any argument this skill was invoked with - present in the current prompt or conversation, from the user or a calling skill - is a focus hint: a section to revisit (`metrics`, `positioning`, `tracks`, `purpose`, `users`, `boundaries`; older names such as `approach` or `who it's for` map to `positioning`) or a scope hint. With none, proceed open-ended and let the file state decide the path.
