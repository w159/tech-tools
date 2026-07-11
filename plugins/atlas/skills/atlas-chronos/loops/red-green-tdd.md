---
id: red-green-tdd
name: Red-green TDD
category: build
cadence: self-paced
inputs:
  - requirement: the behavior to build, as a list of testable assertions
  - test_command: how to run the relevant tests (read from the project manifest, never invented)
  - source_target: the file/module the implementation lives in
  - done_definition: all requirement assertions covered and green
---

# red-green-tdd

Build a feature or fix one requirement at a time, test-first. Each iteration: write a test that fails for the right reason (red), make it pass with the smallest change (green), refactor without breaking it, then take the next assertion. Self-paced because the model advances only when the current assertion is green.

## Steps

1. **Decompose.** Turn `requirement` into an ordered list of small testable assertions.
2. **Red.** Write a test for the next assertion. Run `test_command`. Confirm it fails, and that it fails for the intended reason (not a typo or a missing import).
3. **Green.** Make the smallest change in `source_target` to pass. Run `test_command`. Confirm the new test passes and no prior test regressed. Per atlas-metis law 5, the green verdict that lets you advance is not self-attested: dispatch `atlas:verifier` (or otherwise re-run `test_command` in a fresh context) to independently confirm the assertion is green before moving on.
4. **Refactor.** Clean up names and structure with the suite green. Re-run to confirm still green.
5. **Advance (self-pace).** If assertions remain, go to step 2 with the next one. If all are covered and green, stop.

## Stop condition

Every assertion in `requirement` has a passing test and the full suite is green (`done_definition`).

## Template (self-paced /loop)

```
/loop Take the next uncovered assertion of <requirement>. Write a failing test, run <test_command>, confirm it fails for the right reason; then make the minimal change in <source_target> to pass it and confirm no prior test regressed; then refactor with the suite green. If assertions remain, continue; when all are covered and green, stop and print the final test summary.
```

Omit the interval to self-pace. In an atlas session route the edits to `atlas:implementer` and the final confirmation to `atlas:verifier` rather than editing inline.
