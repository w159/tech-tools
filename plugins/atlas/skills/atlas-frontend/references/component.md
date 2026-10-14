# Component mode

Read `${CLAUDE_SKILL_DIR}/references/component-pattern.md` and follow the props, className, six-state, and file-pattern contract it defines. Seed a new file from `${CLAUDE_SKILL_DIR}/templates/component.seed.tsx` when starting from scratch.

Build the single reusable component described in `$ARGUMENTS`, defining its contract first and proving every state renders.

Inputs to read from `$ARGUMENTS`: the component (name and purpose), the props contract (props with types), and the backend contract it consumes (endpoints, payload shape, polling vs stream, cancel semantics). If a required input is missing or ambiguous, ask once for it, then proceed.

## Pre-flight
- Read the existing component library structure and match its conventions (file layout, prop typing, token usage).
- Look up any unfamiliar UI or streaming API via Context7 (or Microsoft Learn for Microsoft services) before using it.

## Execute through the squad (parallel where independent)
- atlas:explorer: locate the component library, tokens, and any sibling components to mirror.
- frontend-developer: define the contract, then implement the component.
- atlas:ui-runtime-tester: drive a harness page and confirm each state renders.
- atlas:verifier: independently confirm the contract and states hold.

## Build rules
- Define the contract first: props and events before any implementation. Make it framework-agnostic in shape.
- Resilient to backend behavior: slow responses, mid-flight cancellation, and partial failure each get an explicit visual state. Leave no state unhandled.
- Accessible: focus management, ARIA roles and labels, keyboard escape where it applies, reduced-motion respected.
- On-brand using the project's design tokens. No hardcoded colors, spacing, or fonts.

## VERIFY (evidence required)
- Render each state in a harness or story: idle, in-flight, success, cancelled, error, and partial. Show how each was triggered.
- Exercise one failure path live (slow or failing backend) and confirm the component holds its defined state.
- Confirm keyboard and reduced-motion behavior.

## REPORT
- The prop and event contract as implemented.
- Each state confirmed and how it was triggered.
- Accessibility checks performed, with evidence.
- Files changed (paths) and a short diff summary.
