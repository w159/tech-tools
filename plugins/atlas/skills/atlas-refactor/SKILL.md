---
name: atlas-refactor
description: "Refactors, renames or restructures code without changing behavior, or (diff mode, no target) runs a three-reviewer simplify pass over a fresh diff, with before/after evidence. Use when code works but is messy, or right after implementing and before review."
when_to_use: "refactor, restructure a package, rename, extract helpers, remove dead code, simplify my changes, simplification pass, tidy the diff"
allowed-tools: Read, Glob, Grep, Bash, Edit, Write, Agent, Task, AskUserQuestion
argument-hint: '<target symbol or file> | blank or base:<ref> = simplify the fresh diff'
---



Apply the Operating Contract to this entire task. It is injected below.

```!
cat "${CLAUDE_PLUGIN_ROOT}/references/operating-contract.md"
```

If the contract did not load above, read `${CLAUDE_PLUGIN_ROOT}/references/operating-contract.md` and apply it before proceeding.

## Modes

| Mode | When | Procedure |
|---|---|---|
| target (default) | A named symbol, file, module or pain point to restructure, rename or clean up | The Sequence below |
| diff | Simplify, tidy or de-duplicate code that was just implemented: blank arguments, `base:<ref>`, or files edited this session | Read `${CLAUDE_SKILL_DIR}/references/diff-pass.md` in full and follow it instead of the Sequence (three read-only reviewers, triage, implementer, verifier re-gate). It loads `references/personas/code-reuse-reviewer.md`, `references/personas/code-quality-reviewer.md`, `references/personas/efficiency-reviewer.md` and `references/diff-pass-apply-and-verify.md` at its own steps. Everything else on this page still applies. |

Read `${CLAUDE_SKILL_DIR}/references/refactor-checklist.md` and apply the behavior-preservation, test-coverage, and naming rules it defines to every step.

Act as a software architect and refactoring specialist. Refactor this: $ARGUMENTS

Vocabulary for structure problems: `${CLAUDE_SKILL_DIR}/references/deep-modules.md`. Before any rename, run the glossary step in `${CLAUDE_SKILL_DIR}/references/domain-glossary.md`.

Read the arguments as: the project, a short description of it, and the pain points to address. If any required input is missing or ambiguous, ask once for it, then proceed.

Rules:
- Behavior is frozen. Before refactoring any unit, capture its current behavior (a test, a sample run, or recorded input/output). After refactoring, prove the behavior is unchanged.
- Incremental progress. Work in small independently verifiable steps. Run tests after every single step. Do not batch changes.
- Clean execution. Fix in place. Delete dead code entirely; do not comment it out. No parallel version files (no file_v2).
- Precision edits. Use symbol-level navigation and targeted edits rather than full-file rewrites (Serena or LSP where available).

Sequence:
1. Analysis. Map the current structure and list specific problems with evidence (file and line numbers).
2. Planning. Propose the target structure and ordered steps. Pause for approval only if a step changes a public API contract or touches files outside the named project.
3. Execution. Step by step, verifying behavior after each change. If this is a recurring or iterative refactor (a sweep across many files, a migration, or an until-dry cleanup pass), invoke the `atlas-loop` skill to select and instantiate the best-fit loop from the loop-library, then run that loop. Otherwise, for non-trivial single-pass work, dispatch the squad rather than doing it all inline: dispatch all independent jobs in ONE message (multiple Agent calls in a single message) so they run concurrently, roughly 4-6 in flight - atlas:explorer for structure discovery, debugger if a step breaks behavior, atlas:implementer for the edits. ALWAYS close the wave with an independent atlas:verifier in a fresh context that behavior held before integrating results.

VERIFY:
- Run the test suite or the captured sample runs after each step. Show the exact command and the actual output.
- Prove observable behavior is unchanged by comparing before/after output, not "it should still work."
- Exercise one adjacent error path to confirm error handling was preserved.

REPORT:
- Before/after structure.
- What was moved, renamed, or deleted.
- The commands you ran and their actual outputs proving behavior is unchanged.
