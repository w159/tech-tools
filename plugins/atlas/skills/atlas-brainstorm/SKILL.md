---
name: atlas-brainstorm
description: Requirements elicitation for a WHAT before any HOW - ports CE ce-brainstorm as an interactive dialogue that classifies the work (software/non-software), scopes it into Lightweight/Standard/Deep tiers, grounds itself via an atlas:explorer dispatch plus optional Compound Pack citations, then runs one-question-at-a-time broad-to-narrow questioning bounded to atlas-prompt's question discipline, synthesizes 2-3 concrete approaches (always including one non-obvious option), and writes a requirements-only plan to docs/plans/<YYYY-MM-DD>-<slug>-brainstorm.md with stable requirement IDs and a Goal Capsule + Product Contract shape. Never writes product code and never includes implementation units - that is atlas-plan's job next.
when_to_use: a vague feature idea or request needs requirements elicited before planning
allowed-tools: Read, Glob, Grep, Bash, Edit, Write
argument-hint: '<the idea, feature, or request to brainstorm>'
---



# atlas-brainstorm

Apply the Operating Contract to this entire task. It is injected below.

```!
cat "${CLAUDE_PLUGIN_ROOT}/references/operating-contract.md"
```

If the contract did not load above, read `${CLAUDE_PLUGIN_ROOT}/references/operating-contract.md` and apply it before proceeding.

## Why this skill exists

Atlas plans well (`atlas-plan`) and executes well (`atlas-orchestrate`), but nothing elicits requirements from a genuinely vague idea. A vague request handed to a planner produces a confident plan over a guessed problem. This skill is the WHAT stage: it interrogates the idea against repo reality, resolves actor/outcome/scope/success gaps through dialogue, and leaves a requirements-only artifact stable enough for planning. It is a port of CE's `ce-brainstorm` (see `agent://CELoopSkillsDetail`, section 3) with atlas's control plane: grounding via the `atlas:explorer` agent instead of a bespoke scout script, Compound Packs instead of CE's strategy/concepts files, and date-first docs naming per `${CLAUDE_PLUGIN_ROOT}/skills/atlas-loop/references/docs-ssot.md`.

The output is **requirements-only**. It contains NO implementation units, NO file lists, NO test plans. Those belong to `atlas-plan`. If you find yourself writing "U-01: edit `src/foo.ts`", stop - that is a HOW.

Reference map (read each when its phase says so):

| Reference | Read when |
|---|---|
| `references/dialogue.md` | Phase 0-1 - resume/classify/scope tiers, grounding dispatch, one-question-at-a-time rules |
| `references/approaches.md` | Phase 2 - model elevation, 2-3 approaches, non-obvious option, synthesis confirmation |
| `references/plan-sections.md` | Phase 3-4 - artifact section contract, requirement IDs, Ready checks, docs-curator write, handoff |

## Phase 0 - Resume, classify, scope

Read `references/dialogue.md` sections "Resume" and "Classify and scope" first. In order:

1. **Resume:** glob `docs/plans/*-brainstorm.md` for an existing requirements-only plan covering this topic. If one exists, ask exactly: `Found an existing requirements-only plan for [topic]: <path>. Continue from this, or start fresh?` If continuing, re-read it and treat its settled decisions as fixed unless the user reopens them.
2. **Classify:** software vs non-software. Non-software work (docs, process, research) skips implementation-shaped dialogue and goes straight to a reduced Goal Capsule + Product Contract; do not force it through software framing.
3. **Scope tier** - assess, never ask:
   - **Lightweight** - one clear actor, an obvious pattern to follow, no user-visible design forks. Abbreviated dialogue: grounding may be a direct read instead of an explorer dispatch; dialogue may close after 1-2 questions if no blocking gap remains.
   - **Standard** - the default. Full grounding dispatch and dialogue.
   - **Deep** - multiple actors or integrations, irreversible product forks (pricing, data model, security posture), or explicitly high-stakes. Adds pressure tests, blindspot checks, and a full synthesis-confirmation pass.
4. **Coherent-work gate:** if the request bundles unrelated goals ("add dark mode AND migrate the DB AND write a blog"), split it - brainstorm the largest coherent piece and say the rest needs separate invocations.

## Phase 1 - Ground, then dialogue

Read `references/dialogue.md` sections "Grounding" and "Dialogue rules" in full before asking anything.

Grounding replaces CE's bespoke scout script with atlas machinery:

- **Software requests:** dispatch `atlas:explorer` (per `${CLAUDE_PLUGIN_ROOT}/skills/atlas-orchestrate/references/subagent-kit.md`, ToolSearch-first, read-only) to collect the relevant code surface: existing patterns for this feature area, conventions that constrain the design, adjacent error paths, and any prior art in `docs/`, `.atlas/findings/INDEX.md`, or `docs/lessons/`. Lightweight tiers may substitute a direct targeted read of 1-2 known files.
- **Compound Packs, conditional:** if `${CLAUDE_PLUGIN_ROOT}/scripts/atlas_packs.py` exists, run it (discover its actual CLI first via `--help`; do not guess flags) to pull any matched rules for this topic, and cite matched rules in dialogue and in the artifact as `(pack: <id>, <path>)`. If the script is absent, skip silently - never mention the absence to the user, never fabricate pack citations.

Then dialogue, broad to narrow, until exit criteria in the reference are met: one blocking question per turn, only questions discovery cannot answer, options-with-"Other" formatting per the atlas-prompt bounded-question pattern, and no second speculative round - whatever is still unknown becomes an explicit assumption.

## Phase 2 - Approaches

Read `references/approaches.md`. Elevate to a stated model of the user's actual goal, then synthesize **2-3 concrete approaches** for satisfying the requirements - one of which MUST be non-obvious (a different decomposition, a deliberate simplification, or an inverted assumption), not three flavors of the same idea. Present alternatives before the recommendation. Deep tier runs a synthesis-confirmation question before writing; Lightweight/Standard write once no blocking question remains.

## Phase 3 - Write the requirements plan

Read `references/plan-sections.md` in full. Compose the requirements-only artifact: Goal Capsule + Product Contract with stable `R-###` requirement IDs and no implementation content. Target path: `docs/plans/<YYYY-MM-DD>-<slug>-brainstorm.md` (today's date; filesystem-safe slug per docs-ssot; if a same-day same-slug file exists that is NOT the resume target, suffix `-2`). The write goes through `atlas:docs-curator` per the docs-ssot ownership boundary - you assemble, it writes - unless the host has no subagent dispatch, in which case write it directly and say so in the report.

Validate the four Ready checks (Complete, Consistent, Focused, Usable - defined in the reference) before handing off. A plan with any failed check is not done; fix the dialogue or the draft, do not hand off a known-broken artifact.

## Phase 4 - Verification and handoff

- **Verification:** dispatch `atlas:verifier` (subagent-kit shape, read-only) to adversarially check the written artifact against repo facts: every grounded claim traces to a real file/pattern, no placeholder or TBD survives, requirement IDs are stable and complete, scope is coherent. It stamps its verdict into `.atlas/.run/findings.json`. Lightweight tiers with zero external claims may skip the dispatch and run the Ready checks as the verification, saying so.
- **Handoff (interactive):** present exactly one recommendation, not a menu sprawl: **`atlas-plan`** - it consumes the Product Contract and produces the implementation-ready plan. If the requirements are already precise enough that planning adds nothing (rare - only when the plan would be a single mechanical unit), recommend going directly to **`atlas-orchestrate`**. Offer `atlas-prototype` explicitly when a visual/interaction fork was left unresolved, per `references/approaches.md`.
- **Handoff (noninteractive / return-to-caller):** return `status`, `artifact_path`, `requirement_count`, `open_assumptions`, `recommended_next` (`atlas-plan` | `atlas-orchestrate` | `atlas-prototype`), and `key_decisions`.

## Boundary

atlas-brainstorm owns: classification, grounding, dialogue, approach synthesis, and the requirements-only artifact. It does NOT own: writing `docs/` (atlas:docs-curator owns durable docs per docs-ssot), implementation planning (`atlas-plan`), execution (`atlas-orchestrate` + atlas agents), or any git action - it never commits, pushes, or opens a PR.
