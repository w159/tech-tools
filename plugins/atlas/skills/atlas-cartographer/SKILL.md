---
name: atlas-cartographer
description: Use to map a codebase into feature-grouped flowcharts, find architectural duplication across features, and propose the simplest unified architecture - discovery-first and zero-arg. Runs as a Workflow that fans out one explorer per feature, hunts duplication, and synthesizes a unification proposal with file:line evidence. Use before a refactor, to "find the ideal path," or to unify duplicated systems.
---

# atlas-cartographer

Discovery-first codebase mapper. You supply no arguments. The cartographer reads the repo, proposes its own feature boundaries, maps each feature as a Mermaid flowchart with every node labeled file:line, finds structural duplication across features, and proposes the simplest unified architecture. Everything lands in docs/audits/atlas-cartographer-<date>/.

## Zero-arg discovery

The user invokes this skill with no arguments. The orchestrator dispatches a single atlas:explorer to survey the source tree, README, and CLAUDE.md, then returns a proposed feature boundary list. The orchestrator reviews that list - merging, splitting, or renaming boundaries as needed - before any fan-out begins. Nothing proceeds until the orchestrator approves the boundary map.

The explorer's survey prompt:

> You are atlas:explorer. Read the repo's source tree, README, and CLAUDE.md. Propose a feature boundary list: each entry is a short name and the top-level directories or entry-point files that belong to it. Return JSON: { "features": [ { "name": "...", "roots": ["file:line", ...], "rationale": "..." } ] }. No file dumps. Every root cites file:line.

The orchestrator may accept as-is, merge closely related boundaries, or split a boundary that mixes two unrelated concerns. It logs its boundary decision before Phase 1 starts.

## Workflow shape

This skill runs as a Workflow following the skeleton in atlas-engine/references/workflow-template.md. The four phases are:

### Phase 0 - Boundary discovery (sequential, orchestrator-gated)

One atlas:explorer surveys the source tree and proposes feature boundaries. atlas:planner then decomposes the explorer's raw boundary proposal into the approved feature list, merging, splitting, or renaming entries as needed to produce a clean, non-overlapping set. The orchestrator reviews and finalizes that list before any fan-out begins. This is the only sequential gate; all subsequent phases fan out.

The orchestrator writes the approved boundary list to docs/audits/atlas-cartographer-<date>/boundaries.md before dispatching Phase 1.

### Phase 1 - Per-feature flowchart (parallel)

One atlas:explorer per approved feature, dispatched with parallel(). Each explorer returns a Mermaid flowchart where every node is labeled file:line. No node may be left without a file:line label - the orchestrator rejects and redeploys any explorer whose chart contains unlabeled nodes.

Explorer prompt template:

> You are atlas:explorer. Map the "{feature}" feature. Return a Mermaid flowchart (graph TD) covering every significant entry point, branch, and data flow. Label EVERY node with its file:line. Do not describe code; chart it. Return: { "feature": "...", "chart": "graph TD\n..." }

The orchestrator collects all charts and writes them to docs/audits/atlas-cartographer-<date>/charts/<feature>.md.

### Phase 2 - Duplication hunting (parallel)

Two atlas:verifier agents dispatched concurrently. Duplication hunting is adversarial verification: each hunter compares two code paths and confirms whether they are structurally the same. atlas:verifier is the right agent for this work.

- Within-feature hunter: finds repeated subgraph patterns inside a single feature (same data flow, same transformation, same validation logic at two file:line locations within one feature).
- Cross-feature hunter: finds parallel subsystems across features that do the same structural job (two features each owning their own auth middleware, two independent retry loops, two separate error-boundary wrappers at distinct file:line locations).

Each atlas:verifier hunter returns JSON: { "duplications": [ { "label": "...", "locations": ["file:line", "file:line", ...], "similarity": "..." } ] }. atlas:verifier enforces the evidence rule: any duplication claim that does not cite at least two file:line locations is invalid. The hunter discards it and does not return it.

The orchestrator writes the merged duplication list to docs/audits/atlas-cartographer-<date>/duplications.md.

### Phase 3 - Unified proposal (orchestrator only)

The orchestrator synthesizes the feature charts and duplication list into a single unified architecture proposal. This phase is never delegated. The orchestrator may ask atlas:planner to draft the unification sequencing plan (the order in which duplicated subsystems should be collapsed), then use that draft as input when writing the final proposal. The orchestrator:

1. Identifies which duplicated subsystems can be collapsed into one canonical location.
2. Names the canonical location with a file:line target (existing or proposed new path).
3. Describes the minimal change each feature needs to adopt the shared path.
4. Lists any duplication that is intentional (different domains, different change rates) and should NOT be merged.

The proposal is written to docs/audits/atlas-cartographer-<date>/proposal.md.

### Phase 4 - Handoff prompts (orchestrator only)

For each system the proposal targets for unification, the orchestrator writes a /atlas-engine handoff prompt to docs/audits/atlas-cartographer-<date>/handoffs/<system>.md. Each prompt is self-contained: it names the target, cites file:line evidence from the duplication report, states the acceptance criterion, and specifies which atlas squad agent should lead the work.

Do not write /make-plan handoffs. These are atlas-native Workflows - hand off to /atlas-engine.

## Evidence contract

Every node in every Phase 1 flowchart must carry a file:line label. Every claim in the Phase 2 duplication report must cite at least two file:line locations. The orchestrator enforces this before accepting any subagent result.

Rejection protocol: if an atlas:explorer returns a chart with any unlabeled node, or a duplication report with a claim citing fewer than two file:line locations, the orchestrator logs "REJECTED: missing file:line evidence" and redeploys that agent with the same prompt plus an explicit reminder: "Every node requires file:line. Every duplication claim requires >=2 file:line citations. Return nothing without evidence."

The orchestrator never patches evidence gaps itself. It only accepts or rejects.

## Boundary

atlas-cartographer owns:

- Feature boundary mapping (the shape of the codebase, not its quality).
- Architectural duplication: parallel subsystems doing the same structural job (two auth middlewares, two retry loops, two identical pipeline stages in separate features).
- Unified architecture proposals: the simplest structural change that collapses the duplication.

atlas-cartographer does NOT own:

- Code quality findings (dead code, naming issues, complexity).
- Security vulnerabilities or OWASP findings.
- Local code smells within a single file.
- Test coverage gaps.

Those belong to atlas-survey. If the cartographer's explorer surfaces a quality or security finding while mapping, the explorer notes it as out-of-scope and discards it from its structured return. The orchestrator does not include quality or security items in the proposal.

## Output

All artifacts land under docs/audits/atlas-cartographer-<date>/ as the single source of truth. No loose files in the repo root.

```
docs/audits/atlas-cartographer-<date>/
  boundaries.md          - approved feature boundary list with file:line roots
  charts/
    <feature>.md         - Mermaid flowchart, one per feature, all nodes labeled file:line
  duplications.md        - merged within-feature and cross-feature duplication report
  proposal.md            - unified architecture proposal with file:line evidence
  handoffs/
    <system>.md          - one /atlas-engine handoff prompt per targeted system
```

The orchestrator writes a short index entry to docs/audits/atlas-cartographer-<date>/index.md listing the run date, feature count, duplication count, and proposal summary (one sentence per merged subsystem).

## Anti-patterns to reject in the proposal

The orchestrator must not propose any of the following. If the first synthesis draft contains one, revise before writing proposal.md.

- New abstraction layer added for flexibility. Every proposed unification must eliminate existing code, not add a new wrapper around it. "Introduce a BaseHandler that both features can extend" is rejected. "Move the shared logic to feature-a/shared/retry.ts:14 and delete the copy in feature-b" is accepted.

- Both paths kept behind a flag. "Add a USE_NEW_RETRY env flag to switch between the two implementations" is rejected. The proposal must commit to one path and remove the other.

- Registry or factory where a switch suffices. "Add a HandlerFactory that dispatches to the right implementation based on context" is rejected when a direct call or a two-branch switch covers all current callers. Introduce a registry only when the number of implementations is open-ended and currently exceeds three.
