---
description: Audit and refactor a codebase for structure, naming, modularity, and best practices
argument-hint: "<path to repo or specific area to focus on>"
---

# /refactor

> Audit, plan, and execute a principled codebase refactoring. See the **codebase-organization** skill for the full methodology, naming rules, and quality checklist.

## Usage

```
/refactor $ARGUMENTS
```

Refactor the codebase at: @$1

If no argument is provided, analyze the current working directory.

If a specific path or area is given (e.g., `frontend/src/auth`), scope the refactoring to that area while respecting project-wide conventions.

## Workflow

### Phase 1: Audit (read-only - no changes yet)

Before touching any code, produce a complete findings report:

1. **Map the current structure** - full directory tree, layer boundaries, entry points
2. **Scan for naming violations** - grep for banned patterns (see codebase-organization skill Section 2):
   - `Enhanced`, `Improved`, `New`, `Old`, `Better`, `Fast`, `Smart`, `Final`
   - `V2`, `_backup`, `_copy`, `_orig`, `_fixed`, `_patched`, `_updated`
   - `temp_`, `test_` (in non-test files), `my_`, `foo`, `bar`, `xxx`
   - Generic names: `data`, `info`, `item`, `thing`, `stuff`, `obj`, `val`, `result` as standalone
   - `utils2`, `helpers_new`, `styles_final` versioned filenames
3. **Identify duplication** - functions, types, constants, and logic that appear in multiple places
4. **Flag dead code** - unused imports, commented-out blocks, unreachable branches, deprecated functions
5. **Check async patterns** - silent catch blocks, fire-and-forget promises, missing timeouts
6. **Measure file/function size** - flag files >300 lines, functions >50 lines
7. **Assess test coverage** - existing tests, gaps, characterization test needs
8. **Check type strictness** - `any` usage, untyped parameters, implicit nulls

Present the audit as a structured report with severity levels before proceeding.

### Phase 2: Plan

Based on audit findings, produce a sequenced refactoring plan:

1. Establish domain glossary (`docs/glossary.md`)
2. Restructure directories (move files, update imports, verify builds)
3. Rename for consistency (eliminate banned patterns, align with glossary)
4. Extract shared code (consolidate duplication into single sources of truth)
5. Refactor internals (modularity, conciseness, async patterns)
6. Add missing documentation (docstrings, section comments, ADRs)
7. Final validation (full test suite, lint, type check, smoke test)

Each step includes a verification checkpoint - tests pass, app builds, no regressions.

**Present the plan for approval before executing any changes.**

### Phase 3: Execute

Work through the plan step by step:

- Commit after each logical unit of work
- Run tests after every batch of changes
- If a step introduces a regression, stop and fix before continuing
- Document every significant structural decision as an ADR in `docs/decisions/`

### Phase 4: Validate

Run the full deliverables checklist from the codebase-organization skill:

- Directory structure is clean and predictable
- Zero banned naming patterns remain
- Zero duplicated logic
- All async operations have proper error handling
- All public APIs are documented
- Full test suite passes
- App builds and runs in dev and production modes

## Output Modes

### Full refactor (default)
Complete audit -> plan -> execute -> validate cycle.

### Audit only
```
/refactor audit
```
Produces the findings report without making changes. Useful for understanding the current state.

### Plan only
```
/refactor plan
```
Audit + plan, no execution. Useful for review before committing to changes.

## If Connectors Available

If **GitHub** is connected:
- Create a branch for the refactoring work
- Open a PR with the audit findings as the description
- Link ADRs to the PR for review context

If **~~project tracker** is connected:
- Create subtasks for each refactoring phase
- Link the refactoring work to the parent epic/story

## Tips

1. **Start with `audit`** - understand the full scope before committing to changes.
2. **Scope it down** - `/refactor backend/src/auth` is more manageable than refactoring everything at once.
3. **Pair with `/readme update`** - after refactoring, update the README to reflect the new structure.
4. **Run from the repo root** - I need to see the full picture even when scoping to a specific area.
