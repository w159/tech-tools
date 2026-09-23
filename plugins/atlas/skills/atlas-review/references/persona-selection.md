# Persona Selection

Phase 3 of `atlas-review`. The roster is a judgment about risk in THIS diff, not a keyword scan. Read the diff, then apply the triggers below. When a signal is genuinely ambiguous, activate the persona — a wasted reviewer is cheaper than a blind spot.

## Always on

- **correctness** — every run, every diff. Logic errors, broken invariants, incorrect edge-case handling, off-by-one, null/undefined propagation, wrong operator, inverted condition.

## Conditional personas and their exact trigger signals

| Persona | Activate when the diff contains… | Mechanics |
|---|---|---|
| security | auth logic, session/token handling, public or unauthenticated endpoints, new input parsing of external data, permission/authorization checks, secrets (hardcoded values, secret-reading code, secret files added), crypto use | injection, broken authn/authz, secret exposure, insecure deserialization, missing rate/size limits |
| performance | query shape changes (N+1 risk, missing filters), algorithm or data-structure swaps, large transforms/loops over collections, cache reads/writes/invalidation, hot-path changes | complexity regressions, unbounded queries, cache-coherence bugs, redundant work in loops |
| data-migration | migration files, schema changes (DDL), backfill scripts, data transform jobs, index changes | forward/backward safety, destructive operations, lock/downtime risk, backfill idempotency, test-vs-prod schema parity |
| maintainability | ~200+ executable lines total, OR structural invasiveness (new module boundaries, heavy indirection, copied logic across files, deeply nested control flow added) | naming, duplication, abstraction fit, dead weight, second-convention violations |
| testing | test files or harness changed, OR behavior changed with no test work anywhere in the diff | missing coverage for new behavior, weakened assertions, tests coupled to implementation, missing red/regression case |
| reliability | error handling, retries, timeouts, circuit breakers, background jobs/queues, schedulers, cleanup/finally paths | swallowed errors, missing timeouts, retry storms, non-idempotent handlers, shutdown ordering |
| api-contract | public API surface changed (exported functions, HTTP endpoints, CLI flags, events/messages, SDK boundaries, published types) | breaking changes, versioning, backward compatibility, error-shape stability, doc/comment contract drift |
| agent-native | files under skills/, agents/, prompts/, tool definitions, MCP config, or any agent-facing product surface (instructions the model reads) | prompt-injection surface, ambiguous instructions, tool-schema errors, missing frontmatter, broken discovery metadata |
| learnings | a matching entry under `docs/lessons/` exists for the touched area, or a declared Compound Pack covers it | does the change violate a recorded lesson or repeat a documented root cause? |
| adversarial | diff is large, OR touches persistence/auth/payment/event-publishing/retry/concurrency/external-API code, OR adds a silent-pass path (catch-and-continue, default-allow, fail-open) | assumes malicious input and adversarial timing; hunts for what the other reviewers' framings let through |
| previous-comments | the PR/branch carries prior review comments (human or bot) | verify each prior comment is actually addressed, not just replied to; flag re-introduced regressions |
| standards | repo declares coding standards that apply to the diff: `CODING_STANDARDS.md`, `CLAUDE.md`, `AGENTS.md`, `docs/architecture/` conventions | conventions defined by those files only — a standards reviewer with no standards source is skipped, not invented |

## Roster judgment rules

- **Signals beat size.** A 15-line auth change summons security + adversarial. A 600-line docs change summons correctness only.
- **Compound signals stack.** A migration that touches auth tables triggers both data-migration and security.
- **Cap the wave.** With bounded concurrency (~4-6 in flight), a roster of 8+ personas runs in two batches. Correctness, security, and adversarial go in the first batch (highest expected value, longest runtime).
- **Suppression hierarchy** (applies inside every persona asset, restated in `findings-envelope.md`): style/lint-only complaints, pre-existing issues outside the diff, intent violations without evidence, already-handled issues, and speculative "might be nice" concerns are all suppressed. A persona that returns zero findings is a valid result — do not re-dispatch to manufacture findings.
- **Announce the roster.** The report names each reviewer and the trigger that summoned it. A roster the reader cannot audit is a roster they cannot trust.

## Roster ↔ asset map

Each selected persona maps 1:1 to `references/personas/<name>.md`. If a triggered persona has no asset file, that is a broken skill — note it in the report under Coverage and run correctness-only rather than improvising an unversioned persona prompt mid-run.
