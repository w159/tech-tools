---
name: atlas-frontend
description: "Builds, refactors or polishes frontend UI on one design system (shadcn/ui, Tailwind, Radix), verified live in the browser. Modes: build (screens, flows), component (one reusable async component), polish (live visual refinement). Use when creating or reworking UI."
when_to_use: "build a screen, shadcn, Tailwind, Radix, refactor UI, design system, form, dashboard, page, async component, progress modal, upload widget, job panel, polish the UI, tweak spacing, animation, final UI touches"
allowed-tools: Read, Glob, Grep, Bash, Edit, Write
paths: ["**/*.tsx", "**/*.css", "**/*.scss", "components/**"]
argument-hint: '[build|component|polish] [project] [screens/flows] [design intent]'
---



Apply the Operating Contract to this entire task. It is injected below.

```!
cat "${CLAUDE_PLUGIN_ROOT}/references/operating-contract.md"
```

If the contract did not load above, read `${CLAUDE_PLUGIN_ROOT}/references/operating-contract.md` and apply it before proceeding.

Read `${CLAUDE_SKILL_DIR}/references/frontend-states.md` and apply the loading/empty/error/success, accessibility, and responsive rules it defines to every screen you touch.

# `atlas-frontend`

Three modes, picked from the first argument or the ask:

| Mode | When | Detail |
|---|---|---|
| build (default) | Screens, flows or components to build or refactor | this file |
| component | One new reusable component that survives latency, cancellation and partial failure | `references/component.md` |
| polish | An already-working UI needs spacing, motion or micro-interaction refinement, with the user judging live | `references/polish.md` |

For component or polish mode, read the named reference and follow it; the build steps below do not apply. The mode switch is done once that reference has been read.

Build or refactor the UI described in `$ARGUMENTS` on one design system, then prove it works in the browser.

Inputs to read from `$ARGUMENTS`: the project (name, what it is), scope (screens, flows, or components to build or refactor), and design intent (tone, density, brand). Pull brand colors and fonts from the project's own design token file; never hardcode them. If a required input is missing or ambiguous, ask once for it, then proceed.

## Pre-flight
- Read the existing component structure, the central token file, and the routing setup, and match the conventions already in use.
- Look up any unfamiliar UI library or framework API via Context7 (or Microsoft Learn for Microsoft services) before using it.

## Pick the shape: loop or single pass
- If this work is recurring or iterative (a sweep across many screens or components, a build-fix cycle, an until-dry discovery pass, a migration, or a review round), invoke the `atlas-loop` skill to select and instantiate the best-fit loop from the loop-library, then run that loop. Otherwise dispatch the squad directly for a single pass.

## Execute through the squad (parallel where independent)
Dispatch all independent jobs in ONE message (multiple Agent calls in a single message) so they run concurrently; keep roughly 4-6 in flight. ALWAYS close the wave with an independent atlas:verifier in a fresh context before integrating results.
- atlas:explorer: locate the relevant components, tokens, and routes.
- frontend-developer: build or refactor the screens and components.
- atlas:ui-runtime-tester: confirm observed behavior in a real browser.
- atlas:verifier: independently confirm the claims hold.

## Build rules
- One design system: shadcn/ui components, Tailwind utilities, Radix primitives. Do not mix in MUI, Bootstrap, or Chakra.
- Central tokens for color, spacing, and typography. No magic values scattered in components.
- Every async surface handles loading, empty, error, and success. No dead screen during latency.
- Inline validation on inputs. Mobile-first; verify at a narrow width.
- Accessibility: keyboard reachable, visible focus, labeled controls, sufficient contrast.

## VERIFY (evidence required)
- Visit each route after hot reload. Confirm the console is clean.
- Reach and show all four states (loading, empty, error, success) on each data-driven surface.
- Confirm responsive layout at mobile width and that keyboard navigation works.

## REPORT
- Screens and components built or refactored, with their routes.
- Each state confirmed and the route it was shown on.
- Console-clean and responsive checks, with the evidence captured.
- Files changed (paths) and a short diff summary.

## Mode references

Open each when its mode reaches that step:

- `references/component-pattern.md`: component mode: props, className, six-state and file-pattern contract
- `templates/component.seed.tsx`: component mode: seed for a new component file
- `references/live-session.md`: polish mode: workspace safety, dev-server resolution, browser handoff
- `references/polish-loop.md`: polish mode: iteration protocol and close-out gate
