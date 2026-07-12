---
name: codebase-organization
description: Refactor and reorganize codebases using SOLID principles, clean architecture, strict naming conventions, and defensive programming. Trigger with "refactor this codebase", "reorganize the code", "clean up the project structure", "fix the naming", "audit the codebase", "code organization", or when someone needs help restructuring, renaming, deduplicating, or improving code quality across a project.
when_to_use: Refactoring or reorganizing a codebase with SOLID and clean architecture; auditing naming conventions and cleaning up project structure; consolidating duplicated logic and establishing shared modules; improving async error handling and modularity
allowed-tools: Read, Glob, Grep, Bash
---

# Codebase Refactoring & Organization

A complete methodology for auditing, refactoring, and reorganizing codebases. Every decision must be filtered through the principles below - they are constraints, not suggestions. When two principles conflict, the order listed here represents priority.

## 1. Guiding Principles

### SOLID Principles

- **Single Responsibility (SRP)**: Every module, class, function, and component must have exactly one reason to change. If you can describe what something does using the word "and," it does too much - split it.
- **Open/Closed (OCP)**: Code should be open for extension but closed for modification. New features should be addable by writing new code (new modules, handlers, components), not by editing existing stable code. Use plugin patterns, strategy patterns, and configuration-driven behavior.
- **Liskov Substitution (LSP)**: Any subclass or implementation must be usable wherever its parent or interface is expected without breaking behavior.
- **Interface Segregation (ISP)**: No module should depend on methods or properties it doesn't use. Prefer many small, focused interfaces over one large general-purpose one.
- **Dependency Inversion (DIP)**: High-level business logic must never depend on low-level implementation details. Both should depend on abstractions.

### Core Philosophies

- **KISS**: The simplest solution that correctly solves the problem is the best solution. If a junior developer can't understand a module within 5 minutes, it's too complex.
- **YAGNI**: Do not build abstractions or extension points for hypothetical future requirements. Solve today's problem today.
- **DRY**: Every piece of knowledge must have a single, unambiguous, authoritative representation. But apply with judgment - two pieces of code that look similar but serve different domains and change for different reasons are NOT duplication.
- **Separation of Concerns**: Each layer, module, and function should address one concern. If removing one concern would require rewriting a module, the concerns are too entangled.
- **Composition Over Inheritance**: Build complex behavior by combining simple, independent pieces rather than extending deep class hierarchies.
- **Principle of Least Surprise**: Code should behave the way a reasonable developer would expect from reading its name and signature.
- **Fail Fast, Fail Loud**: Detect errors at the earliest possible point and surface them immediately. Never let invalid state propagate silently.
- **Convention Over Configuration**: Establish clear patterns and follow them everywhere.
- **Boy Scout Rule**: Leave every file you touch cleaner than you found it.

### Defensive Programming

- **Validate at boundaries**: All external input must be validated and sanitized before entering business logic.
- **Use type systems aggressively**: Leverage strict mode, type hints with runtime validators (Pydantic, Zod, etc.). Avoid `any`, `object`, untyped function signatures.
- **Make illegal states unrepresentable**: Design data structures so invalid combinations cannot exist. Use discriminated unions, enums, and required fields.
- **Prefer immutability**: Use `const`, `readonly`, frozen data structures by default. Mutate only with clear justification, contained to the smallest scope.

## 2. Naming & Nomenclature Standards

### The Cardinal Rule

Names must describe what something **IS**, not how it compares to something that came before. Names are read thousands of times by developers with no knowledge of history. The name must stand entirely on its own.

### Banned Naming Patterns

These are strictly prohibited in file names, folder names, function names, class names, variable names, component names, and any other identifier. If any exist, they must be renamed.

| Banned Pattern | Why It's Harmful | Correct Alternative |
|----------------|-----------------|---------------------|
| `EnhancedWidget` / `ImprovedWidget` | Implies a non-enhanced version exists. Enhanced compared to what? | Name for what it does: `WidgetWithValidation` |
| `NewUserService` / `OldUserService` | "New" is only new today. Which one is active? | `UserService`. For migrations: `UserServiceV1` + `UserServiceV2` with deprecation timeline |
| `BetterParser` / `FastParser` / `SmartParser` | Subjective, relative, unverifiable | Name the mechanism: `StreamingParser`, `BatchParser`, `RecursiveDescentParser` |
| `utils2.js` / `helpers_new.py` / `styles_final.css` | Versioned filenames signal fear of replacing the original | One file, one name. `utils.js`. Delete or merge the old one |
| `handleClickNew()` / `processDataV2()` | Creates ghost references developers hunt for | `handleClick()`. Or name the behavioral difference: `processDataInBatches()` |
| `temp_`, `test_` (non-test), `my_`, `foo`, `bar`, `xxx` | Non-descriptive placeholders in production | Name for what it does: `extractInvoiceLineItems()` |
| `data`, `info`, `item`, `thing`, `stuff`, `obj`, `val`, `result` (standalone) | Semantically empty - every variable holds data | Name the domain concept: `invoice`, `userProfile`, `authToken` |
| `doProcess()` / `handleStuff()` / `manageThings()` | Vague verbs + vague nouns | `calculatePortfolioReturn()`, `syncMeetingTranscript()` |
| `IUserInterface` / `AbstractBaseUser` | Hungarian notation encodes type system info into names | `User` for the interface. Let the language's type system communicate the construct type |
| `_backup`, `_copy`, `_orig`, `_fixed`, `_patched`, `_updated`, `_refactored` | Suffixes narrate the changelog inside the name | Strip the suffix. Git provides the history |

### Positive Naming Principles

- **Describe behavior, not history**: `UserService` not `RefactoredUserService`
- **Public APIs: describe what, not how**: `getActiveUsers()` not `queryDatabaseForNonDeletedUsers()`
- **Private helpers: describe how, not what**: `filterByExpirationDate()` not `getRelevantItems()`
- **Use domain language**: If the business calls it a "portfolio rebalance," code says `rebalancePortfolio()`
- **Be specific about scope**: `emailAddress` not `email`. `retryDelayMs` not `delay`. `maxLoginAttempts` not `max`
- **Booleans read as true/false questions**: `isAuthenticated`, `hasPermission`, `shouldRetry`, `canEdit`
- **Collections are plural, items are singular**: `users` is an array, `user` is one element, `usersByEmail` is a map
- **Event handlers**: `on[Event]` or `handle[Event]` - `onSubmit`, `handleFileUpload`
- **Constants**: `UPPER_SNAKE_CASE` describing meaning - `MAX_RETRY_ATTEMPTS = 3`, `DEFAULT_TIMEOUT_MS = 5000`
- **Acronyms follow casing rules**: `HttpClient`, `parseJson`, `userId`, `apiUrl` - not `HTTPClient`, `parseJSON`

### Cross-Stack Consistency

The same concept must use the same noun everywhere: backend, frontend, database, API, types, docs. Maintain a domain glossary at `docs/glossary.md` mapping business terms to canonical code names.

## 3. Directory Structure

Reorganize into a clear, predictable layout:

```
project-root/
+-- frontend/          # All client-side code
+-- backend/           # All server-side code
+-- shared/            # Types, constants, utilities shared across sides
+-- scripts/           # Build, deploy, migration, maintenance scripts
+-- docs/              # Architecture decisions, API docs, glossary, guides
|   +-- decisions/     # Architecture Decision Records (ADRs)
|   +-- glossary.md    # Domain term -> code name mapping
+-- .github/           # CI/CD workflows, PR templates, issue templates
+-- docker/            # Dockerfiles, compose files (if applicable)
+-- README.md
```

Rules:

- Every folder must have an index/barrel file explicitly exporting its public API
- No files at project root except configs and documentation
- If a file doesn't clearly belong to `frontend/` or `backend/`, it belongs in `shared/` or `scripts/`
- Group by feature/domain, not by technical role: prefer `features/auth/` containing its components, hooks, services, and tests over separate top-level `components/`, `hooks/`, `services/` folders

### Mirrored Naming Conventions

| Concept | Frontend Path | Backend Path |
|---------|--------------|--------------|
| User auth | `frontend/src/features/auth/` | `backend/src/features/auth/` |
| API client / route | `frontend/src/api/users.ts` | `backend/src/routes/users.py` |
| Type definitions | `frontend/src/types/user.ts` | `backend/src/schemas/user.py` |
| Validation logic | `frontend/src/validation/user.ts` | `backend/src/validation/user.py` |
| Shared constants | `shared/constants/roles.ts` | `shared/constants/roles.py` |

File naming: `lowercase-kebab-case` for non-Python, `lowercase_snake_case` for Python, `PascalCase` for components.

## 4. Eliminating Duplication

For every instance of duplicated or near-duplicated logic:

1. **Identify** - flag every function, component, class, type, or constant appearing in multiple places
2. **Consolidate** - extract to a single, well-named module in the appropriate location:
   - Same-side duplication -> `utils/`, `hooks/`, or `services/` within that side
   - Cross-side duplication -> `shared/`
3. **Re-export** - update all consumers to import from the single source
4. **Validate** - confirm no orphaned copies remain

Shared types between frontend and backend must live in `shared/types/`. Pure utility functions belong in `shared/utils/`.

## 5. Modularity & Scalability

### Frontend

- One component does one thing (SRP)
- Separate presentational components (rendering) from containers (data fetching, state)
- Extract business logic into custom hooks or service modules - components are thin wrappers
- Configuration and feature flags are externalized, never hardcoded

### Backend

- Layered architecture: **Routes/Controllers** -> **Services** -> **Repositories/Data Access**
  - Routes: HTTP concerns only (parsing, formatting, status codes)
  - Services: all business logic and orchestration - no direct DB calls, no HTTP objects
  - Repositories: all data access and external API calls
- Define clear interfaces between layers. Services depend on abstractions, not concrete implementations
- Use dependency injection or factory patterns so any layer can be swapped or mocked

### Both Sides

- No function exceeds ~50 lines. Decompose if it does
- No file exceeds ~300 lines. Split into focused sub-modules if it does
- Every public function, class, and module has a docstring or JSDoc comment

## 6. Async Operations & Error Handling

Every async operation must be resilient and observable. Silent failures are unacceptable.

### Mandatory Patterns

```
async function performOperation():
    try:
        result = await riskyOperation()
        return { success: true, data: result }
    catch (error):
        // 1. LOG with full context (operation, inputs, stack trace)
        logger.error("performOperation failed", { error, context })

        // 2. CLASSIFY (transient vs permanent)
        if isTransient(error):
            // 3. RETRY with exponential backoff
            return await retryWithBackoff(riskyOperation, maxRetries=3)

        // 4. FALLBACK to degraded behavior
        fallbackResult = getCachedOrDefault()
        if fallbackResult:
            return { success: true, data: fallbackResult, degraded: true }

        // 5. PROPAGATE with meaningful error (never swallow)
        throw new ApplicationError("Operation failed", { cause: error })
```

### Rules

- Never use bare `try/catch` that swallows errors. Every catch must: log + rethrow, log + return fallback, or log + return typed error
- Never `catch (e) {}` - this is a silent failure
- All Promises must be handled. No fire-and-forget async calls
- Timeouts are mandatory on all external calls
- Circuit breakers for dependencies that can go down
- Structured logging: timestamp, operation name, correlation ID, error type, message, stack trace
- Prefer `Result<T, E>` or `{success, data, error}` objects for expected failure modes. Reserve exceptions for truly unexpected failures

## 7. Documentation Standards

- **Section headers**: clear comment blocks delineating logical sections within files
- **Why, not what**: comments explain intent and reasoning, not mechanics
- **TODO/FIXME/HACK tags**: consistent format with author and date - `// TODO(jerry, 2025-02-24): Replace with batch API`
- **API documentation**: every endpoint has request/response schemas documented
- **ADRs**: every significant structural choice documented in `docs/decisions/` with context, alternatives, and rationale

## 8. Refactoring Process (Execution Order)

1. **Audit** - map current structure, identify all violations, present findings before changes
2. **Test baseline** - ensure tests pass; write characterization tests if coverage is insufficient
3. **Establish glossary** - create `docs/glossary.md`, align canonical names before renaming
4. **Restructure directories** - move files, update imports, verify builds after each batch
5. **Rename for consistency** - eliminate banned patterns, align with glossary, verify
6. **Extract shared code** - consolidate duplication, verify
7. **Refactor internals** - modularity, conciseness, async patterns, file by file, commit after each unit
8. **Add missing documentation** - docstrings, section comments, ADRs
9. **Final validation** - full test suite, linting, type checking, smoke test

At every step: run tests, verify builds, confirm no regressions before proceeding.

## 9. Deliverables Checklist

Before considering the refactoring complete:

- [ ] All code lives under `frontend/`, `backend/`, or `shared/`
- [ ] `docs/glossary.md` exists mapping every domain concept to its canonical code name
- [ ] File and folder names follow mirrored conventions across frontend and backend
- [ ] Same domain concept uses the same noun in frontend, backend, API, database, and docs
- [ ] Zero banned naming patterns remain anywhere
- [ ] Zero duplicated logic - every shared concern has a single source of truth
- [ ] No file exceeds ~300 lines; no function exceeds ~50 lines
- [ ] All async operations have error handling, logging, timeouts, and fallbacks
- [ ] No silent catch blocks exist
- [ ] Every public API has documentation
- [ ] Section comments delineate logical groupings within files
- [ ] All dead code, unused imports, and commented-out blocks are removed
- [ ] Full test suite passes with no regressions
- [ ] App builds and runs in dev and production modes
- [ ] ADRs document every significant structural decision
- [ ] SOLID principles followed - no god classes, no leaky abstractions, no hidden dependencies
- [ ] Types are strict - no `any`, no untyped parameters, no implicit null
