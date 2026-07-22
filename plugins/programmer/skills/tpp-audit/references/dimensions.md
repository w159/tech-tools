# Audit Dimensions Rubric

The auditor's operational rubric. One row per concept the auditor must examine, grouped into 10 dimensions (one per book chapter, plus the postface). For each dimension: the concept files to consult, what good looks like, and grep-able evidence signals that separate `implemented` / `partial` / `missing` / `n/a`.

Status definitions:
- `implemented` - concrete evidence the practice is in force, cited at file:line.
- `partial` - the practice appears but is inconsistent, shallow, or violated in places. Cite both the positive and the violation.
- `missing` - no evidence found, and the concept applies to this codebase.
- `n/a` - the concept genuinely cannot apply (e.g. concurrency in a single-threaded CLI with no shared state). Use sparingly and justify in the note.

Concept files live at `../tpp-principles/references/concepts/<file>.md`. The auditor reads only the files for the assigned dimension.

---

## Dimension 1: A Pragmatic Philosophy (Chapter 1)

Concepts: `its-your-life.md`, `provide-options-dont-make-excuses.md`, `take-responsibility.md`, `broken-windows.md`, `software-entropy.md`, `boiled-frog.md`, `stone-soup.md`, `good-enough-software.md`, `knowledge-portfolio.md`, `communicate.md`

What good looks like: the codebase shows signs of active maintenance and pride. No festering rot. Decisions are documented with rationale, not just outcome.

Evidence signals:
- Broken windows / software entropy: grep for `TODO`, `FIXME`, `XXX`, `HACK`, `@deprecated`, `// temporary`, `// TODO`, `console.log` left in production paths. Count per-module. High density + old age = rot. `missing` rot = clean tree or tracked issues. `partial` = a few scattered, `implemented` = none or all traced to issues.
- Good-enough software: presence of explicit non-goals or scope boundaries in README/docs; tests that assert current contract rather than gold-plated specs.
- Communicate: README, ADRs (`docs/decisions`, `adr/`), project glossary, PR templates. `missing` = no README or contributing guide.
- Take responsibility / provide options: git blame showing ownership; commit messages that name a path forward, not just "fix". Check for `Co-authored-by`, signed commits, or author attribution.
- Knowledge portfolio: evidence of dependency hygiene - `renovate.json`, `dependabot.yml`, regular update cadence in git log.
- Boiled frog: changelog or roadmap tracking drift; presence of `CHANGELOG.md`.
- Stone soup: hard to detect post hoc; mark `n/a` unless docs describe an incremental bootstrap.

---

## Dimension 2: A Pragmatic Approach (Chapter 2)

Concepts: `etc-easier-to-change.md`, `dry-dont-repeat-yourself.md`, `orthogonality.md`, `reversibility.md`, `tracer-bullets.md`, `prototypes.md`, `domain-languages.md`, `estimating.md`

What good looks like: design optimized for change. One piece of knowledge in one place. Modules independent. No irreversible lock-in.

Evidence signals:
- DRY: duplicate 6+ line blocks across modules (use a duplicate-code detector or grep for repeated signatures). Schema mirrored by hand in both a migration and a struct/ORM model. API contract duplicated in client and server with no generator (no OpenAPI/protobuf/codegen). `implemented` = single source + codegen or accessor functions.
- Orthogonality: imports crossing layer boundaries (UI importing DB, DB importing UI). A change-diff that touches many unrelated modules for one requirement. `implemented` = layered imports, one responsibility per module. Check for globals/singletons used as shared mutable state.
- ETC / reversibility: vendor-specific calls smeared across the codebase vs. confined behind an interface. Hardcoded cloud/queue/DB vendor names outside config. `implemented` = adapters/ports, config-driven selection.
- Tracer bullets: an end-to-end thin path exists (entry point -> service -> storage -> response) with real wiring, not stubs-only.
- Prototypes: `n/a` post hoc unless a `spike/` or `prototype/` dir exists.
- Domain languages: ubiquitous language matching code names; a DSL or domain-specific module. `missing` = business terms absent from code identifiers.
- Estimating: estimates recorded with units and revisited. `n/a` for libraries without schedules.

---

## Dimension 3: The Basic Tools (Chapter 3)

Concepts: `plain-text.md`, `shell-games.md`, `power-editing.md`, `version-control.md`, `select-isnt-broken.md`, `binary-chop.md`, `debugging.md`, `dont-assume-prove-it.md`, `failing-test-before-fixing-code.md`, `fix-the-problem-not-the-blame.md`, `rubber-ducking.md`, `text-manipulation.md`, `engineering-daybook.md`

What good looks like: everything under version control. Knowledge in plain text. Bugs trapped by failing tests before fixing. Command shell used for automation.

Evidence signals:
- Version control: `.git/` present; not just source but configs, infra, docs tracked. `missing` = no VCS or large untracked dirs (e.g. `node_modules` committed, or `*.env` tracked).
- Plain text: configs as `.yaml`/`.toml`/`.json`/`.ini` rather than binary blobs; data stored human-readable unless genuinely binary. Flag opaque serialized blobs used as config.
- Failing test before fixing code / test-to-code: test files referencing bug-fix commits; tests that reproduce a fault. Check git log for "fix" commits and whether a test was added in the same commit. `missing` = fix commits with no test.
- Debugging / don't assume, prove it: presence of repro scripts, `tests/` reproducing edge cases. Commented-out debug prints left behind = `partial`.
- Shell games / text manipulation / full automation: presence of `Makefile`, `scripts/`, `justfile`, `package.json` scripts, CI yaml. `missing` = only manual instructions in README, no runnable automation.
- Engineering daybook: `n/a` for code; skip unless a `notes/` or `docs/lessons` exists.
- Power editing: `n/a` - editor fluency is human, not detectable in repo. Mark `n/a`.
- Select isn't broken / fix the problem not the blame: `n/a` post hoc unless commit log shows blame-shifting messages.

---

## Dimension 4: Pragmatic Paranoia (Chapter 4)

Concepts: `design-by-contract.md`, `crash-early.md`, `dead-programs-tell-no-lies.md`, `assertive-programming.md`, `resource-balancing.md`, `dont-outrun-your-headlights.md`

What good looks like: code assumes things go wrong and fails loud at the boundary. Resources paired acquire/release. Assertions on impossible states.

Evidence signals:
- Crash early / dead programs tell no lies: guards that `return`/`throw`/`exit` on impossible state early in functions. `missing` = functions that plow ahead on null/undefined. grep for early returns after validation.
- Assertive programming: `assert(...)`, `expect(...)`, `invariant(...)`, runtime checks on preconditions. `missing` = no assertions anywhere; `partial` = assertions only in tests.
- Design by contract: typed signatures, validation at trust boundaries (Pydantic/Zod/Joi on inputs, not just at UI), precondition checks. `missing` = `any` types, unvalidated external input reaching business logic.
- Resource balancing: acquire/release paired in the same scope (`with`, `using`, `try/finally`, `defer`, RAII). `missing` = manual `open()`/`close()` without finally, or `lock()` without unlock. grep for `open(` without `with`/`finally`/`close`.
- Don't outrun headlights: small commit/PR cadence; large unreviewed merges = `partial`. `n/a` if no git history.
- Swallowed errors (anti-signal across this dimension): grep for `catch.*\{\s*\}` (empty catch), `catch (_)`, `// ignore`, `console.log(err)` without rethrow, `except: pass`, `except Exception: pass`. Each is a paranoia violation.

---

## Dimension 5: Bend, or Break (Chapter 5)

Concepts: `decoupling.md`, `law-of-demeter.md`, `tell-dont-ask.md`, `finite-state-machine.md`, `juggling-the-real-world.md`, `observer-pattern.md`, `publish-subscribe.md`, `reactive-programming.md`, `transforming-programming.md`, `inheritance-tax.md`, `configuration.md`

What good looks like: separate concepts kept separate. Objects told what to do, not interrogated. Behavior configurable without redeploy. Composition over inheritance.

Evidence signals:
- Law of Demeter: train wrecks `a.b().c().d()` in method bodies. grep for chained calls of depth 3+ on non-builder/fluent types. `partial` = a few, `missing` = widespread.
- Tell, don't ask: code that pulls state out, branches, then pushes back (`if (obj.getX() > 0) obj.setX(...)`) vs. `obj.doThing()`. grep for get-then-branch-then-set patterns.
- Decoupling: event bus, observer, or pub/sub presence (`emit`, `on(`, `subscribe`, `publish`, `EventEmitter`, `pytest` fixtures decoupling). `missing` = direct cross-module calls where events would fit.
- Inheritance tax: deep class hierarchies (3+ levels) used for code reuse; `extends`/inherits to share implementation rather than interface. `implemented` = composition, delegation, mixins/interfaces.
- Configuration: values that change post-deploy or per-environment externalized (`config/`, env vars, `.env.example`, no hardcoded URLs/regions/credentials in source). grep for `http://`/`https://` URLs, region strings, connection strings in source outside config.
- Reactive / transforming / FSM / blackboards: `n/a` unless the domain uses streams, pipelines, or state machines. If it does and none exists, `missing`.

---

## Dimension 6: Concurrency (Chapter 6)

Concepts: `activity-diagram.md`, `temporal-coupling.md`, `semaphore.md`, `shared-state.md`, `actor-model.md`, `blackboards.md`

What good looks like: shared mutable state minimized or protected. No hidden temporal ordering. Concurrency primitives used deliberately.

Evidence signals:
- Shared state is incorrect state: mutable globals, singletons holding state, module-level dicts/lists mutated across threads. grep for `global`, `static` mutable, module-level `var` mutated in handlers. `implemented` = message passing, immutable data, or proper synchronization.
- Semaphore / mutual exclusion: locks used around shared mutation (`Mutex`, `Lock`, `synchronized`, `asyncio.Lock`). `missing` = shared mutable state with no locking. `partial` = locks present but coarse/global.
- Temporal coupling: functions that must be called in a specific order with no enforcement (init() must run before use()). grep for `init()` patterns, boolean "isReady" flags, comments like "must be called after".
- Actor model / blackboards: `n/a` unless the system is distributed; if it is and uses raw shared memory instead of messages, `missing`.
- Activity diagrams: `n/a` unless docs/`*.puml`/mermaid sequence diagrams exist.

Mark the whole dimension `n/a` only for genuinely single-threaded, stateless tools (a CLI with no background work, no shared resources).

---

## Dimension 7: While You Are Coding (Chapter 7)

Concepts: `listen-to-your-lizard-brain.md`, `program-deliberately.md`, `programming-by-coincidence.md`, `algorithm-speed.md`, `big-o-notation.md`, `refactoring.md`, `test-to-code.md`, `test-driven-development.md`, `property-based-testing.md`, `attack-surface.md`, `principle-of-least-privilege.md`, `stay-safe-out-there.md`, `naming-things.md`

What good looks like: deliberate code, named for intent. Tests at multiple levels. Smallest practical attack surface. Least privilege. Algorithms chosen with awareness of cost.

Evidence signals:
- Naming things: identifiers that reveal intent (`calculateInvoiceTotal` not `processData`, `userCount` not `n`). grep for `data`, `info`, `temp`, `foo`, `obj`, `val`, `item`, `thing` as names. `implemented` = domain language in names; `partial` = a few vague names.
- TDD / test-to-code: test files colocated (`*.test.ts`, `test_*.py`), test-to-source ratio. `missing` = no tests or tests only for one happy path. `implemented` = unit + integration coverage, edge cases.
- Property-based testing: `hypothesis`, `fast-check`, `jqwik`, `PropCheck` imports. `missing` = none (common; only flag if domain is parser/numeric where it matters).
- Attack surface: count of exposed entry points (routes, public functions, exported symbols). `implemented` = minimal public API, internal modules marked private (`_` prefix, `internal`, `package`-private).
- Principle of least privilege: service accounts/roles scoped; grep configs/IaC for `*` permissions, `AdministratorAccess`, `mode 0777`, `chmod 777`. `missing` = broad wildcard perms.
- Stay safe out there: input validation at boundaries (Pydantic/Zod on every external input), parameterized queries (no string-interpolated SQL - grep for `f"SELECT`, `+ "SELECT"`, `${...}` in SQL), output escaping. `missing` = string-built SQL or unescaped HTML.
- Algorithm speed / big-O: hot-path loops with nested iteration over growing collections (O(n^2) in request handlers). `partial` = some naive scans flagged in comments.
- Refactoring: git log showing refactor commits separate from feature commits; `partial` if everything is bundled into "update" commits.
- Programming by coincidence / lizard brain / program deliberately: `n/a` post hoc unless comments reveal coincidence ("not sure why this works").

---

## Dimension 8: Before the Project (Chapter 8)

Concepts: `project-glossary.md`, `requirements-pit.md`, `find-the-box.md`, `solving-impossible-puzzles.md`, `conways-law.md`, `mob-programming.md`, `pair-programming.md`, `working-together.md`, `essence-of-agility.md`

What good looks like: a shared glossary, requirements worked with users not collected, real constraints identified, org structure acknowledged.

Evidence signals (most are docs/process, lighter on code):
- Project glossary: `docs/glossary.md`, `GLOSSARY.md`, or a terms file. `missing` = domain terms used in code with no definitions.
- Requirements pit / find the box / solving impossible puzzles: user-story or requirement docs that show iteration (`docs/specs`, `requirements/`, ADRs noting constraint discovery). `n/a` for libraries.
- Conway's law: repo/module boundaries reflecting team boundaries. `n/a` solo projects.
- Pair/mob programming, working together: PR review evidence - reviewers on PRs, `Co-authored-by`, multi-author commits. `missing` = single-author, no reviews. `n/a` solo.
- Essence of agility: small batches, frequent commits, CI. `missing` = rare huge commits, no CI.

---

## Dimension 9: Pragmatic Projects (Chapter 9)

Concepts: `pragmatic-teams.md`, `cargo-cult-programming.md`, `coconuts-dont-cut-it.md`, `full-automation.md`, `pragmatic-starter-kit.md`, `continuous-testing.md`, `delight-your-users.md`, `pride-and-prejudice.md`, `sign-your-work.md`

What good looks like: the pragmatic starter kit in force - version control, ruthless continuous testing, full automation. No cargo-cult ceremony.

Evidence signals:
- Pragmatic starter kit / full automation: `.git`, CI config (`.github/workflows`, `.gitlab-ci.yml`, `circleci/`), and a test runner all present and wired. `partial` = CI exists but doesn't run tests or build. `missing` = none.
- Continuous testing / ruthless testing: CI gates on tests, coverage thresholds in config, tests run on PR. grep CI yaml for `test`, `pytest`, `vitest`, `jest`. `missing` = no CI test step.
- Cargo cult / coconuts: ceremony without function - e.g. empty `STATUS.md`, boilerplate agile files, `Dockerfile` that wraps `python script.py` with no benefit, 100% coverage assertions on trivial getters. Flag only concrete examples.
- Delight users: product/UX tracking, feedback loop in docs. `n/a` for libraries.
- Pride and prejudice / sign your work: author attribution in commits/code (`@author`, signed commits, `Co-authored-by`), CODEOWNERS file. `missing` = anonymous commits, no CODEOWNERS.

---

## Dimension 10: A Pragmatic Philosophy of Ethics (Postface)

Concepts: `first-do-no-harm.md`, `dont-enable-scumbags.md`

What good looks like: code that considers harm to users. No features whose sole purpose is deception or exploitation.

Evidence signals:
- First, do no harm: data handling that minimizes collection, retention limits, PII handling care. grep for logging of sensitive fields (`password`, `token`, `ssn`, `credit`, `auth` in log statements). `partial` = some sensitive fields logged.
- Don't enable scumbags: dark-pattern mechanics - deceptive defaults, tracking that evades consent, features designed to lock in or mislead. Only flag concrete, defensible examples. Default to `n/a` if nothing applies.

This dimension is high-judgment. The auditor flags only clear, cited evidence and otherwise marks `n/a` with a one-line justification.