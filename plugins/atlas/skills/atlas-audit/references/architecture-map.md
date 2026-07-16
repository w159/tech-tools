# Architecture mapping (atlas-audit mode)

Discovery-first codebase mapper. You supply no arguments. The cartographer reads the repo, proposes its own feature boundaries, maps each feature as a Mermaid flowchart with every node labeled file:line, finds structural duplication across features, and proposes the simplest unified architecture. Everything lands in docs/audits/atlas-audit-<date>/.

**Elicitation:** zero-arg means zero *required* input, not zero dialogue. If discovery finds more than one plausible codebase root (monorepo with several apps, nested projects), ask ONE AskUserQuestion - which root(s) to map (multiSelect, "all of them" as an option) - before fanning out. Everything else (features, boundaries, hotspots) is discovered, never asked.

## Zero-arg discovery

The user invokes this skill with no arguments. The orchestrator dispatches a single atlas:explorer to survey the source tree, README, and CLAUDE.md, then returns a proposed feature boundary list. The orchestrator reviews that list - merging, splitting, or renaming boundaries as needed - before any fan-out begins. Nothing proceeds until the orchestrator approves the boundary map.

The explorer's survey prompt:

> You are atlas:explorer. Read the repo's source tree, README, and CLAUDE.md. Propose a feature boundary list: each entry is a short name and the top-level directories or entry-point files that belong to it. Return JSON: { "features": [ { "name": "...", "roots": ["file:line", ...], "rationale": "..." } ] }. No file dumps. Every root cites file:line.

The orchestrator may accept as-is, merge closely related boundaries, or split a boundary that mixes two unrelated concerns. It logs its boundary decision before Phase 1 starts.

## Workflow shape

This skill runs as a Workflow following the skeleton in atlas-orchestrate/references/workflow-template.md. The four phases are:

### Phase 0 - Boundary discovery (sequential, orchestrator-gated)

One atlas:explorer surveys the source tree and proposes feature boundaries. atlas:planner then decomposes the explorer's raw boundary proposal into the approved feature list, merging, splitting, or renaming entries as needed to produce a clean, non-overlapping set. The orchestrator reviews and finalizes that list before any fan-out begins. This is the only sequential gate; all subsequent phases fan out.

The orchestrator writes the approved boundary list to docs/audits/atlas-audit-<date>/boundaries.md before dispatching Phase 1.

### Phase 1 - Per-feature flowchart (parallel)

One atlas:explorer per approved feature, dispatched with parallel(). Each explorer returns a Mermaid flowchart where every node is labeled file:line. No node may be left without a file:line label - the orchestrator rejects and redeploys any explorer whose chart contains unlabeled nodes.

Explorer prompt template:

> You are atlas:explorer. Map the "{feature}" feature. Return a Mermaid flowchart (graph TD) covering every significant entry point, branch, and data flow. Label EVERY node with its file:line. Do not describe code; chart it. Return: { "feature": "...", "chart": "graph TD\n..." }

The orchestrator collects all charts and writes them to docs/audits/atlas-audit-<date>/charts/<feature>.md. The `<feature>` filename must be a filesystem-safe slug (see "Filename safety" below) - never write a raw feature name containing a colon, slash, or space into a path.

### Phase 2 - Duplication hunting (parallel)

Two atlas:verifier agents dispatched concurrently. Duplication hunting is adversarial verification: each hunter compares two code paths and confirms whether they are structurally the same. atlas:verifier is the right agent for this work.

- Within-feature hunter: finds repeated subgraph patterns inside a single feature (same data flow, same transformation, same validation logic at two file:line locations within one feature).
- Cross-feature hunter: finds parallel subsystems across features that do the same structural job (two features each owning their own auth middleware, two independent retry loops, two separate error-boundary wrappers at distinct file:line locations).

Each atlas:verifier hunter returns JSON: { "duplications": [ { "label": "...", "locations": ["file:line", "file:line", ...], "similarity": "..." } ] }. atlas:verifier enforces the evidence rule: any duplication claim that does not cite at least two file:line locations is invalid. The hunter discards it and does not return it.

The orchestrator writes the merged duplication list to docs/audits/atlas-audit-<date>/duplications.md.

### Phase 3 - Unified proposal (orchestrator only)

The orchestrator synthesizes the feature charts and duplication list into a single unified architecture proposal. This phase is never delegated. The orchestrator may ask atlas:planner to draft the unification sequencing plan (the order in which duplicated subsystems should be collapsed), then use that draft as input when writing the final proposal. The orchestrator:

1. Identifies which duplicated subsystems can be collapsed into one canonical location.
2. Names the canonical location with a file:line target (existing or proposed new path).
3. Describes the minimal change each feature needs to adopt the shared path.
4. Lists any duplication that is intentional (different domains, different change rates) and should NOT be merged.

The proposal is written to docs/audits/atlas-audit-<date>/proposal.md.

### Phase 4 - Handoff prompts + hub (orchestrator only)

For each system the proposal targets for unification, the orchestrator writes a handoff prompt to docs/audits/atlas-audit-<date>/handoffs/<system>.md. The `<system>` filename must be a filesystem-safe slug (see "Filename safety" below); the human-readable system name still appears inside the file. Each prompt is self-contained: it names the target, cites file:line evidence from the duplication report, states the acceptance criterion, specifies which atlas squad agent should lead the work, and ends with the launch line `Remediate with: atlas-launch <system>`.

Then build the knowledge-graph hub so the findings are navigable and launchable:

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/build_hub.py" "docs/audits/atlas-audit-<date>" <each per-root graphify-out/graph.json>
```

The pipeline, the `manifest.json` schema, and the file-granular matching rule
are documented in `references/graph-to-hub-pipeline.md`. Read it before the
first hub run and when a hub comes out with `node_match: "none"` on every
entry.

This writes `hub/manifest.json` (each handoff mapped to its graphify node, file-granular) and a branded `hub/index.html`. Each charted system is then remediated in one step with `atlas-launch <system>`, which loads its handoff into the `atlas-orchestrate` skill. Do not write /make-plan handoffs - these are atlas-native Workflows launched via `atlas-launch`. (`atlas-launch` is the remediation launcher; `atlas-handoff` is the separate session-resume checkpoint.)

## Evidence contract

Every node in every Phase 1 flowchart must carry a file:line label. Every claim in the Phase 2 duplication report must cite at least two file:line locations. The orchestrator enforces this before accepting any subagent result.

Rejection protocol: if an atlas:explorer returns a chart with any unlabeled node, or a duplication report with a claim citing fewer than two file:line locations, the orchestrator logs "REJECTED: missing file:line evidence" and redeploys that agent with the same prompt plus an explicit reminder: "Every node requires file:line. Every duplication claim requires >=2 file:line citations. Return nothing without evidence."

The orchestrator never patches evidence gaps itself. It only accepts or rejects.

## Filename safety

Every artifact this skill writes (`charts/<feature>.md`, `handoffs/<system>.md`, and any other named file) must have a filesystem-safe name, or the audit cannot be checked out on Windows and blocks anyone syncing the repo. A colon is the most common offender: `charts/frontend:public-site-and-auth.md` is rejected by Git on Windows with `error: invalid path`, which stops the whole checkout, not just that one file.

Before writing any file, convert the feature or system name into a slug:

1. Lowercase it.
2. Replace every character that is not `a-z`, `0-9`, `.`, `_`, or `-` with a single `-`. This removes the Windows-reserved set `< > : " / \ | ? *`, plus spaces and control characters. A `layer:feature` name like `frontend:public-site-and-auth` becomes `frontend-public-site-and-auth`.
3. Collapse any run of `-` into one, and strip leading and trailing `-` and `.`.
4. If the result is empty or matches a Windows reserved device name (`con`, `prn`, `aux`, `nul`, `com1`-`com9`, `lpt1`-`lpt9`, case-insensitive), prefix it with `feature-` or `system-`.

The slug is the filename only. The original human-readable name still appears as the heading inside the file, so no information is lost. Two different names that collapse to the same slug get a numeric suffix (`-2`, `-3`) so no file is silently overwritten.

## Boundary

atlas-audit owns:

- Feature boundary mapping (the shape of the codebase, not its quality).
- Architectural duplication: parallel subsystems doing the same structural job (two auth middlewares, two retry loops, two identical pipeline stages in separate features).
- Unified architecture proposals: the simplest structural change that collapses the duplication.

atlas-audit does NOT own:

- Code quality findings (dead code, naming issues, complexity).
- Security vulnerabilities or OWASP findings.
- Local code smells within a single file.
- Test coverage gaps.

Those belong to atlas-audit. If the cartographer's explorer surfaces a quality or security finding while mapping, the explorer notes it as out-of-scope and discards it from its structured return. The orchestrator does not include quality or security items in the proposal.

## Output

All artifacts land under docs/audits/atlas-audit-<date>/ as the single source of truth. No loose files in the repo root.

```
docs/audits/atlas-audit-<date>/
  boundaries.md          - approved feature boundary list with file:line roots
  charts/
    <feature-slug>.md    - Mermaid flowchart, one per feature, all nodes labeled file:line (name slugged; no colons/spaces)
  duplications.md        - merged within-feature and cross-feature duplication report
  proposal.md            - unified architecture proposal with file:line evidence
  handoffs/
    <system-slug>.md     - one handoff prompt per targeted system (name slugged; ends with `atlas-launch <system>`)
  hub/
    manifest.json        - node<->finding bridge (each handoff mapped to its graphify node)
    index.html           - branded Atlas expedition map; click a node -> finding + atlas-launch cmd
```

The orchestrator writes a short index entry to docs/audits/atlas-audit-<date>/index.md listing the run date, feature count, duplication count, and proposal summary (one sentence per merged subsystem).

## Anti-patterns to reject in the proposal

The orchestrator must not propose any of the following. If the first synthesis draft contains one, revise before writing proposal.md.

- New abstraction layer added for flexibility. Every proposed unification must eliminate existing code, not add a new wrapper around it. "Introduce a BaseHandler that both features can extend" is rejected. "Move the shared logic to feature-a/shared/retry.ts:14 and delete the copy in feature-b" is accepted.

- Both paths kept behind a flag. "Add a USE_NEW_RETRY env flag to switch between the two implementations" is rejected. The proposal must commit to one path and remove the other.

- Registry or factory where a switch suffices. "Add a HandlerFactory that dispatches to the right implementation based on context" is rejected when a direct call or a two-branch switch covers all current callers. Introduce a registry only when the number of implementations is open-ended and currently exceeds three.
