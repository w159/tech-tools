---
name: atlas-polish
description: "Polish an already-functional UI through user-directed live browser feedback: observe the running app with atlas:ui-runtime-tester, iterate small visual/CSS/animation changes (spacing, transitions, micro-interactions, empty/loading/error state polish) via atlas:implementer, and converge interactively with the user reacting to each iteration. NOT new functionality, NOT whole-screen builds - a fast, narrow, already-built-surface refinement loop."
when_to_use: a working UI needs visual or interaction refinement before shipping
allowed-tools: Read, Glob, Grep, Bash, Edit, Write
argument-hint: '[branch or worktree to polish; blank = current checkout]'
---

Apply the Operating Contract to this entire task. It is injected below.

```!
cat "${CLAUDE_PLUGIN_ROOT}/references/operating-contract.md"
```

If the contract did not load above, read `${CLAUDE_PLUGIN_ROOT}/references/operating-contract.md` and apply it before proceeding.

Read `${CLAUDE_SKILL_DIR}/references/live-session.md` before resolving the target or starting any server - it owns workspace safety, dev-server resolution, reachability, and browser handoff.
Read `${CLAUDE_SKILL_DIR}/references/polish-loop.md` for the iteration protocol and close-out gate before the first change.

# `atlas-polish`

Put a working feature in front of the user and turn their live observations into focused UX fixes on the running page. The user drives what to inspect and change; you compose the atlas squad to execute each requested change and prove it landed.

## What this is - and what it is not

atlas-polish is a **fast, narrow, already-built-surface refinement loop**. It is distinct from every other atlas UI skill:

| Skill | Job |
|---|---|
| `atlas-frontend` | Builds or refactors **whole screens, flows, or components** on the design system, handling every state from scratch. |
| `atlas-component` | Builds **one new reusable component** that survives latency, cancellation, and partial failure. |
| `atlas-ux-test` | Autonomous persona-driven **QA sweep** of the whole client surface; finds bugs, does not apply taste. |
| `atlas-polish` (this) | Refines what already works: spacing, transitions, micro-interactions, motion, and the feel of empty/loading/error states - with the user judging each iteration live. |

If the request needs new functionality, a new component, or a screen that does not exist yet, stop and route to `atlas-frontend`, `atlas-component`, or `atlas-feature`. If it needs a QA sweep, route to `atlas-ux-test`. Polish edits behavior of appearance and interaction feel only; the feature contract stays frozen.

## Done when

The user ends the polish loop, every requested fix is reflected in the live feature or reported as blocked, the in-scope changes are saved in local commit(s), and a verdict for each change is stamped in `.atlas/.run/findings.json`. A server or checkout blocker also ends the run when it is reported with the evidence needed to resume.

## Boundaries

- **The user drives.** Never invent an autonomous polish checklist or expand into general QA. Do not start a review pass while they browse.
- **No default branch.** Never work on the repository's default branch (see `references/live-session.md`).
- **Local only.** This skill edits and locally commits polish changes; it never pushes and never opens a PR. Anything beyond a local commit is `atlas-ship`'s job.
- **Small and reversible.** One bounded change per implementer dispatch; the user sees before/after evidence before it counts as accepted.

## Run

1. **Get the live page ready.** Follow `references/live-session.md`: resolve the workspace (branch/worktree safety), resolve the dev-server start tuple (command, cwd, env, port) from the repo's own configuration - never guessed - reach the actual URL, and hand the verified URL to the user, opening a browser if the harness exposes one. A blocker here ends the run with evidence.
2. **Wait for observations.** Tell the user where the server is running and ask what could be better. They browse; you wait.
3. **Iterate.** Follow `references/polish-loop.md`: for each requested change, dispatch `atlas:implementer` for one bounded edit, then `atlas:ui-runtime-tester` to re-observe the live page and capture before/after evidence, then show the user and let them accept, reject, or refine. Repeat until they say done.
4. **Verify and close locally.** Run the convergence gate in `references/polish-loop.md`: final observation sweep, one independent `atlas:verifier` over the accepted set stamping `.atlas/.run/findings.json` via `python3 "${CLAUDE_PLUGIN_ROOT}/scripts/atlas_finding.py"`, then `atlas-commit` for the polish changes. Report the commit(s), the still-running server URL, and any residual blocker.
