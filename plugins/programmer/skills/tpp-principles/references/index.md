# Pragmatic Programmer Concept Index

Two parts: (1) a keyword-to-concept trigger map used by the nudge hook and the principles skill, and (2) the full 89-concept index grouped by chapter. Concept files live in `concepts/<file>.md` relative to this file.

---

## Part 1: Keyword to Concept Trigger Map

Match the active concern to concept files. When a keyword appears, surface the listed concept(s). Keep output to 1-4 concepts.

| Keyword / phrase in task | Concept file(s) |
|---|---|
| debug, debugging, bug, reproduce, root cause | `debugging.md`, `fix-the-problem-not-the-blame.md`, `dont-assume-prove-it.md`, `failing-test-before-fixing-code.md` |
| binary chop, bisect, narrow down | `binary-chop.md` |
| rubber duck, explain out loud | `rubber-ducking.md` |
| design, architecture, structure, module, layer | `etc-easier-to-change.md`, `orthogonality.md`, `decoupling.md` |
| duplicate, repeat, copy-paste, same code | `dry-dont-repeat-yourself.md` |
| reuse, share code | `dry-dont-repeat-yourself.md` (make it easy to reuse) |
| change, evolve, flexible, future-proof | `etc-easier-to-change.md`, `reversibility.md` |
| vendor lock-in, cloud, swap, portable | `reversibility.md`, `orthogonality.md` |
| tracer bullet, skeleton, end-to-end, spike | `tracer-bullets.md`, `prototypes.md` |
| prototype, explore risky | `prototypes.md` |
| domain language, ubiquitous language, DSL | `domain-languages.md`, `project-glossary.md` |
| estimate, schedule, how long | `estimating.md` |
| decouple, coupling, dependency, demeter, train wreck | `decoupling.md`, `law-of-demeter.md`, `tell-dont-ask.md` |
| inheritance, extends, subclass, base class | `inheritance-tax.md` |
| composition over inheritance, delegate, mixin | `inheritance-tax.md`, `orthogonality.md` |
| configuration, env, externalize, hardcode | `configuration.md` |
| event, observer, subscribe, publish, emit | `observer-pattern.md`, `publish-subscribe.md` |
| reactive, stream, signals, auto-update | `reactive-programming.md` |
| transform, pipeline, map filter reduce | `transforming-programming.md` |
| state machine, fsm, states, transitions | `finite-state-machine.md` |
| concurrency, async, thread, parallel | `shared-state.md`, `temporal-coupling.md`, `semaphore.md`, `actor-model.md` |
| lock, mutex, race condition, shared state | `semaphore.md`, `shared-state.md` |
| actor, message passing, no shared state | `actor-model.md`, `blackboards.md` |
| test, testing, coverage, unit test | `test-to-code.md`, `test-driven-development.md`, `continuous-testing.md` |
| TDD, red green refactor, write test first | `test-driven-development.md`, `failing-test-before-fixing-code.md` |
| property-based, hypothesis, fast-check, random inputs | `property-based-testing.md` |
| refactor, restructuring, clean code | `refactoring.md` |
| algorithm, performance, big-O, complexity, scale | `algorithm-speed.md`, `big-o-notation.md` |
| name, naming, rename, identifier | `naming-things.md` |
| security, attack, exploit, vulnerability | `attack-surface.md`, `principle-of-least-privilege.md`, `stay-safe-out-there.md` |
| auth, permission, privilege, access control | `principle-of-least-privilege.md`, `stay-safe-out-there.md` |
| error, exception, crash, fail, assert | `crash-early.md`, `dead-programs-tell-no-lies.md`, `assertive-programming.md` |
| contract, precondition, postcondition, invariant | `design-by-contract.md` |
| resource, leak, open close, acquire release | `resource-balancing.md` |
| swallow error, empty catch, silent failure | `crash-early.md`, `dead-programs-tell-no-lies.md` |
| tool, shell, command line, automate, script | `shell-games.md`, `full-automation.md`, `text-manipulation.md` |
| version control, git, commit, branch | `version-control.md`, `pragmatic-starter-kit.md` |
| plain text, human-readable, config format | `plain-text.md` |
| CI, CD, pipeline, automation, build | `full-automation.md`, `pragmatic-starter-kit.md`, `continuous-testing.md` |
| requirement, spec, what user needs, constraints | `requirements-pit.md`, `find-the-box.md`, `solving-impossible-puzzles.md` |
| glossary, terms, vocabulary | `project-glossary.md`, `domain-languages.md` |
| team, conway, org structure, boundaries | `conways-law.md`, `pragmatic-teams.md` |
| pair, mob, working together, review | `pair-programming.md`, `mob-programming.md`, `working-together.md` |
| agile, iterate, feedback, small steps | `essence-of-agility.md`, `tracer-bullets.md` |
| broken window, rot, tech debt, cleanup | `broken-windows.md`, `software-entropy.md`, `refactoring.md` |
| boiled frog, drift, big picture | `boiled-frog.md` |
| stone soup, bootstrap, start small | `stone-soup.md` |
| good enough, scope, perfectionism | `good-enough-software.md` |
| responsibility, own mistake, accountability | `take-responsibility.md`, `provide-options-dont-make-excuses.md` |
| knowledge, learn, portfolio, stay current | `knowledge-portfolio.md` |
| communicate, audience, writing, docs | `communicate.md` |
| cargo cult, ceremony, fashion, copy method | `cargo-cult-programming.md`, `coconuts-dont-cut-it.md` |
| delight, user value, expectations | `delight-your-users.md` |
| pride, sign work, ownership, craftsmanship | `pride-and-prejudice.md`, `sign-your-work.md` |
| ethics, harm, safety, users | `first-do-no-harm.md`, `dont-enable-scumbags.md` |
| lizard brain, gut feeling, doubt | `listen-to-your-lizard-brain.md` |
| deliberate, coincidence, why does it work | `program-deliberately.md`, `programming-by-coincidence.md` |

High-frequency defaults when the concern is generic "write/change code": `etc-easier-to-change.md`, `dry-dont-repeat-yourself.md`, `orthogonality.md`, `broken-windows.md`, `crash-early.md`, `design-by-contract.md`.

---

## Part 2: Full Concept Index (89 entries)

### Preface (From the Preface to the First Edition)

- `care-about-your-craft.md` - There is no point in developing software unless you care about doing it well.
- `think-about-your-work.md` - Ongoing critical appraisal of every decision, every day, on every project.

### Chapter 1: A Pragmatic Philosophy

- `its-your-life.md` - You own your career and working conditions; the power and responsibility to change them are yours.
- `provide-options-dont-make-excuses.md` - When something goes wrong, bring solutions and paths forward instead of blame.
- `take-responsibility.md` - Commit to doing things right, own mistakes honestly, build the trust responsibility requires.
- `broken-windows.md` - Don't leave bad designs, wrong decisions, or poor code unrepaired; one sign of neglect invites more.
- `software-entropy.md` - Software drifts toward disorder over time, driven more by psychology and neglect than by any single technical cause.
- `boiled-frog.md` - Watch the big picture; slow incremental change goes unnoticed until the accumulated result has cooked you.
- `stone-soup.md` - When you can't get approval for the whole thing, build a small undeniable piece first and let people rally.
- `good-enough-software.md` - Deliberately write software that is good enough for users, maintainers, and your peace of mind.
- `knowledge-portfolio.md` - Manage what you know like a financial portfolio: invest regularly, diversify, balance risk, rebalance.
- `communicate.md` - Treat your native language as another programming language; know your audience and package what you say.

### Chapter 2: A Pragmatic Approach

- `etc-easier-to-change.md` - Good design is whatever makes the resulting software easier to change later.
- `dry-dont-repeat-yourself.md` - Every piece of knowledge has a single, unambiguous, authoritative representation.
- `orthogonality.md` - Design components so changing one has no effect on unrelated others.
- `reversibility.md` - Avoid irreversible decisions; keep architecture, vendors, and technology easy to change.
- `tracer-bullets.md` - Build a lean but complete end-to-end skeleton first, then flesh it out using real feedback.
- `prototypes.md` - Build cheap disposable models to explore risky aspects; the value is the lessons, not the code.
- `domain-languages.md` - Program using the vocabulary and semantics of the problem domain.
- `estimating.md` - Estimate by building a model, choosing units that convey intended accuracy, refining as reality arrives.

### Chapter 3: The Basic Tools

- `plain-text.md` - Store knowledge in human-readable, self-describing plain text, not opaque binary.
- `shell-games.md` - Use the command shell as your workbench; it combines and automates tools a GUI cannot.
- `power-editing.md` - Work toward editor fluency so editing becomes instinctive.
- `version-control.md` - Keep everything under version control; a project-wide time machine and collaboration hub.
- `select-isnt-broken.md` - Suspect your own code long before the OS, compiler, or a third-party library.
- `binary-chop.md` - Locate a bug by repeatedly halving the search space instead of examining every candidate.
- `debugging.md` - Treat debugging as ordinary problem solving: stay calm, gather data, reproduce, chase root cause.
- `dont-assume-prove-it.md` - When a surprising bug touches trusted code, prove it works in this exact context.
- `failing-test-before-fixing-code.md` - Make a bug reproducible as a failing test before fixing it.
- `fix-the-problem-not-the-blame.md` - Spend energy fixing the bug, not assigning fault.
- `rubber-ducking.md` - Explain the problem out loud, step by step; the solution often reveals itself.
- `text-manipulation.md` - Learn a general-purpose text manipulation language for quick utilities.
- `engineering-daybook.md` - Keep a paper journal of what you did, learned, and thought while working.

### Chapter 4: Pragmatic Paranoia

- `design-by-contract.md` - Document and enforce the rights and responsibilities of modules so each routine does no more, no less.
- `crash-early.md` - Fail as soon as you detect something impossible; crashing at the point of trouble beats limping on.
- `dead-programs-tell-no-lies.md` - When the impossible happens, stop trusting the program and terminate.
- `assertive-programming.md` - Use assertions to verify things that should never happen, so violations fail loudly.
- `resource-balancing.md` - Whoever allocates a resource deallocates it; pair every acquire with its release.
- `dont-outrun-your-headlights.md` - Take small deliberate steps guided by real feedback; never commit to a step that needs fortune telling.

### Chapter 5: Bend, or Break

- `decoupling.md` - Keep separate concepts separate so a change in one piece doesn't force changes in many.
- `law-of-demeter.md` - A method should talk only to its immediate neighbors; don't chain calls into train wrecks.
- `tell-dont-ask.md` - Tell an object what you want done; don't pull its state out, decide, and push a result back.
- `finite-state-machine.md` - Specify event handling as states, a current state, and transition rules.
- `juggling-the-real-world.md` - Write responsive applications that react to events without tight coupling.
- `observer-pattern.md` - An event source keeps a list of interested clients and calls each on an event.
- `publish-subscribe.md` - Publishers and subscribers communicate through named channels, removing coupling.
- `reactive-programming.md` - Values auto-update in response to changes in the values they depend on.
- `transforming-programming.md` - Think of a program as transformations converting input to output, a data pipeline.
- `inheritance-tax.md` - The hidden coupling cost of class inheritance; usually better paid with interfaces, delegation, or mixins.
- `configuration.md` - Keep values that may change after launch or differ across environments outside the code.

### Chapter 6: Concurrency

- `activity-diagram.md` - A notation capturing a workflow so you can see what must be ordered and what can be parallel.
- `temporal-coupling.md` - Imposing a sequence or timing the problem itself does not require.
- `semaphore.md` - A token only one party can hold, used to control exclusive access to a shared resource.
- `shared-state.md` - Two or more chunks of code holding references to the same mutable data can become inconsistent.
- `actor-model.md` - Concurrency as independent processors sharing no data, communicating only by passing messages.
- `blackboards.md` - A shared space where independent agents post and read facts to coordinate without knowing each other.

### Chapter 7: While You Are Coding

- `listen-to-your-lizard-brain.md` - Pay attention to nagging doubts; nonconscious pattern knowledge has no words.
- `program-deliberately.md` - Always be aware of what and why; rely only on reliable things.
- `programming-by-coincidence.md` - Relying on code that seems to work without understanding why.
- `algorithm-speed.md` - Estimate the resources an algorithm uses as input grows; test estimates against reality.
- `big-o-notation.md` - A mathematical upper bound on how an algorithm's time or memory grows with input.
- `refactoring.md` - Restructure existing code, altering internal structure without changing external behavior.
- `test-to-code.md` - Testing is about feedback that guides coding; the benefit is in thinking about and writing tests.
- `test-driven-development.md` - Write tests up front in a short cycle of test, minimal code, refactor.
- `property-based-testing.md` - Have the computer generate wide-ranging random inputs and check contracts always hold.
- `attack-surface.md` - The sum of all access points an attacker can enter; keep it as small as possible.
- `principle-of-least-privilege.md` - Use the least privilege for the shortest time, reducing attack scope.
- `stay-safe-out-there.md` - Write code defensively against deliberate attackers; most breaches are carelessness, not clever attacks.
- `naming-things.md` - Name things by the role they play so names reveal intent; rename without hesitation when meaning drifts.

### Chapter 8: Before the Project

- `project-glossary.md` - One accessible place defining all project terms so everyone uses the same words.
- `requirements-pit.md` - Requirements are learned with clients in a feedback loop, not collected off the ground.
- `find-the-box.md` - Identify the real constraints and degrees of freedom instead of "thinking outside the box".
- `solving-impossible-puzzles.md` - When a problem looks impossible, identify real constraints and degrees of freedom.
- `conways-law.md` - An organization's communication structures end up mirrored in the systems it designs.
- `mob-programming.md` - More than two people, including non-developers, work one problem together with one typist.
- `pair-programming.md` - Two developers work one problem together, one typing, switching as needed.
- `working-together.md` - Solve problems together while actually coding, not through meetings and heavyweight docs.
- `essence-of-agility.md` - Agile is an adjective describing how you work, not a process you install.

### Chapter 9: Pragmatic Projects

- `pragmatic-teams.md` - Apply the individual pragmatic practices at the team level; a small stable group as one entity.
- `cargo-cult-programming.md` - Imitating the visible form of a practice while missing the content that makes it work.
- `coconuts-dont-cut-it.md` - Copying visible artifacts of a successful method without understanding why is cargo cult imitation.
- `full-automation.md` - Run every recurring procedure through scripted, repeatable automation with no manual intervention.
- `pragmatic-starter-kit.md` - The three foundations every project needs: version control, ruthless testing, full automation.
- `continuous-testing.md` - Test early, often, automatically across every level; trap each bug with a new test.
- `delight-your-users.md` - Deliver the business value users actually expect, not merely working code against a spec.
- `pride-and-prejudice.md` - Sign your work and take pride in it; treat others' code with mutual respect.
- `sign-your-work.md` - Put your name to designs and code; your signature becomes an indicator of quality.

### Postface: A Pragmatic Philosophy of Ethics

- `first-do-no-harm.md` - Before delivering any code, ask whether you have done your best to protect users from harm.
- `dont-enable-scumbags.md` - If a project skirts ethical behavior, working on it makes you as responsible as its sponsors.