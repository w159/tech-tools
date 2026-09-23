---
name: atlas-review
description: 'Risk-selected multi-persona review of a diff, branch, or PR: determines scope and depth from the actual change, selects reviewer personas by trigger signals (always-on correctness; conditional security, performance, data-migration, maintainability, testing, reliability, API-contract, agent-native, learnings, adversarial, previous-comments, standards), dispatches each as an independent read-only subagent seeded with a persona prompt asset, merges their typed findings into a stable-numbered report, validates every P0/P1 through atlas:verifier, and delivers a report-only verdict (Ready-to-merge / Ready-with-fixes / Not-ready). Local mutation only behind an explicit apply:local flag. Use when reviewing a changeset before merge - NOT for whole-codebase sweeps (use atlas-audit) and NOT for single-claim verification (use atlas:verifier directly).'
when_to_use: review a diff, branch, or PR with multiple independent expert reviewers before merge
allowed-tools: Read, Glob, Grep, Bash, Edit, Write, Agent, Task
argument-hint: '[base-ref | PR-number | diff spec] [depth:full|auto] [apply:local]'
context: fork
agent: general-purpose
---

# atlas-review

Multi-persona, risk-selected review of one changeset. The roster changes with the diff: auth code summons a security reviewer, a migration summons a data-migration reviewer, a 400-line restructure summons a maintainability reviewer and an adversary. Reviewers work independently — each sees the diff, never another reviewer's findings — and every P0/P1 finding is independently validated before you report it. The default output is a report, not a patch.

## How this differs from its neighbors (read before running)

| | atlas-review (this skill) | atlas-audit | atlas:verifier |
|---|---|---|---|
| Target | one diff / branch / PR | whole codebase | one claim |
| Trigger model | risk signals in the diff | discovery-first knowledge graph | dispatched per claim |
| Voices | many independent personas | one reviewer per dimension | single fresh-context skeptic |
| Output | verdict on the changeset | prioritized findings across repo | verified / rejected / needs-evidence |
| Mutation | none by default | none | none |

If the ask is "find what's wrong with this repo," use `atlas-audit`. If the ask is "is this change safe to merge," use this skill. A single disputed finding from this skill's report is exactly what `atlas:verifier` exists to check — and this skill already routes its P0/P1 findings through it.

Apply the Operating Contract to this entire task. It is injected below.

```!
cat "${CLAUDE_PLUGIN_ROOT}/references/operating-contract.md"
```

If the contract did not load above, read `${CLAUDE_PLUGIN_ROOT}/references/operating-contract.md` and apply it before proceeding.

## Hard behavioral lines

1. **Report-only by default.** This skill never mutates the working tree unless the invocation carries an explicit `apply:local` flag. Even then, mutation happens in a separate post-report phase via `atlas:implementer` on an isolated, self-reviewed commit — never during the review pass itself.
2. **Never push, never open a PR, never merge.** Not even under `apply:local`. Gating push/PR is the orchestrator's consent model (`atlas-orchestrate`), not this skill's.
3. **Reviewer independence is load-bearing.** Reviewers receive the diff scope and intent context, but never each other's findings, never the synthesis, and never the validator verdicts. Do not "save tokens" by sharing results between reviewers; correlated reviewers find correlated things and the report inherits their blind spots.
4. **Severity never grants mutation permission.** A P0 finding is information about risk, not authorization to fix.
5. **No user questions.** Resolve scope, depth, and roster from the diff and repo. State assumptions in the report instead of asking.
6. **Every actionable claim is validated or clearly labeled.** P0/P1 findings route through `atlas:verifier` (Phase 6) before being reported as actionable. Refuted findings are dropped, not downgraded into the report.

## Phases

Each phase reads exactly one reference. Read it at the phase boundary, not upfront.

| Phase | Purpose | Reference |
|---|---|---|
| 1. Scope & depth | Determine what changed, how big it is, how deep to review | `references/scope-and-depth.md` |
| 2. Intent | Extract what the change claims to do (plan/doc/diff inference) | `references/scope-and-depth.md` (§ Intent) |
| 3. Persona selection | Risk-based roster from the diff's trigger signals | `references/persona-selection.md` |
| 4. Dispatch | Bounded concurrent Task calls, one per persona | `references/dispatch-reviewers.md` |
| 5. Synthesis | Dedup, stable numbering, typed envelope merge | `references/findings-envelope.md` |
| 6. Validation | `atlas:verifier` on every P0/P1 (and 75/100-confidence actionable findings) | `references/synthesis-and-verdicts.md` |
| 7. Report & verdict | Verdict rules, report format, `apply:local` protocol | `references/synthesis-and-verdicts.md` |

Run phases 1-3 inline (they are orchestrator judgment over the diff). Phases 4-6 are subagent waves. Phase 7 is orchestrator-only synthesis — never delegate the report.

## Persona prompt assets

Every persona lives as a self-contained prompt file under `references/personas/`. The dispatch references the file path; the reviewer subagent reads it as its operating instructions. Never inline a persona into the dispatch prompt — the asset is the versioned contract, and editing an asset is how this skill improves without touching the spine.

| Asset | Activation |
|---|---|
| `references/personas/correctness.md` | always on |
| `references/personas/standards.md` | repo declares standards (CODING_STANDARDS / CLAUDE.md / AGENTS.md criteria) |
| `references/personas/testing.md` | tests/harness changed, or behavior changed without test work |
| `references/personas/maintainability.md` | ~200+ executable lines or structurally invasive diff |
| `references/personas/agent-native.md` | skills / agents / prompts / tools / MCP / agent-facing surface changed |
| `references/personas/learnings.md` | matching `docs/lessons/` entry or declared Compound Pack exists |
| `references/personas/security.md` | auth / public endpoints / input handling / permissions / secrets |
| `references/personas/performance.md` | query shape / algorithms / transforms / cache behavior |
| `references/personas/api-contract.md` | public or external boundary changed |
| `references/personas/data-migration.md` | migrations / schema / backfills |
| `references/personas/reliability.md` | error handling / retries / timeouts / background jobs |
| `references/personas/adversarial.md` | large diff, or persistence / auth / payment / concurrency / external-API / silent-pass risk |
| `references/personas/previous-comments.md` | PR carries prior review comments |

Full trigger definitions and the suppression hierarchy are in `references/persona-selection.md`. A roster of correctness-only is valid for a small, low-risk diff; correctness is never skipped.

## Typed findings

Every reviewer returns the same finding envelope — title, severity P0-P3, file/line, rationale, evidence, confidence (0/25/50/75/100 anchors), autofix class (`gated_auto|manual|advisory`), owner, verification requirement, pre-existing flag, and `protected_subject` tag for high-consequence classes (memory-safety, concurrency, data-loss, auth, injection, public-contracts, secrets, crypto). A 75/100-confidence finding must quote the exact motivating line as its first evidence item. Full schema, anchors, and evidence gates: `references/findings-envelope.md`.

Findings flow into atlas's existing ledger: after synthesis, the run stamps `.atlas/.run/findings.json` via `python3 "${CLAUDE_PLUGIN_ROOT}/scripts/atlas_finding.py"` — one row per validated P0/P1 verdict and one row for the run's final verdict — reusing the mechanism `atlas:verifier` already requires. Reviewer detail artifacts live under `.atlas/.run/review/<run-id>/` (operational state, per docs SSOT), not in `docs/`. The report itself is chat output; it is not a durable docs/ artifact unless the user asks for one.

## Dispatch shape

All reviewer dispatches follow the atlas subagent-kit contract (`GOAL / DELIVERABLE / SUCCESS CRITERIA / OUT OF SCOPE / STOP CONDITIONS`), name their tools explicitly, and are read-only (`TOOLS FORBIDDEN: Write, Edit, git push, + Task/Agent`). Bounded concurrency ~4-6 in flight. Reviewers are generic read-only subagents seeded with the persona asset — they are not `atlas:*` named agents, so they stay cheap, parallel, and disposable; the only named atlas agent this skill dispatches is `atlas:verifier` in Phase 6 (and `atlas:implementer` under `apply:local`). Exact payloads and batching: `references/dispatch-reviewers.md`.

## Final verdicts

Exactly one of:

- **Ready-to-merge** — no open P0, no open P1.
- **Ready-with-fixes** — no open P0; at least one open P1, each with a stated fix owner.
- **Not-ready** — any open P0, or P1s without credible owners.

Open P0 forbids ready. Open P1 caps at Ready-with-fixes. Advisory (50-confidence non-P0) findings are listed but never move the verdict.

## Report skeleton

```
## Review: <scope one-liner>
Scope: <base..head, N files, M lines>  Depth: <auto|full>  Run: <run-id>
Intent: <one sentence>
Reviewers: <selected roster with the trigger that summoned each>

### P0 — <verdict-blocking>
| # | Finding | Location | Confidence | Protected | Evidence |
(stable IDs R-001...; empty sections still render as "None")

### P1 — <must fix before or at merge>
### P2 / P3 / Advisory
### Pre-existing (out of scope for this verdict)
### Coverage
<what each reviewer examined; what no reviewer examined>
### Validator outcomes
<atlas:verifier verdict per validated finding: verified / rejected(dropped) / needs-evidence>
### Residual risks & testing gaps
## Verdict: <Ready-to-merge | Ready-with-fixes | Not-ready>
<recap of the findings that drive it>
```

## `apply:local` protocol (the only mutation path)

Requires the literal flag. Sequence, in order, after the report is delivered:

1. Filter to findings with `autofix_class: gated_auto|manual`, `owner: downstream-resolver`, and a validator `verified` verdict. Agreement is evidence, not permission — anything with a `protected_subject` tag is `manual` regardless of its declared class.
2. Confirm the pre-review tree was clean (`git status`). If dirty, stop: report the findings and decline apply.
3. Dispatch one `atlas:implementer` per coherent fix group (batch by file/severity), each with a minimal-diff brief and a named verification command. Fixes that cannot name their verification command are `advisory`, not applied.
4. Run the affected gate, self-review the resulting diff, and create one isolated `fix(review): ...` commit containing only fix-owned files. Never mix review changes with the reviewed work in one commit; never push.
5. Re-run nothing else. Report applied/skipped counts and the commit SHA.
