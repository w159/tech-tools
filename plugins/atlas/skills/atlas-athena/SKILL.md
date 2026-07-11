---
name: atlas-athena
description: Use for a comprehensive, discovery-first code-quality and security audit of a whole codebase - correctness, OWASP/security, SOLID/DRY/KISS, risk hotspots, dead code, coverage gaps, and code-vs-docs drift. Runs as a Workflow that builds a knowledge graph (graphify), targets the hottest nodes, fans out one reviewer per dimension, and adversarially verifies every finding before it counts.
when_to_use: a comprehensive, discovery-first code-quality and security audit of a whole codebase - correctness, OWASP/security, SOLID/DRY/KISS, risk hotspots, dead code, coverage gaps, and code-vs-docs drift. Runs as a Workflow that builds a knowledge graph (graphify), targets the hottest nodes, fans out one reviewer per dimension, and adversarially verifies every finding before it counts
---


# atlas-athena

Discovery-first, comprehensive audit swarm. You supply no arguments. The survey builds a knowledge graph of the codebase, aims every dimension reviewer at the hottest nodes that graph surfaces, verifies every finding adversarially, and delivers a prioritized, file:line-anchored report under .atlas/docs/audits/atlas-athena-<date>/.

**Elicitation:** before building the graph, if the user's ask did not fix the tier, ask ONE AskUserQuestion: audit depth - comprehensive sweep (recommended for "audit this"), hotspot-only quick pass, or a named-dimension focus (security/OWASP only, correctness only). Depth changes swarm size and wall-clock materially, so it is the user's call; which files are hot is discovery's call, never a question.

## Zero-arg discovery

The user invokes this skill with no arguments. Phase 1 first discovers the codebase roots (a single-package repo yields one root; a monorepo yields one per package - MCP server, node lib, plugin), then runs the `graphify` skill **scoped per root** to build the codebase knowledge graph: community structure, god nodes (high in-degree, high coupling), and high-centrality hot spots (bridges between modules). Scoping per root keeps each graphify run under its size gate so the build never stalls on a whole-monorepo scope. In parallel, the orchestrator reads .atlas/docs/ as the SSOT for intended behavior - these docs become the baseline against which code-vs-docs drift is measured.

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

Structural and architectural duplication - parallel subsystems across features doing the same structural job - is out of scope for this dimension list. That work belongs to `atlas-ariadne`. See the Boundary section.

## Adversarial verify

Every finding from every dimension reviewer is confirmed by an independent `atlas:verifier` before it counts (engine law 5). The verifier re-opens the cited lines, re-runs any relevant check, and returns a verdict of "verified" or "rejected" with evidence.

Refuted findings are dropped entirely. They do not appear in the output, not even as "low confidence." The orchestrator never patches a rejected finding - it discards it and moves on. Only verified findings make it into the final report.

The pipeline() shape means verification starts as soon as the first dimension completes, rather than waiting for all seven reviewers to finish. A dimension's findings flow directly into its verifier wave.

## Boundary

atlas-athena owns:

- Correctness and bug findings (logic, data flow, error handling).
- Security vulnerabilities and OWASP findings.
- SOLID/DRY/KISS violations and best-practice gaps.
- Risk hotspot identification (churn + coupling + coverage density).
- Dead code.
- Test-coverage gaps.
- Code-vs-docs drift (docs/ vs. live behavior).
- Local code-smell duplication: repeated logic within a single module or tightly coupled files that share a change rate.

atlas-athena does NOT own structural or architectural duplication. That means: parallel subsystems across features doing the same structural job (two auth middlewares, two independent retry loops, two identical pipeline stages in separate features). That belongs to `atlas-ariadne`.

The boundary is symmetric by design. If a survey dimension reviewer surfaces a structural duplication finding (same pattern appearing in two separate features), the reviewer notes it as out-of-scope and excludes it from its structured return. The orchestrator writes a single line to the output referencing atlas-ariadne for that class of finding. The two skills never re-audit the same concern.

## Output

All artifacts land under .atlas/docs/audits/atlas-athena-<date>/ as the single source of truth. No loose files in the repo root. Every findings file and report.md use the same severity scale: HIGH / MED / LOW.

```
.atlas/docs/audits/atlas-athena-<date>/
  graph-summary.md          - merged hot spots and communities surfaced by graphify across all roots (file:line)
                              (per-root graphs live in each root's own graphify-out/, not under this audit dir)
  findings/
    correctness.md          - verified correctness/bug findings (file:line + severity)
    security.md             - verified OWASP/security findings (file:line + severity)
    quality.md              - verified SOLID/DRY/KISS findings (file:line + severity)
    risk-hotspots.md        - verified risk hotspot findings (file:line + severity)
    dead-code.md            - verified dead code findings (file:line)
    coverage-gaps.md        - verified test-coverage gap findings (file:line)
    docs-drift.md           - verified code-vs-docs drift findings (file:line)
  report.md                 - prioritized master list: all verified findings, severity HIGH/MED/LOW
  handoffs/
    <finding-id>.md         - one handoff prompt per accepted finding (ends with `atlas-launch <finding-id>`)
  hub/
    manifest.json           - node<->finding bridge (each handoff mapped to its graphify node)
    index.html              - branded Atlas expedition map; click a node -> finding + atlas-launch cmd
```

Each finding in report.md carries: dimension, severity (HIGH / MED / LOW), file:line, a one-sentence description of the flaw, and the verifier's evidence. Rejected findings are not mentioned.

The orchestrator writes handoff prompts only for findings the user accepts for remediation. Each `<finding-id>` used as a filename must be a filesystem-safe slug: lowercase, with every character outside `a-z 0-9 . _ -` (notably the Windows-reserved set `< > : " / \ | ? *`, plus spaces) replaced by `-`. A colon in any audit filename makes the repo un-checkout-able on Windows and blocks everyone syncing it. Each handoff is self-contained: it names the file:line, states the flaw and acceptance criterion, specifies which atlas squad agent should lead the fix, and ends with `Remediate with: atlas-launch <finding-id>`. After writing handoffs/, the orchestrator builds the hub so findings are navigable and one-command launchable:

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/build_hub.py" ".atlas/docs/audits/atlas-athena-<date>" <each per-root graphify-out/graph.json>
```

`atlas-launch <finding-id>` then loads that handoff into the `atlas-metis` skill to remediate it. (`atlas-launch` is the remediation launcher; `atlas-handoff` is the separate session-resume checkpoint.)

## Workflow shape

This skill runs as a Workflow following the skeleton in atlas-metis/references/workflow-template.md. The shape is a pipeline from graph through per-dimension review through per-finding verify, with verification starting as each dimension completes - no barrier between dimensions.

### Phase 1 - Graph and docs baseline (sequential, orchestrator-gated)

The orchestrator first discovers the codebase roots dynamically - a discovery pass (an
`atlas:explorer` over the tree plus graphify's own `detect()` for a minimal-context read of where
the real packages are), not a static or config-supplied list. A single-package repo resolves to
one root; this monorepo resolves to one root per MCP server / node lib / plugin. The orchestrator
then runs the `graphify` skill **scoped per discovered root** (with `GRAPHIFY_NONINTERACTIVE=1` set
so a root that still trips the size gate auto-scopes instead of blocking), writing a `graphify-out/`
under each root. It merges each root's hot-spot nodes into a single top-N list and reads .atlas/docs/ for
the intended-behavior baseline. This phase completes before any dimension fans out. The orchestrator
records the merged top-N hot spot nodes (file:line) and the docs baseline to disk before dispatching
Phase 2.

### Phase 2 - Dimension review (pipeline)

Seven dimension reviewers dispatched via pipeline(). Each reviewer receives the hot-spot list and the docs baseline. Reviewers start at the hottest nodes and widen from there. Each reviewer returns structured findings: { dimension, findings: [ { file, line, severity, description } ] }.

The correctness reviewer works independently. The security reviewer composes `security-review` and `codeql`. The quality reviewer composes `quality-playbook`. Structural-duplication findings encountered by any reviewer are noted as out-of-scope and excluded from the return.

### Phase 3 - Adversarial verify (pipeline, per finding)

As each dimension reviewer completes, its findings flow into a per-finding verify wave. One `atlas:verifier` per finding, dispatched via pipeline(). Each verifier re-opens the cited lines, re-runs the relevant check, and returns "verified" or "rejected" with evidence. Rejected findings are discarded immediately. The orchestrator never waits for all seven dimensions before starting verification.

### Phase 4 - Synthesize and output (orchestrator only)

The orchestrator collects all verified findings, assigns final severity ordering (HIGH first), writes report.md, and generates handoff prompts for accepted findings. Synthesis is never delegated. If atlas:docs-curator is available, the orchestrator dispatches it to record the audit run in .atlas/docs/CHANGELOG.md and under .atlas/docs/audits/; if it is not available, the orchestrator writes those entries itself. (atlas:docs-curator is the only writer of durable docs/ content when present.)
