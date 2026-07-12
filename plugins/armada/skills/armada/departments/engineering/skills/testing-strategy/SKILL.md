---
name: testing-strategy
description: Design test strategies and test plans balancing coverage, speed, and maintenance. Use when the user says "how should we test", "test strategy for", "write tests for", "test plan", or "what tests do we need", or needs help with testing approaches, coverage, or test architecture.
when_to_use: "When designing a test strategy, choosing test types per component, setting coverage targets, or identifying gaps in existing coverage"
allowed-tools: Read, Glob, Grep, Bash
---

# Testing Strategy

Design effective testing strategies balancing coverage, speed, and maintenance.

## Testing Pyramid

```
        /  E2E  \         Few, slow, high confidence
       / Integration \     Some, medium speed
      /    Unit Tests  \   Many, fast, focused
```

## Strategy by Component Type

- **API endpoints**: Unit tests for business logic, integration tests for HTTP layer, contract tests for consumers
- **Data pipelines**: Input validation, transformation correctness, idempotency tests
- **Frontend**: Component tests, interaction tests, visual regression, accessibility
- **Infrastructure**: Smoke tests, chaos engineering, load tests

## What to Cover

Focus on: business-critical paths, error handling, edge cases, security boundaries, data integrity.

Skip: trivial getters/setters, framework code, one-off scripts.

## Output

Produce a test plan with: what to test, test type for each area, coverage targets, and example test cases. Identify gaps in existing coverage.
