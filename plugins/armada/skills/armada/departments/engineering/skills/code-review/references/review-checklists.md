# Code Review Checklists

The per-dimension checklists the code-review skill walks through. Read
the section for the dimension you are reviewing; do not try to apply
every item to every diff. Match the checklist to what changed.

## Security

- SQL injection, XSS, CSRF
- Authentication and authorization flaws
- Secrets or credentials in code
- Insecure deserialization
- Path traversal
- SSRF

## Performance

- N+1 queries
- Unnecessary memory allocations
- Algorithmic complexity (O(n^2) in hot paths)
- Missing database indexes
- Unbounded queries or loops
- Resource leaks

## Correctness

- Edge cases (empty input, null, overflow)
- Race conditions and concurrency issues
- Error handling and propagation
- Off-by-one errors
- Type safety

## Maintainability

- Naming clarity
- Single responsibility
- Duplication
- Test coverage
- Documentation for non-obvious logic

## Applying the Checklists

1. Read the diff once to learn what changed and why.
2. Pick the dimensions that match the change surface: a SQL change
   leans on Security and Performance; a refactor leans on
   Maintainability and Correctness.
3. Walk that dimension's checklist against the changed lines and their
   callers. Note file and line for every finding.
4. Record a positive observation alongside the issues so the author
   sees what to keep, not only what to change.
5. Rate each reviewed dimension and lead the report with critical
   issues, then minor, then positives.