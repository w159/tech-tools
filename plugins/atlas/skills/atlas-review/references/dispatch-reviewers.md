# Dispatching Reviewers

Phase 4 of `atlas-review`. One bounded Task call per selected persona. Reviewers are generic read-only subagents — not named `atlas:*` agents — seeded with the persona asset path.

## Independence (load-bearing, state it in every dispatch)

Each reviewer receives:

- the intent paragraph,
- the immutable scope line and the diff (or its per-file slice),
- the repo-relative paths it may consult,
- its own persona asset path.

Each reviewer must NOT receive:

- any other reviewer's findings, summary, or existence,
- the synthesis or the roster rationale,
- any validator verdicts.

There is no partial sharing, no "just the titles," no cross-pollination for efficiency. Correlated reviewers find correlated things; the value of the wave is the intersection AND the disagreements. The final report preserves disagreements rather than resolving them silently.

## Dispatch prompt shape

Follow the atlas subagent-kit contract exactly. Read-only roles. Model the dispatch on this skeleton:

```
ROLE: <persona name> code reviewer, read-only
GOAL: <one sentence: review the changeset at scope <base..head> through the <persona> lens and return typed findings>
CONTEXT:
  - Intent: <the intent paragraph>
  - Scope: <base>...<head>, head <sha>, <N> files / <M> lines (immutable — late changes invalidate the review)
  - Read your persona instructions FIRST: plugins/atlas/skills/atlas-review/references/personas/<persona>.md
  - Diff: <how to obtain — e.g. "run git diff <base>...HEAD -- <your files>" or the specific paths in your lane>
  - Finding envelope: plugins/atlas/skills/atlas-review/references/findings-envelope.md (schema you must return)
  - Review run dir for your artifact: .atlas/.run/review/<run-id>/<persona>.json
TOOLS: name them explicitly (Read, Glob, Grep, Bash for git diff/log only). ToolSearch-first per project policy if MCP tools are available.
NON-INTERACTIVE: you cannot reach the user; state assumptions and return.
TOOLS ALLOWED: Read, Glob, Grep, Bash (read-only git: diff, log, show; no checkout, no mutation)
TOOLS FORBIDDEN: Write, Edit, git push/commit/checkout, Task/Agent
DELIVERABLE: (1) one JSON artifact at .atlas/.run/review/<run-id>/<persona>.json conforming to the findings envelope; (2) a compact return: reviewer name, finding count, one line per finding (id, title, severity, confidence, file:line), residual risks, testing gaps
SUCCESS CRITERIA:
  - Every finding carries severity, file:line, rationale, evidence, confidence, autofix class, owner, verification requirement
  - Any 75/100-confidence finding quotes the exact motivating line as its first evidence item
  - Suppression rules applied (style-only, pre-existing, speculative → suppressed)
  - Zero findings is a valid, complete answer
OUT OF SCOPE: proposing or applying fixes; reviewing outside the scope line; style/lint-only complaints
STOP CONDITIONS: diff unavailable at the stated base; scope line no longer matches the tree — halt and report instead of improvising
```

## Batching and concurrency

- ~4-6 in flight, spawn all of a batch in ONE message.
- Batch 1: correctness, security, adversarial (highest value, longest runtime). Batch 2: the remaining selected personas.
- If the roster is only correctness, one dispatch suffices.

## Reviewer artifact behavior

- Reviewer writes its full JSON artifact (per `findings-envelope.md`) into `.atlas/.run/review/<run-id>/<persona>.json`. Create the run dir (`mkdir -p`) before the batch.
- Its chat return is the compact merge payload only — detailed evidence lives in the artifact, keeping the orchestrator's context bounded.
- If a reviewer fails to write its artifact but returns findings in prose, the orchestrator hydrates the artifact itself from the prose before synthesis (say so in the report); a reviewer that returns neither is re-dispatched once with the same brief, then marked as no-coverage in Coverage.
- Do not run project-wide builds/tests inside reviewers. A reviewer MAY run a targeted read-only check (e.g. a single test) if its persona requires evidence, but gate-running is the validator/implementer's job.

## Determinism

Pass the same scope line, intent paragraph, and envelope path to every reviewer. The only per-reviewer variation is the persona asset and its file lane. This is what makes findings comparable at synthesis.
