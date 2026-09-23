---
name: atlas-prototype
description: 'Throwaway prototype runtime for questions that are cheaper to demonstrate than argue about. Builds an explicitly-throwaway implementation at the fidelity that can answer one high-uncertainty visual, interaction, or product-shape question - isolated run directory or scratch worktree, never product feature code - gets it running, composes atlas:ui-runtime-tester for live UI evidence, hands it to the human to react to, then promotes the settled decisions into an atlas-brainstorm/atlas-plan artifact or discards the code entirely. The human reacting to the real artifact is the verification of record; no headless run may fake it.'
when_to_use: a visual, interaction, or product-shape question that is cheaper to demonstrate than argue about
allowed-tools: Read, Glob, Grep, Bash, Edit, Write
argument-hint: '[question, brainstorm path, or plan path]'
---



# atlas-prototype

Apply the Operating Contract to this entire task. It is injected below.

```!
cat "${CLAUDE_PLUGIN_ROOT}/references/operating-contract.md"
```

If the contract did not load above, read `${CLAUDE_PLUGIN_ROOT}/references/operating-contract.md` and apply it before proceeding.

Build a throwaway prototype at the fidelity that can answer this question, before committing an approach that later work will treat as given. Then either promote the decisions or discard the code.

**Do not fake the dimension being tested.** Modality, fidelity, and medium all follow from that one rule. A question about how a flow or state model behaves is settled by driving it, so a screen that only looks like the product does not answer it. A question about how a layout or a mark reads is settled by seeing it at real finish, so a thin sketch does not answer it either. **The user's own perception settles the question - never your judgment of the artifact, and never a description of what it would look like.**

**Result:** the user decided how the product should work or feel against a prototype that did not fake what they were deciding.
**Next consumer:** `atlas-brainstorm` or `atlas-plan`, seeded with this run's decisions capsule; or nothing, if the recap in chat is the complete outcome.
**Done:** the user settled the questions that needed an artifact and the run is either promoted or discarded per `references/settle.md`. Their choice is the settlement, not a direction you inferred.
**Not:** a decision a cheap sketch settles, polish on a feature that already works, implementing the real thing, or shipping the prototype.

## The containment boundary (hard rule)

Prototype code is **throwaway by definition and quarantined by construction.** These are MUST-level rules with no exceptions granted by convenience:

1. **Isolated mode (default).** All prototype files live under `.atlas/.run/prototypes/<YYYY-MM-DD>-<slug>/` - a gitignored, ephemeral path that cannot collide with product source. Fallback when the user asks that nothing be left in the repo or the path is unavailable: `/tmp/atlas-prototypes-<uid>/<YYYY-MM-DD>-<slug>/`. Nothing under the run directory is committed, referenced by product code, or counted as feature work.
2. **Real-app mode (scratch branch/worktree only).** When the question needs the real application runtime, work on a dedicated scratch worktree: `git worktree add <sibling-path>-prototype-<slug> -b prototype/<slug>`. Never build prototype changes in the user's current working tree unless they explicitly ask for an in-place overlay, and never commit prototype code to the branch they were on.
3. **In-place overlay (only on explicit user ask).** Overlay edits touch the product tree, are never committed to the current branch, and are reverted when the try ends - restore only the files this run changed, never work it did not make. If a clean undo is impossible, name every file left modified rather than handing back a dirty tree. An overlay run leaves no artifact behind.
4. **Promotion moves prose, never code.** What survives a settled run is the decisions capsule (markdown), not the prototype source. The prototype path may be cited; no prototype file is copied into `docs/`, into a plan artifact, or into product code.
5. **Local-only.** Scratch branches are never pushed and no PR is opened without explicit user confirmation. The prototype is never deployed anywhere shared.
6. **Never delete a kept prototype.** Throwaway describes the code's status, not a standing request to remove it. If the user says keep it, it stays exactly where containment put it. Discard deletes only what this run created.
7. **Discipline leak test.** Before the run ends, `git status` in the product tree must show only what rule 3 allows. Anything else is a defect to fix before the run can settle.

## No human, no run

If there is no person to experience the prototype - a hands-off pipeline run, a headless invocation, or a calling skill that reports no human is present - **stop.** Do not start a preview or invent how it should feel. Return that this skill needs a human: the user's perception is the settlement mechanism, and a headless run cannot supply it.

## Run flow

| Phase | What happens | Reference |
|---|---|---|
| 1. Scope | Read the conversation and any named brainstorm/plan; dispatch `atlas:explorer` for the scoped repo read of what the question touches; classify narrow vs wide; size the build; get the go-ahead. | `references/scoping.md` |
| 2. Build | Write prototype code under the run directory at the fidelity the question needs; web by default; recreate, do not rebuild the app. | `references/building.md` |
| 3. Show | Serve it, verify the rendered result yourself (via `atlas:ui-runtime-tester` when UI-shaped), hand over the URL, and run the react/revise loop with the human. | `references/preview.md` |
| 4. Settle | Promote decisions into `atlas-brainstorm`/`atlas-plan` or recap; discard or keep the code per the user's call; stamp the outcome in `.atlas/.run/findings.json`. | `references/settle.md` |

Read each phase's reference before doing that phase's work. Read `references/craft-floor.md` additionally when the question is settled by *seeing* (layout, palette, density, mark) rather than by *driving* (flow, state model, control behavior); it carries the quality floor the render must clear.

## Speaking cadence

After they proceed, speak only when they can act on something new, in one short line naming what happened: a screen is up, the URL is live, or a blocker only they can lift. After each applied revision, one short line: what changed, and that the page reloaded or needs a reload. Silence while waiting for their reaction is correct; narrating build steps is not.

## The decisions capsule

Keep a run capsule at `decisions.md` in the run directory so the next skill does not need this session. It carries: the question, what was built, which question directory each screen sits in, what won and why, what was rejected, stated adjustments that were not in the prototype, and what is still open. Point at the prototype; do not reproduce it. Update it when you are confident a choice has settled - the user judged the artifact and chose. If you are not confident, do not write. The capsule is continuity, not a plan: promotion into durable docs is `references/settle.md`'s job.

## Boundary

atlas-prototype owns:

- Building, running, and revising explicitly-throwaway implementations whose purpose is to let the human decide a question by experiencing the artifact.
- The decisions capsule and the promote-or-discard settlement.

It does NOT own:

- **Deciding what to build.** That is `atlas-brainstorm` (which may itself call this skill for a rough visual probe; a probe is not a fidelity run).
- **Implementing the real thing.** Settled decisions flow to `atlas-plan` / `atlas-orchestrate`; this skill writes no product source except an explicitly-requested overlay, which it reverts.
- **Proving shipped work.** Runtime verification of real features belongs to `atlas:verifier` and `atlas-feature`/`atlas-frontend` flows. Here, the human's reaction is the verification of record - it is stamped to `.atlas/.run/findings.json` via `${CLAUDE_PLUGIN_ROOT}/scripts/atlas_finding.py` at settle time, not dispatched to a verifier agent, because no agent can re-run a human judgment.
- **Polish or iteration on a feature that already works.** That is `atlas-refactor` or `atlas-frontend` territory.

Composes with: `atlas:explorer` (scoped read, phase 1), `atlas:implementer` (in-place overlay edits only), `atlas:ui-runtime-tester` (live look and rendered-result evidence, phase 3), `atlas-brainstorm` / `atlas-plan` (promotion targets, phase 4), `atlas:docs-curator` (any durable doc the promotion writes, when a curator pass is warranted).
