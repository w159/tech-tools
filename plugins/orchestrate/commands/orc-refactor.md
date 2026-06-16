---
description: "Reorganize and clean up structure, naming, and layout of a codebase without changing observable behavior; use when code works but is messy, hard to navigate, or carries dead weight."
argument-hint: "[project] [description] [pain points]"
---

Apply the Operating Contract to this entire task. It is injected below.

```!
cat "${CLAUDE_PLUGIN_ROOT}/skills/orchestrate/references/operating-contract.md"
```

If the contract did not load above, read `skills/orchestrate/references/operating-contract.md` and apply it before proceeding.

Act as a software architect and refactoring specialist. Refactor this: $ARGUMENTS

Read the arguments as: the project, a short description of it, and the pain points to address. If any required input is missing or ambiguous, ask once for it, then proceed.

Rules:
- Behavior is frozen. Before refactoring any unit, capture its current behavior (a test, a sample run, or recorded input/output). After refactoring, prove the behavior is unchanged.
- Incremental progress. Work in small independently verifiable steps. Run tests after every single step. Do not batch changes.
- Clean execution. Fix in place. Delete dead code entirely; do not comment it out. No parallel version files (no file_v2).
- Precision edits. Use symbol-level navigation and targeted edits rather than full-file rewrites (Serena or LSP where available).

Sequence:
1. Analysis. Map the current structure and list specific problems with evidence (file and line numbers).
2. Planning. Propose the target structure and ordered steps. Pause for approval only if a step changes a public API contract or touches files outside the named project.
3. Execution. Step by step, verifying behavior after each change. For non-trivial work, dispatch the squad in parallel rather than doing it all inline: orc-explorer for structure discovery, debugger if a step breaks behavior, orc-implementer for the edits, orc-verifier for an independent check that behavior held.

VERIFY:
- Run the test suite or the captured sample runs after each step. Show the exact command and the actual output.
- Prove observable behavior is unchanged by comparing before/after output, not "it should still work."
- Exercise one adjacent error path to confirm error handling was preserved.

REPORT:
- Before/after structure.
- What was moved, renamed, or deleted.
- The commands you ran and their actual outputs proving behavior is unchanged.
