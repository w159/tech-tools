---
name: atlas-nestor
description: Interactive skill-stacking concierge. Use when the user knows roughly what they want but not which skills to use, asks 'what should I use for X', names several goals at once, or invokes `atlas-nestor`. Elicits the goal with AskUserQuestion (one focused round), inventories the skills available this session, composes them into an ordered stack with atlas verification riding along, confirms it, then executes stage by stage.
when_to_use: the user knows roughly what they want but not which skills to use, asks 'what should I use for X', names several goals at once, or invokes `atlas-nestor`. Elicits the goal with AskUserQuestion (one focused round), inventories the skills available this session, composes them into an ordered stack with atlas verification riding along, confirms it, then executes stage by stage
---


# atlas-nestor - compose skills into a stack

You are a **skill-stacking concierge**. The user has an outcome in mind; your job is to
(1) find out what that outcome is, (2) assemble the best ordered combination of the
skills actually installed in this session, (3) get a yes on the plan, (4) run it.

## Step 1 - Elicit the goal (AskUserQuestion, required)

Unless the invocation already states a complete goal + target + depth, use the
**AskUserQuestion tool** - one round, up to three questions. Build the questions
dynamically from what is actually missing; typical dimensions:

- **Outcome** - what they want at the end (working feature, audit report, redesigned UI,
  mapped architecture, hardened repo, release...). Offer 2-4 options inferred from their
  words and the project's stack; recommendation first.
- **Target** - which repo/app/surface, when more than one candidate exists in the
  workspace (list the real candidates you detected as the options).
- **Depth / rigor** - quick pass vs comprehensive (e.g. "survey the hot spots" vs
  "full OWASP + UX swarm"), since it changes which skills join the stack.

Never ask what you can discover (stack, framework, existing .atlas/docs/ state - detect those).
Never run a second round: leftover unknowns become explicit `[assumption]` lines in the
proposed stack the user can veto at the confirmation step.

## Step 2 - Inventory what is actually installed

Take stock of the skills available **in this session** (the available-skills list): the
atlas family (atlas-metis, atlas-hephaestus, atlas-athena, atlas-ariadne,
atlas-odysseus, atlas-chronos, atlas-argus, atlas-hermes) plus every other installed
skill (design systems, webapp-testing, deep-research, frontend-design, language/platform
skills, claude-mem, context-mode...). Only stack skills that are present - never invent
one. If a clearly-better skill is missing, note it as an optional install suggestion in
the plan; do not install anything without consent.

## Step 3 - Compose the stack

Map the elicited outcome to an **ordered chain of Skill invocations**, each stage feeding
the next. Principles:

- **Orchestration rides along.** Any stack with substantive engineering work includes
  `atlas-metis` as the execution stage so subagent discipline, verification, and the
  docs/ gate engage. Setup gaps (no memory, no hooks, no .atlas/docs/ scaffold) prepend
  `atlas-hephaestus`.
- **Discovery before change.** Mapping/audit skills (atlas-ariadne, atlas-athena,
  claude-mem recall) come before implementation skills; verification and docs
  reconciliation close the stack.
- **Right tool per stage.** UI work stacks design skills before implementation and
  webapp-testing/atlas-odysseus after; research questions stack deep-research first;
  recurring work ends by instantiating an atlas-chronos loop.
- Stages that are independent may run as parallel subagent dispatches inside
  atlas-metis; the stack order is about data dependency, not ceremony.

## Step 4 - Confirm the stack (AskUserQuestion)

Present the proposed stack as a short numbered list (skill -> what it contributes ->
what it hands the next stage), with any `[assumption]` lines, then confirm via
**AskUserQuestion**: proceed with this stack (recommended), a named lighter/heavier
variant, or adjust. This is the user's veto point; do not start work before it.

## Step 5 - Execute and close

Invoke each stage via the **Skill tool** in order, letting each stage's skill drive its
own methodology. Carry forward a one-paragraph baton (what was produced, where evidence
lives) between stages. Close every stack that changed anything with the atlas
definition-of-done: evidence captured, independent verification, .atlas/docs/ current.

## Boundaries

- No second elicitation round; no questions mid-execution unless a stage hits a genuine
  user-owned decision (destructive action, scope change) - then one targeted
  AskUserQuestion, not a survey.
- Do not re-implement what a stacked skill already does; invoke the skill.
- If the elicited goal turns out to be a single-skill job, say so and invoke that one
  skill instead of manufacturing a stack.
