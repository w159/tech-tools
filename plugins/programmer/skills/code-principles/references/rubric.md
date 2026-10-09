# Code Review Rubric

The reviewer's operational rubric. One section per lens. For each lens: what good
looks like, what bad looks like, and concrete review signals. The lens map and
source books live in `books.md`.

## Shared contract

For each finding return:
- `category`: one of `architecture`, `correctness`, `craft`, `security`, `data`, `process`.
- `severity`: one of `blocker`, `major`, `minor`, `note`.
- `finding`: one clear sentence naming the issue.
- `principle`: one short principle name.
- `source`: the book title from `books.md`.
- `evidence`: an array of `path:line - what it shows` strings.
- `fix`: a concise, actionable next step.

Do not invent. Only cite lines you actually read. If a search found nothing, use
an empty `evidence` array and explain the search in `finding`.

## Architecture

What good looks like:
- Clear module boundaries.
- Dependencies point toward stable abstractions.
- Use cases are explicit and isolated from I/O.
- Service boundaries match ownership and deployment seams.

Evidence signals:
- Adapters or repositories behind interfaces.
- Explicit ports/adapters.
- Cross-module dependency direction that respects stable abstractions.
- Service ownership and data ownership separated by bounded context.
- No concrete vendor/DB/HTTP clients smeared through domain logic.

## Correctness

What good looks like:
- Explicit contracts and invariants.
- Predictable error handling.
- Resource acquisition and release paired.
- Concurrency and temporal ordering are deliberate.
- Impossible states are guarded early.

Evidence signals:
- Pre/postcondition checks at boundaries.
- Assertions or guards on impossible states.
- `try/finally`, RAII, or equivalent for resources.
- Non-empty error handling or explicit propagation.
- Shared mutable state protected or avoided.
- Temporal order documented or enforced.

## Craft

What good looks like:
- Names reveal intent.
- Functions do one thing.
- Duplication is centralized.
- Comments explain why, not what.
- Changes preserve behavior and are easy to follow.

Evidence signals:
- Vague or repeated names.
- Long functions with mixed concerns.
- Repeated logic or copy-paste.
- Dead code, speculative generality, or accidental complexity.
- Inconsistent formatting or naming style.
- Unclear ownership or responsibility drift.

## Security

What good looks like:
- Minimal attack surface.
- Least privilege.
- Explicit authentication/authorization boundaries.
- Input validation at trust boundaries.
- Secrets and sensitive data protected.
- Privacy and data retention considered.

Evidence signals:
- Unvalidated external input.
- Hardcoded credentials, tokens, or keys.
- Broad permissions, wildcard roles, or privileged defaults.
- Sensitive data logged or serialized.
- Missing parameterized queries, output escaping, or CSRF/auth guards.

## Data

What good looks like:
- Data ownership is explicit.
- Transactions and consistency are deliberate.
- Schema and API changes are backward compatible.
- Idempotency and retries are considered.
- Observability and failure modes are visible.

Evidence signals:
- Shared mutable data without ownership.
- Missing migrations or schema versioning.
- Non-idempotent side effects.
- Unbounded fan-out or unmanaged eventual consistency.
- Missing metrics/logs/traces for failure paths.

## Process

What good looks like:
- Work is traceable to a user need or use case.
- Tests cover behavior, not implementation.
- Delivery is small and reviewable.
- Feedback loops and team practices are visible.
- Changes are safe to revert or roll back.

Evidence signals:
- Missing or ambiguous acceptance criteria.
- No tests or tests coupled to implementation details.
- Large mixed-purpose changes.
- Missing review/automation hooks.
- No rollback or release strategy.
