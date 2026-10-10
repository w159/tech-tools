# Skill Finder — say what you want, get the one skill

Plain-language map from "the thing I want" to the skill that does it. One row per skill.

**Trigger** means:
- **Auto** — the agent starts the skill itself when your request matches that row's phrasing. You don't need to remember its name.
- **Manual** — you invoke it by name (type the skill name, e.g. `atlas-tour`). It never fires on its own.

Rows marked **(new)** ship in the current wave; if a row's skill feels absent, it may not be installed in your build yet.

Every skill's full contract lives in its own `SKILL.md` under `plugins/atlas/skills/`, and its `description:` frontmatter is what an agent reads when deciding to fire — treat this sheet as the index, not the rules.

## Start here

| Intent ("I want to…") | Skill | Trigger | What you get |
| --- | --- | --- | --- |
| Set up atlas on this project for the first time | atlas | Manual | Boots the workspace: verifies claude-mem + context-mode, scans the project, recommends tooling (confirming first), wires hooks, seeds the docs/ source of truth |
| Re-run or repair setup: onboard, install, or wire vendor connectors | atlas-setup | Manual | The lifecycle skill: scaffold docs/, install gates and connectors, run the health check, or `--fix` repairs |
| Get a guided first session: what a dispatch, gate, and actually running one task looks like | atlas-tour (new) | Manual | A one-time walkthrough ending in one tiny real task, with plain-language glosses for every atlas term |

## Understand & decide

| Intent ("I want to…") | Skill | Trigger | What you get |
| --- | --- | --- | --- |
| Know how or why this code behaves the way it does | atlas-explain | Auto | Chat answer with file:line evidence from a read-only map; nothing written |
| Get a decisive opinion on a library pick, migration, or contested choice | atlas-pov | Auto | Evidence-grounded verdict graded Adopt / Trial / Hold / Reject |
| Compare 2–3 real approaches before an expensive, hard-to-reverse choice | atlas-bakeoff | Auto | Named-criteria comparison, optional cheap proofs-of-concept, one recommendation |
| Sketch a throwaway demo to answer a "what should this look like" question | atlas-prototype | Auto | A disposable prototype in an isolated run dir, shown to you, then the settled shape documented |
| Write or refresh the product strategy document | atlas-strategy | Auto | Interview-driven `docs/architecture/product-strategy.md` grounded in a repo model |

## Plan & build

| Intent ("I want to…") | Skill | Trigger | What you get |
| --- | --- | --- | --- |
| Nail down requirements before anyone writes code | atlas-brainstorm | Auto | One-question-at-a-time dialogue → requirements-only artifact in `docs/plans/`; never product code |
| Turn a vague coding request into a prompt an agent can execute | atlas-prompt | Auto | Structured, environment-aware rewrite of the request (≤3 clarifying questions first) |
| Write an implementation-ready plan from requirements or a feature description | atlas-plan | Auto | `docs/plans/` plan with U-numbered units, verification contract, and a handoff to atlas-orchestrate |
| Build a feature end to end across UI, API, and data | atlas-feature | Auto | Parallel dispatch of the atlas squad with an independent verifier closing it |
| Run a multi-step or whole-codebase job as a coordinated agent run | atlas-orchestrate | Auto | The engine: decomposed subagent dispatches, execution evidence, independent verification, docs kept current |
| Build or refactor screens and flows on one design system | atlas-frontend | Auto | Design-system-consistent UI, every state handled, verified live in the browser |
| Build one UI component that survives latency, cancellation, and failure | atlas-component | Auto | A reusable component rendering all six interaction states |
| Fix a reproducible bug, exception, or bad output | atlas-debug | Auto | Root-cause fix with evidence, not a symptom patch |
| Make existing code cleaner without changing behavior | atlas-refactor | Auto | Behavior-preserving restructure with before/after evidence |
| Make something measurably faster or cheaper | atlas-optimize | Auto | Baseline → one bounded change → identical re-measure → the real delta |
| Automate a recurring or every-session task | atlas-loop | Auto | Matching loop template from the loop library, instantiated |
| Keep a long-running command (pipeline, script, log tail) watched and checkpointed | atlas-run-watch (new) | Auto | Compact status ticks into context and full logs spilled to the run ledger, babysit-pr-style but for any long job |

## Review & fix

| Intent ("I want to…") | Skill | Trigger | What you get |
| --- | --- | --- | --- |
| Get this diff, branch, or PR reviewed before merge | atlas-review | Auto | Risk-selected multi-persona review; P0/P1 findings independently validated; report-only by default |
| Review a whole queue of PRs in one batch | atlas-review queue mode (new) | Auto | One cross-PR triage table: verdict, worst open severity, run-id, sorted by merge-blocking risk |
| Handle open reviewer comments on a PR | atlas-resolve-pr-feedback | Auto | Each thread triaged fix/reply/needs-human; fixes applied with verification; nothing auto-posted |
| Keep a PR's CI green until it's mergeable | atlas-babysit-pr | Auto | Watches one PR's CI, classifies flaky vs genuine failures, bounded repair loop; never merges |
| Slim down a fresh diff without changing behavior | atlas-simplify | Auto | Three read-only reviewers (reuse/quality/efficiency) over the diff, behavior-preserving apply, gate re-run |
| Ingest new GitHub feedback and triage it | atlas-sweep | Auto | New issues acknowledged, clustered, folded into a rolling `docs/features/` triage doc |
| Turn raw feedback (transcripts, tickets, session notes) into findings | atlas-feedback-analysis | Auto | Prioritized findings each tied to a verbatim source quote |

## Ship & commit

| Intent ("I want to…") | Skill | Trigger | What you get |
| --- | --- | --- | --- |
| Run the whole pipeline (brainstorm → plan → work → simplify → review → commit) with consent gates | atlas-autopilot | Auto | Consent-gated autonomous run of the full spec-to-ship loop; hard stop before any push/PR/merge |
| Make one clean, well-scoped local commit | atlas-commit | Auto | A conventional message grounded in the real diff; stages only the intended files; never pushes |
| Commit, push, and open a PR when work is verified | atlas-ship | Auto | Fresh-context verifier, local commit, then a hard stop for your confirmation before anything leaves the machine |
| Announce what just shipped | atlas-promote | Auto | Plain-language release note / changelog entry / Slack-style draft, grounded in real changes; never auto-posted |
| Put a doc or draft through human review with comments | atlas-proof | Auto | Review workflow with anchored comments in a sidecar file and applied edits |
| Work in an isolated git worktree for parallel work | atlas-worktree | Auto | Linked worktree with run-ledger reuse and dirty-state-protected teardown |
| Hand this session to another session without losing the thread | atlas-handoff | Auto | Dense handoff artifact so the next session resumes with zero re-discovery |

## Test & check

| Intent ("I want to…") | Skill | Trigger | What you get |
| --- | --- | --- | --- |
| Run a full UX test pass on a web app | atlas-ux-test | Auto | Persona-driven real-browser walkthroughs, fuzzing, and a report gating release |
| Smoke-check just the routes my branch touched | atlas-test-browser | Auto | Read-only Pass/Fail/Skip per route with console + network evidence; never fixes |
| Build and test the iOS app on the simulator | atlas-test-xcode | Auto | Simulator boot, xcodebuild test, screenshots + logs, PASS/FAIL report |
| Try the branch diff in a live browser and fix real breaks | atlas-dogfood | Auto | Map routes touched, drive each flow like a user, bounded repair loop |
| Polish spacing, transitions, and micro-interactions on working UI | atlas-polish | Auto | Small live visual/CSS/animation changes you steer in the browser |
| Push a hardening/config fix to many endpoints at once | atlas-harden | Auto | Idempotent CHECK/SET/VERIFY script for RMM/MDM that reports changed vs already-compliant |
| Create or harden a .gitignore | atlas-gitignore | Auto | Deny-by-default allowlist for your stack; secrets re-excluded last |
| Validate a finished Claude Code plugin | atlas-validate | Auto | Structure + manifest + content audit with pass/fail per check; never auto-fixes |
| Audit the codebase for quality, security, and dead code | atlas-audit | Auto | Three modes (code / architecture / self) with adversarially verified findings and a written report |
| Audit a live database before changing it | atlas-db-audit | Auto | Read-only schema + code reconciliation + privilege/naming checks via parallel subagents |
| Act on an audit finding right now | atlas-launch | Auto | Remediation session preloaded with one finding from the latest audit hub |

## Learn & maintain

| Intent ("I want to…") | Skill | Trigger | What you get |
| --- | --- | --- | --- |
| Record one durable lesson from something hard just solved | atlas-compound | Auto | Eligibility-gated capture into `docs/lessons/`, overlap-checked |
| Help atlas improve itself from what it noticed | atlas-doctor | Auto | Mining of session findings asked one by one, applied changes, baseline measure |
| Generate a README from the actual repo | atlas-readme | Auto | Onboarding-grade README with every claim traced to a real file |
| Refresh architecture diagrams in docs/wiki/ | atlas-wiki | Auto | Diagrams regenerated from docs/architecture/ |
| Get a usage/performance/error pulse for a time window | atlas-pulse | Auto | Telemetry-grounded pulse report written to docs/ |
| Get a plain-language status report of where the work stands | atlas-status (new) | Auto | One stakeholder-ready report synthesized from plans, the findings ledger, the todo board, and git log — each claim labeled verified or assumed |