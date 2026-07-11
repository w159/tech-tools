---
name: atlas-feature
description: Build a full-stack feature with verified evidence. Use when a request spans UI, API, and data and must ship working, not 'should work'.
when_to_use: a request spans UI, API, and data and must ship working, not 'should work'
disable-model-invocation: true
argument-hint: '[feature] [acceptance criteria] [stack] [constraints]'
---



Apply the Operating Contract to this entire task. It is injected below.

```!
cat "${CLAUDE_PLUGIN_ROOT}/skills/atlas-metis/references/operating-contract.md"
```

If the contract did not load above, read `skills/atlas-metis/references/operating-contract.md` and apply it before proceeding.

# `atlas-feature`

Build the feature described in `$ARGUMENTS` end to end: backend and frontend, with proof.

Inputs to read from `$ARGUMENTS`: the feature (what it does, for whom), acceptance criteria (specific and testable), stack (frontend framework, backend framework, datastore, auth), and constraints (auth model, data sensitivity, performance targets, anything regulated). If a required input is missing or ambiguous, ask once for it, then proceed.

## Pre-flight
- Read the existing backend layout (routes, services, models, config) and frontend layout (components, pages, hooks, utils) and match it. Do not invent a new structure.
- Look up any unfamiliar API, framework, or SDK via Context7 (or Microsoft Learn for Microsoft services) before using it. No memory-based API calls.

## Pick the shape: loop or single pass
- If this work is recurring or iterative (a sweep across many endpoints or screens, a build-fix cycle, an until-dry discovery pass, a migration, or a review round), invoke the `atlas-chronos` skill to select and instantiate the best-fit loop from the loop-library, then run that loop. Otherwise dispatch the squad directly for a single pass.

## Execute through the squad (parallel where independent)
Dispatch all independent jobs in ONE message (multiple Agent calls in a single message) so they run concurrently; keep roughly 4-6 in flight. ALWAYS close the wave with an independent atlas:verifier in a fresh context before integrating results.
- atlas:explorer: map where the new endpoints, models, and UI belong.
- backend-architect or atlas:implementer: add the API surface, services, and data access.
- frontend-developer: build the UI against the new endpoints.
- atlas:verifier: independently confirm each claim.
- atlas:ui-runtime-tester: confirm live UI behavior in the browser.

## Build rules
- Backend: validate all inputs; handle the error path; never hardcode secrets (read from env, add keys to .env.example); verify DB writes by reading them back; test the auth path, not just the happy path.
- Frontend: handle loading, empty, error, and success states; inline validation on inputs, not only on submit; mobile-first responsive; one design system (use the project's; a common default is Tailwind plus shadcn/ui).

## VERIFY (evidence required)
- Hit each endpoint with curl. Show the exact command and the actual response body, including one error-path call (bad auth or invalid input).
- Read back at least one DB write to prove it persisted.
- Visit each route after hot reload: confirm the console is clean and the route renders. Demonstrate all four UI states.

## REPORT
- Endpoints added, each with a sample curl call and its response.
- UI states demonstrated and the route each was shown on.
- Tests run and their output.
- Files changed (paths) and a short diff summary.
