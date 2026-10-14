---
name: atlas-audit
description: "Audits a codebase: CODE (quality, security, hotspots, dead code, docs drift), ARCHITECTURE (flowcharts, duplication), SELF (atlas run health), or ACT (open a remediation session for one audit finding by id; no id lists them). Use to audit a repo, map architecture or fix a finding."
when_to_use: "full-codebase quality or security audit, OWASP review, architecture map, find duplication, dead code, coverage gaps, atlas run health, session transcript forensics, fix finding, remediate audit finding, pick a finding, act on audit results, list findings"
argument-hint: '[act [finding-id]]'
allowed-tools: Read, Glob, Grep, Bash, Agent, Task
---


# atlas-audit

Four modes; pick by the ask, never by question:

| Mode | Trigger | Where |
|---|---|---|
| code (default) | "audit this", quality/security review | this file |
| architecture | "map the architecture", duplication hunt, pre-refactor | `references/architecture-map.md` |
| self | atlas run health, context/asset waste, session forensics | `references/self-telemetry.md` |
| act | `act [finding-id]`: remediate one finding from the latest audit hub; no id lists the actionable findings | `references/act-on-finding.md` |

For act mode, read `${CLAUDE_SKILL_DIR}/references/act-on-finding.md` and follow it. The rest of this file is the code mode.

Discovery-first, comprehensive audit swarm. You supply no arguments. The survey builds a knowledge graph of the codebase, aims every dimension reviewer at the hottest nodes that graph surfaces, verifies every finding adversarially, and delivers a prioritized, file:line-anchored report under docs/audits/atlas-audit-<date>/.

**Elicitation:** before building the graph, if the user's ask did not fix the tier, ask ONE AskUserQuestion: audit depth - comprehensive sweep (recommended for "audit this"), hotspot-only quick pass, or a named-dimension focus (security/OWASP only, correctness only). Depth changes swarm size and wall-clock materially, so it is the user's call; which files are hot is discovery's call, never a question. Then, optionally: if the audit may be handed to compliance, an examiner, or a control-mapped report, ask ONE more AskUserQuestion - which compliance frameworks apply: FTC Safeguards, GLBA (16 CFR 314), SOC 2 CC, OWASP ASVS, any combination, or none (default). Framework selection only adds tags to the output; it never changes which findings are surfaced or verified.

## Zero-arg discovery

The user invokes this skill with no arguments. Phase 1 first discovers the codebase roots (a single-package repo yields one root; a monorepo yields one per package - MCP server, node lib, plugin), then runs the `graphify` skill **scoped per root** to build the codebase knowledge graph: community structure, god nodes (high in-degree, high coupling), and high-centrality hot spots (bridges between modules). Scoping per root keeps each graphify run under its size gate so the build never stalls on a whole-monorepo scope. In parallel, the orchestrator reads docs/ as the SSOT for intended behavior - these docs become the baseline against which code-vs-docs drift is measured.

The graph output determines WHERE each dimension reviewer focuses. Reviewers are not pointed at the whole codebase; they are aimed at the nodes and communities the graph flagged as highest risk. This is what makes the survey comprehensive without being shallow.

The orchestrator records the top-N hot spots (file:line for each) before dispatching any dimension. Nothing fans out until the graph is complete.

## Dimensions (parallel fan-out)

One reviewer per dimension, dispatched with pipeline() so each dimension verifies as soon as its review completes - no barrier between dimensions. Each reviewer receives the hot-spot list from Phase 1 and starts there before widening to the rest of the codebase.

The seven dimensions:

1. **Correctness / bugs** - logic errors, off-by-one, null/undefined propagation, data races, incorrect assumptions in hot-path code.
2. **OWASP + security** - injection, broken auth, sensitive data exposure, insecure deserialization, known-vulnerable dependencies, secrets in code. Composes the `security-review` skill and the `codeql` skill/reference for static analysis coverage.
3. **SOLID / DRY / KISS + best practices** - single-responsibility violations, open/closed violations, leaky abstractions, unnecessary complexity, local code-smell duplication (repeated logic within one module or closely coupled files). Composes the `quality-playbook` skill for structured quality analysis.
4. **Risk hotspots** - files/modules with the highest churn rate, highest coupling, or fewest tests relative to their complexity. The graph's god nodes and bridge nodes are the starting point.
5. **Dead code** - unreachable branches, unused exports, orphaned modules, commented-out blocks that shipped.
6. **Test-coverage gaps** - behaviors with no test, critical paths exercised only by integration tests, edge cases not covered, remediation or idempotent scripts missing a post-change verification step.
7. **Code-vs-docs drift** - discrepancies between docs/ (the SSOT read in Phase 1) and actual implemented behavior: missing docs for live features, documented features that no longer exist, stale examples.

Structural and architectural duplication - parallel subsystems across features doing the same structural job - is out of scope for this dimension list. That work belongs to the ARCHITECTURE mode of this skill. See the Boundary section.

## Adversarial verify

Every finding from every dimension reviewer is confirmed by an independent `atlas:verifier` before it counts (engine law 5). The verifier re-opens the cited lines, re-runs any relevant check, and returns a verdict of "verified" or "rejected" with evidence.

Refuted findings are dropped entirely. They do not appear in the output, not even as "low confidence." The orchestrator never patches a rejected finding - it discards it and moves on. Only verified findings make it into the final report.

The pipeline() shape means verification starts as soon as the first dimension completes, rather than waiting for all seven reviewers to finish. A dimension's findings flow directly into its verifier wave.

## Boundary

atlas-audit owns:

- Correctness and bug findings (logic, data flow, error handling).
- Security vulnerabilities and OWASP findings.
- SOLID/DRY/KISS violations and best-practice gaps.
- Risk hotspot identification (churn + coupling + coverage density).
- Dead code.
- Test-coverage gaps.
- Code-vs-docs drift (docs/ vs. live behavior).
- Local code-smell duplication: repeated logic within a single module or tightly coupled files that share a change rate.

CODE mode does NOT own structural or architectural duplication. That means: parallel subsystems across features doing the same structural job (two auth middlewares, two independent retry loops, two identical pipeline stages in separate features). That belongs to ARCHITECTURE mode.

The boundary is symmetric by design. If a survey dimension reviewer surfaces a structural duplication finding (same pattern appearing in two separate features), the reviewer notes it as out-of-scope and excludes it from its structured return. The orchestrator writes a single line to the output referencing atlas-audit for that class of finding. The two skills never re-audit the same concern.

## Output

Write the audit report and the findings output exactly as the output spec defines, then stop; done when the report file exists. Read `${CLAUDE_SKILL_DIR}/references/output-format.md` for the full detail.

## Workflow shape

This skill runs as a Workflow following the skeleton in `${CLAUDE_SKILL_DIR}/references/workflow-template.md`. The shape is a pipeline from graph through per-dimension review through per-finding verify, with verification starting as each dimension completes - no barrier between dimensions.

The synthesis step (Phase 4), the seven dimensions, severity assignment, and the docs gate are documented in `references/synthesis-framework.md`. Read it when running Phase 4 or when a report comes out unbalanced across dimensions.

### Phase 1 - Graph and docs baseline (sequential, orchestrator-gated)

The orchestrator first discovers the codebase roots dynamically - a discovery pass (an
`atlas:explorer` over the tree plus graphify's own `detect()` for a minimal-context read of where
the real packages are), not a static or config-supplied list. A single-package repo resolves to
one root; this monorepo resolves to one root per MCP server / node lib / plugin. The orchestrator
then runs the `graphify` skill **scoped per discovered root** (with `GRAPHIFY_NONINTERACTIVE=1` set
so a root that still trips the size gate auto-scopes instead of blocking), writing a `graphify-out/`
under each root. It merges each root's hot-spot nodes into a single top-N list and reads docs/ for
the intended-behavior baseline. This phase completes before any dimension fans out. The orchestrator
records the merged top-N hot spot nodes (file:line) and the docs baseline to disk before dispatching
Phase 2.

### Phase 2 - Dimension review (pipeline)

Seven dimension reviewers dispatched via pipeline(). Each reviewer receives the hot-spot list and the docs baseline. Reviewers start at the hottest nodes and widen from there. Each reviewer returns structured findings: { dimension, findings: [ { file, line, severity, description } ] }.

The correctness reviewer works independently. The security reviewer composes `security-review` and `codeql`. The quality reviewer composes `quality-playbook`. Structural-duplication findings encountered by any reviewer are noted as out-of-scope and excluded from the return.

### Phase 3 - Adversarial verify (pipeline, per finding)

As each dimension reviewer completes, its findings flow into a per-finding verify wave. One `atlas:verifier` per finding, dispatched via pipeline(). Each verifier re-opens the cited lines, re-runs the relevant check, and returns "verified" or "rejected" with evidence. Rejected findings are discarded immediately. The orchestrator never waits for all seven dimensions before starting verification.

### Phase 4 - Synthesize and output (orchestrator only)

The orchestrator collects all verified findings, assigns final severity ordering (HIGH first), writes report.md, and generates handoff prompts for accepted findings. Synthesis is never delegated. If atlas:docs-curator is available, the orchestrator dispatches it to record the audit run in docs/CHANGELOG.md and under docs/audits/; if it is not available, the orchestrator writes those entries itself. (atlas:docs-curator is the only writer of durable docs/ content when present.)

## Additional references

- [Lens set](references/lens-set.md): the three self-mode lenses (run health, asset/context audit, session forensics). Read when running `self` mode.
- [Graph-to-hub pipeline](references/graph-to-hub-pipeline.md): how Phase 4 turns graphify output into the knowledge-graph hub. Read when building the hub or debugging one that came out wrong.
- [Findings ledger schema](${CLAUDE_PLUGIN_ROOT}/references/findings-schema.md): the `.atlas/.run/findings.json` entry schema, verified stamp, and append-only intent, derived from `${CLAUDE_PLUGIN_ROOT}/scripts/atlas_finding.py`. Read when a gate or reviewer asks about ledger contents.

## Mode references

Open each when its mode reaches that step:

- `references/launch-checklist.md`: act mode: the ordered launch checklist
- `templates/launch-artifact.seed.md`: act mode: seed for the resumption artifact
