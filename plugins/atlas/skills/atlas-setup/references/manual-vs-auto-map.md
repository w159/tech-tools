# Manual vs Auto Map

The inventory of the 39 atlas skills. atlas-setup uses this table to tell the user what just came online.

## Trigger model

The atlas plugin has exactly one manual skill (atlas-setup). Every other skill auto-triggers from its `description` + `when_to_use`.

- **Manual** = `disable-model-invocation: true`. The model cannot start it. The user invokes it explicitly (slash command or direct call).
- **Auto** = the model may start it when the task matches the description.

Several skills carry more than one mode (for example atlas-frontend: build, component, polish). The first argument or the ask selects the mode, and each SKILL.md names its modes in a table near the top.

| # | Skill | Mode | One-line trigger |
|---|---|---|---|
| 1 | atlas-audit | auto | Audits a codebase: CODE (quality, security, hotspots, dead code, docs drift), ARCHITECTURE (flowcharts, duplication), SELF (atlas run health), or ACT (open a remediation session for one audit finding by id; no id lists them) |
| 2 | atlas-autopilot | auto | Consent-gated autonomous pipeline: runs a ready plan or diagnosed fix via atlas-orchestrate, simplifies, reviews, fixes under a budget, stops at the local commit |
| 3 | atlas-bakeoff | auto | Decides a technical choice with evidence: compares 2-3 approaches against named criteria (bakeoff), or grades one option Adopt, Trial, Hold or Reject (verdict) |
| 4 | atlas-brainstorm | auto | Grills a vague idea one hard question at a time, recommending an answer each turn, until shared understanding |
| 5 | atlas-compound | auto | Captures one durable, verified, non-obvious lesson into docs/lessons/ after an eligibility gate and overlap check |
| 6 | atlas-db-audit | auto | Audits a live database read-only via parallel subagents: schema inventory, schema-to-code reconciliation, privileges, naming |
| 7 | atlas-debug | auto | Diagnoses a reproducible bug, exception, stack trace or bad output and fixes the root cause with evidence |
| 8 | atlas-doctor | auto | Atlas self-improvement loop: mines cross-session findings from atlas.db, applies accepted changes, records a baseline |
| 9 | atlas-dogfood | auto | Drives the branch or PR diff in a live browser via atlas:ui-runtime-tester: full mode repairs genuine breaks in a bounded loop, smoke mode only reports Pass, Fail or Skip per route |
| 10 | atlas-explain | auto | Explains how or why existing code behaves, in chat, with file:line evidence from an atlas:explorer trace; read-only |
| 11 | atlas-frontend | auto | Builds, refactors or polishes frontend UI on one design system (shadcn/ui, Tailwind, Radix), verified live in the browser |
| 12 | atlas-gitignore | auto | Generates a zero-trust, deny-by-default .gitignore for a named stack, secrets re-excluded last |
| 13 | atlas-handoff | auto | Produces a dense session handoff so a fresh session resumes without re-discovery |
| 14 | atlas-harden | auto | Writes an idempotent endpoint remediation script (CHECK/SET/VERIFY) for RMM or MDM that proves whether it changed state |
| 15 | atlas-loop | auto | Matches a recurring or iterative task to a library loop: interval loops use /loop, fan-out loops run as a parallel verify workflow |
| 16 | atlas-optimize | auto | Single-experiment loop: baseline, one hypothesis, one change, identical re-measure, real delta reported |
| 17 | atlas-orchestrate | auto | Orchestrates multi-step, multi-surface or whole-codebase work (build, fix, audit, refactor, investigate) via subagents with independent verification |
| 18 | atlas-plan | auto | Writes an implementation-ready plan to docs/plans/ from a brainstorm artifact or feature description, with U-numbered units and a verification contract |
| 19 | atlas-prompt | auto | Rewrites a vague coding request into a structured, environment-aware prompt, asking up to three questions if scope is ambiguous |
| 20 | atlas-proof | auto | Human-review workflow for project markdown: publishes a doc for review, records anchored comments in a sidecar file, folds feedback back |
| 21 | atlas-prototype | auto | Builds a throwaway prototype in an isolated run directory to answer one visual, interaction or product-shape question, then promotes decisions into a plan or discards it |
| 22 | atlas-pulse | auto | Generates a time-windowed product pulse (usage, performance, errors) from wired telemetry, read-only, into docs/pulses/ |
| 23 | atlas-readme | auto | Generates an onboarding-grade README.md by inspecting the repo, tracing every claim to a file |
| 24 | atlas-refactor | auto | Refactors, renames or restructures code without changing behavior, with before/after evidence |
| 25 | atlas-resolve-pr-feedback | auto | Resolves PR review feedback: triages each thread (fix, reply, needs-human), applies approved fixes, drafts replies, confirms before pushing or posting |
| 26 | atlas-review | auto | Risk-selected multi-persona review of a diff, branch or PR; P0/P1 findings verified, report-only verdict (Ready, Ready-with-fixes, Not-ready) |
| 27 | atlas-run-watch | auto | Watches a long-running job (PID, log tail, CI URL, API, command loop) or one open GitHub PR's CI with tick/checkpoint/re-arm, spilling logs to a run ledger |
| 28 | atlas-setup | MANUAL | Manual atlas lifecycle: onboard (scaffold docs/ and .atlas/), install (claude-mem, context-mode, hooks), connectors (vendor MCP), repair, tour (first-session walkthrough), menu |
| 29 | atlas-ship | auto | Ships finished work: fresh-context verifier checks a clean tree, local commit, stops for confirmation before any push or PR |
| 30 | atlas-simplify | auto | Behavior-preserving simplification pass over a fresh diff (reuse, quality, efficiency reviewers), then re-runs the gate |
| 31 | atlas-status | auto | Builds a stakeholder-readable status rollup for a plan or feature from docs/plans/, findings, the todo board and commits, claims labeled verified or assumed |
| 32 | atlas-sweep | auto | Turns feedback into triaged findings |
| 33 | atlas-test-xcode | auto | Tests an iOS app on the simulator: boots it, builds and tests via xcodebuild, captures screenshots and logs |
| 34 | atlas-testing | auto | Plans, generates, and runs tests in any language: detects stack and existing tests, maps testing gaps, recommends and writes the highest-value next test, runs it, reports evidence |
| 35 | atlas-tui | auto | Opens the Atlas Command Center TUI over live colony tmux workers (omp/claude/codex) |
| 36 | atlas-ux-test | auto | UX test swarm for a web app: generates personas, drives real-browser walkthroughs and fuzzing, gates on client-surface correctness |
| 37 | atlas-validate | auto | Verifies a finished Claude Code plugin: structure, manifest and content quality, file:line findings, pass or fail per check, no auto-fixing |
| 38 | atlas-wiki | auto | Generates and refreshes docs/wiki/ diagrams from docs/architecture/ using graphify |
| 39 | atlas-worktree | auto | Git-worktree primitive: creates or reuses linked worktrees, tears down with dirty-state protection |

## Count check

- Atlas skills: 39 (1 manual, 38 auto)
- Manual skills: atlas-setup

## Armada (separate plugin)

Org deployment moved to the separate `armada` plugin: 11 department agents and 156 department skills (Data, Design, Engineering, Finance, HR, IT Operations, Microsoft 365, Product, Productivity, Security, Support). Install it alongside atlas only for org use; when installed, its skills are all auto and route through the department agents in `plugins/armada/agents/`.

## What atlas-setup reports on first run

After scaffolding, atlas-setup tells the user:

1. That atlas-setup is the one manual skill and how to invoke it.
2. That the other 36 skills are auto-trigger and will start when the task matches their descriptions.
3. Whether the armada plugin is installed, and that org deployment lives there if the user needs it.
