# Refactor Checklist

The contract every atlas-refactor run obeys. Behavior is frozen. The
refactor is safe only when every item on this list closes with
evidence.

## 1. Behavior is frozen before any edit

Before changing a unit, capture its current behavior in a form you can
diff against after the change. One of:

- A passing test that exercises the unit. If none exists, write one
  before refactoring. Red-green-refactor means the test is green
  before you refactor, not after.
- A recorded sample run: the exact input and the exact output, saved
  to a file. After the refactor, re-run with the same input and diff
  the output.
- A captured API contract: request shape, response shape, status
  codes, error cases. After the refactor, re-exercise each case.

If you cannot capture behavior, do not refactor that unit. Refusing
to refactor blind is correct, not timid.

## 2. Test coverage before AND after

- Before: the unit under refactor has at least one test that would
  fail if behavior changed. If it does not, write that test first.
- After: the same test passes, with no modification to the test
  itself. Modifying the test to fit the refactor is the failure mode
  this checklist exists to prevent.
- Coverage delta: if the refactor changes a branch, add a test for
  the new branch. Net coverage must not drop.

## 3. Behavior-preserving rules

- Public API contracts (function signatures, exported names, request
  shapes, error codes) do not change. If a contract must change, that
  is a breaking change, not a refactor. Stop and flag it.
- Side effects (logs, metrics, DB writes, external calls) stay in the
  same order with the same content. A refactor that reorders side
  effects is not behavior-preserving.
- Error messages stay semantically equivalent. A user or operator
  who depended on the old message can still recognize the new one.
- Threading and concurrency semantics stay equivalent. A refactor
  that moves work from synchronous to async, or serial to parallel,
  is a behavior change. Flag it.

## 4. Naming rules

Apply the project naming conventions. Key rules:

- Names describe what something IS, not how it compares to a prior
  version. No Enhanced, Improved, New, Old, Better, v2, _backup,
  _fixed, _patched, _orig, _copy.
- Names describe behavior, not history. UserService, not
  RefactoredUserService.
- Public names describe what (result); internal helpers describe how
  (mechanism). getActiveUsers() public; filterByExpirationDate()
  internal.
- Booleans read as questions: isAuthenticated, hasPermission,
  shouldRetry.
- Collections are plural, items are singular: users is an array,
  user is one element.
- Acronyms follow casing rules: HttpClient, parseJson, userId.
- Cross-stack consistency: the same concept uses the same noun in
  API, DB, types, and UI. Maintain docs/glossary.md.

If a rename crosses a public API boundary, flag it as a breaking
change and stop.

## 5. Incremental, verified steps

- One refactor step per commit. Run the test suite after every step.
- Do not batch independent refactors into one diff. Each step is
  independently revertable.
- If a step breaks a test, revert the step. Do not modify the test
  to make the step pass.
- Delete dead code entirely. Commented-out code is a defect.

## 6. Precision edits

- Use symbol-level navigation and targeted edits (Serena, LSP).
- Do not rewrite whole files to change one function.
- Do not reformat code that is not part of the refactor. Style fixes
  belong in a separate commit.

## 7. What this checklist is not

- Not a license to add features. A refactor that adds behavior is
  two changes. Split them.
- Not a license to upgrade dependencies. A refactor that bumps a
  library is a migration. Split it.
- Not a license to change architecture. A refactor that moves a
  unit across layer boundaries is a restructure. Both are valid,
  but they are not the same change and do not belong in one diff.

## Report shape

1. Before/after structure with file:line evidence.
2. The behavior capture method used (test, sample run, API contract).
3. The commands run and their before/after outputs proving behavior
  held.
4. The adjacent error path exercised and its result.
5. Any rename applied, with the old and new names.

A report that says "behavior is preserved" without the captured
before/after output is a claim, not evidence. The verifier will
refuse it.