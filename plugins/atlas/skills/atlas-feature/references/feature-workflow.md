# Feature Workflow: spec -> tests -> impl -> verify

The end-to-end shape an `atlas-feature` run takes. Each phase has one
failable check. The order is load-bearing: skipping a phase leaves
either a broken feature or an unverified one.

## Phase 0 - Pre-flight (discover before designing)

- Read the existing backend layout (routes, services, models, config)
  and frontend layout (components, pages, hooks, utils) and match it.
  Do not invent a new structure.
- Look up any unfamiliar API, framework, or SDK via Context7 (or
  Microsoft Learn for Microsoft services) before using it. No
  memory-based API calls.
- **Check:** you can name the file where each new endpoint, model, and
  UI component will live before writing any of them.

## Phase 1 - Spec

- Write the feature spec from `$ARGUMENTS`: the feature (what it does,
  for whom), acceptance criteria (specific and testable), stack, and
  constraints (auth model, data sensitivity, performance, regulatory).
- If a required input is missing or ambiguous, ask once, then proceed.
- **Check:** every acceptance criterion is testable and names an
  observable behavior, not a feeling.

## Phase 2 - Tests (red)

- Write the failing tests for each acceptance criterion before any
  implementation. Backend: endpoint tests, service tests, repository
  tests. Frontend: component tests for each state (loading, empty,
  error, success).
- Run the tests; watch them fail for the right reason.
- **Check:** the tests fail because the feature does not exist, not
  because of a typo in the test. If a test passes before implementation,
  it is testing the wrong thing.

## Phase 3 - Implementation (green)

- Dispatch all independent jobs in ONE message (multiple Agent calls
  in a single message) so they run concurrently; keep roughly 4-6 in
  flight. ALWAYS close the wave with an independent atlas:verifier in a
  fresh context before integrating results.
  - atlas:explorer: map where the new endpoints, models, and UI belong.
  - backend-architect or atlas:implementer: add the API surface,
    services, and data access.
  - frontend-developer: build the UI against the new endpoints.
- Backend rules: validate all inputs; handle the error path; never
  hardcode secrets (read from env, add keys to .env.example); verify DB
  writes by reading them back; test the auth path, not just the happy
  path.
- Frontend rules: handle loading, empty, error, and success states;
  inline validation on inputs, not only on submit; mobile-first
  responsive; one design system (use the project's; a common default is
  Tailwind plus shadcn/ui).
- **Check:** the tests from Phase 2 pass, and the implementation does
  not add a new dependency without justification.

## Phase 4 - Verify (evidence)

- Hit each endpoint with curl. Show the exact command and the actual
  response body, including one error-path call (bad auth or invalid
  input).
- Read back at least one DB write to prove it persisted.
- Visit each route after hot reload: confirm the console is clean and
  the route renders. Demonstrate all four UI states.
- **Check:** every "done" claim carries its evidence (command and
  output) in the same message. A claim whose evidence is in a different
  message does not count.

## Phase 5 - Report

- Endpoints added, each with a sample curl call and its response.
- UI states demonstrated and the route each was shown on.
- Tests run and their output.
- Files changed (paths) and a short diff summary.

## When to loop vs single pass

- If this work is recurring or iterative (a sweep across many endpoints
  or screens, a build-fix cycle, an until-dry discovery pass, a
  migration, or a review round), invoke the `atlas-chronos` skill to
  select and instantiate the best-fit loop from the loop-library, then
  run that loop.
- Otherwise dispatch the squad directly for a single pass as above.