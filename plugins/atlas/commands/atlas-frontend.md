---
description: Build or refactor UI on a single design system (shadcn/ui + Tailwind + Radix by default) with every state handled and verified live. Use for screens, flows, or component work on the frontend.
argument-hint: "[project] [screens/flows] [design intent]"
---

Apply the Operating Contract to this entire task. It is injected below.

```!
cat "${CLAUDE_PLUGIN_ROOT}/skills/atlas-engine/references/operating-contract.md"
```

If the contract did not load above, read `skills/atlas-engine/references/operating-contract.md` and apply it before proceeding.

# /atlas-frontend

Build or refactor the UI described in `$ARGUMENTS` on one design system, then prove it works in the browser.

Inputs to read from `$ARGUMENTS`: the project (name, what it is), scope (screens, flows, or components to build or refactor), and design intent (tone, density, brand). Pull brand colors and fonts from the project's own design token file; never hardcode them. If a required input is missing or ambiguous, ask once for it, then proceed.

## Pre-flight
- Read the existing component structure, the central token file, and the routing setup, and match the conventions already in use.
- Look up any unfamiliar UI library or framework API via Context7 (or Microsoft Learn for Microsoft services) before using it.

## Execute through the squad (parallel where independent)
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
