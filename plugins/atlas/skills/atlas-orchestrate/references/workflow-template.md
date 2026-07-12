# Workflow template - atlas squad skeleton

A Workflow script is a plain JavaScript (not TypeScript) file. The engine authors it;
the Workflow tool executes it. Copy this skeleton, fill in the phase titles and agent
prompts, delete the shapes you do not need.

## Rules before you start

- The `meta` block must be a PURE object literal - no variables, no template literals,
  no function calls, no Date.now(), no Math.random(), no new Date(). Static strings only.
- Synthesis stays with the orchestrator. Subagents return distilled reports; the
  orchestrator integrates them and decides the next move.
- `pipeline()` is the DEFAULT for multi-stage work. It streams items through stages with
  no barrier between them (each item completes all stages before the next item starts a
  stage). Use `parallel()` when you need a hard BARRIER - all thunks must settle before
  the script continues, and failures become null (filter them).
- Concurrency is auto-capped at ~4-6 in flight. You do not need to throttle manually.
- `schema` (a JSON Schema object) on an `agent()` call validates the return and gives you
  a typed object instead of raw text. Use it whenever the orchestrator will compute with
  the result.

---

## Full skeleton (explore -> plan -> implement -> verify)

```js
export const meta = {
  name: "atlas-feature-workflow",
  description: "Explore, plan, implement, and verify a bounded feature change.",
  phases: [
    { title: "Explore",   detail: "Map the affected surface; locate owners and entry points." },
    { title: "Plan",      detail: "Decompose into numbered stages; flag concurrent candidates." },
    { title: "Implement", detail: "Apply one bounded change per implementer; no scope creep." },
    { title: "Verify",    detail: "Independent adversarial check; reproduce the original failing case." }
  ]
};

// ---------- Phase 1: explore ----------
phase("Explore");

const exploration = await agent(
  `You are atlas:explorer. Map the files and symbols involved in <DESCRIBE THE FEATURE/BUG>.
   Return a compact structural map: file:line for each relevant symbol, call graph edges,
   and the layer that owns each entry point (frontend / backend / db / config).
   No file dumps. Cite every claim with file:line. Mark gaps [unverified].`,
  {
    label: "explore",
    model: "haiku",
    schema: {
      type: "object",
      required: ["symbols", "layers", "gaps"],
      properties: {
        symbols: { type: "array", items: { type: "string" } },
        layers:  { type: "object" },
        gaps:    { type: "array", items: { type: "string" } }
      }
    }
  }
);

log(`Exploration done. Symbols found: ${exploration.symbols.length}. Gaps: ${exploration.gaps.length}`);

// ---------- Phase 2: plan ----------
phase("Plan");

const plan = await agent(
  `You are atlas:planner. Given this structural map:
   ${JSON.stringify(exploration)}

   Produce a numbered stage map for <DESCRIBE THE GOAL>. Each stage must have:
   - exactly one verifiable artifact
   - a named failable check (the exact condition that would make it fail)
   - the agent type and model tier
   Mark stages that can run concurrently. Mark any output that cannot be verified [unverified].`,
  { label: "plan", model: "opus" }
);

log("Stage map produced.");

// ---------- Phase 3: implement (parallel where stages are independent) ----------
phase("Implement");

// Example: two independent surfaces implemented concurrently.
// Add isolation: "worktree" if the stages may edit the same files.
const implementations = await parallel([
  () => agent(
    `You are atlas:implementer. Implement stage 1: <DESCRIBE STAGE 1 GOAL AND ACCEPTANCE CRITERIA>.
     Pull Context7 docs for any library you touch. Return: files changed (file:line),
     the gate command you ran, and its output. One bounded change only.`,
    { label: "impl-stage-1", model: "sonnet", isolation: "worktree" }
  ),
  () => agent(
    `You are atlas:implementer. Implement stage 2: <DESCRIBE STAGE 2 GOAL AND ACCEPTANCE CRITERIA>.
     Pull Context7 docs for any library you touch. Return: files changed (file:line),
     the gate command you ran, and its output. One bounded change only.`,
    { label: "impl-stage-2", model: "sonnet", isolation: "worktree" }
  )
]);

// Filter null (failed) results before proceeding.
const shipped = implementations.filter(Boolean);
log(`Implementation complete. ${shipped.length} of ${implementations.length} stages succeeded.`);

if (shipped.length < implementations.length) {
  log("WARNING: one or more implementation stages failed - inspect before verifying.");
}

// ---------- Phase 4: verify (one verifier per shipped stage) ----------
phase("Verify");

const verifications = await parallel(
  shipped.map((impl, i) => () => agent(
    `You are atlas:verifier. Independently verify this change.
     Original symptom (verbatim from user): <PASTE USER'S ORIGINAL SYMPTOM HERE>.
     Implementation report: ${JSON.stringify(impl)}.
     Do NOT confirm it is correct - derive your own check from the symptom,
     reproduce the originally-failing case, and observe the result.
     Return verdict: "verified" or "rejected", the check you ran, and evidence (file:line or command output).`,
    { label: `verify-stage-${i + 1}`, model: "opus" }
  ))
);

const rejected = verifications.filter(v => v && v.includes("rejected"));
if (rejected.length > 0) {
  log(`GATE FAILED: ${rejected.length} stage(s) rejected. Do not proceed.`);
} else {
  log("All stages verified. Dispatch atlas:docs-curator to reconcile .atlas/docs/.");
}
```

---

## Shape: pipeline (the default for multi-stage per-item work)

Each item flows through every stage independently, with NO barrier between stages -
item A can be in verify while item B is still in review. Reach for this (not parallel)
whenever you have a list of items each needing the same sequence of steps.

    const results = await pipeline(
      files,
      (f) => agent(`review ${f} for bugs`, { label: `review:${f}`, schema: FINDINGS }),
      (review) => agent(`fix the confirmed findings: ${JSON.stringify(review)}`,
                        { label: `fix:${review.file}`, model: "sonnet" }),
    )

Use parallel() instead only when a stage genuinely needs ALL prior results at once
(dedup, early-exit on zero, cross-item comparison).

---

## Shape: loop-until-dry

Use this when you need to drain a queue and stop when it is empty. Replace the `while`
condition with the real sentinel your workflow checks.

```js
export const meta = {
  name: "atlas-drain-queue",
  description: "Process items from a queue until it is empty.",
  phases: [
    { title: "Drain", detail: "Process each batch until the queue is empty." }
  ]
};

phase("Drain");

let remaining = true;
let wave = 0;

while (remaining) {
  wave += 1;
  log(`Wave ${wave}: fetching next batch.`);

  const batch = await agent(
    `Fetch the next batch of items from <QUEUE SOURCE>. Return the items as a JSON array,
     or an empty array if the queue is drained.`,
    {
      label: `fetch-wave-${wave}`,
      schema: { type: "array", items: { type: "object" } }
    }
  );

  if (!batch || batch.length === 0) {
    remaining = false;
    log("Queue drained.");
    break;
  }

  // Process the batch concurrently, capped automatically.
  const results = await parallel(
    batch.map(item => () => agent(
      `Process this item: ${JSON.stringify(item)}. Return a one-line result summary.`,
      { label: `process-item-${item.id}`, model: "sonnet" }
    ))
  );

  log(`Wave ${wave} complete. Processed: ${results.filter(Boolean).length} / ${batch.length}.`);
}
```

---

## Shape: adversarial-verify wave

Use this to close a multi-implementer wave with one independent verifier per shipped
change before any downstream stage runs.

```js
// After a parallel() implementation wave:
const verifyWave = await parallel(
  shippedChanges.map((change, i) => () => agent(
    `You are atlas:verifier. Your ONLY job is to refute or confirm this change.
     Original user symptom (verbatim): <SYMPTOM>.
     Change report: ${JSON.stringify(change)}.
     Steps:
     1. Re-open the cited files at the cited lines.
     2. Reproduce the originally-failing case with real execution.
     3. Observe the result - do NOT accept "it should work."
     Return: verdict ("verified" | "rejected"), evidence (file:line or command + output),
     and the check you ran. If you cannot run the check, return "rejected: unrunnable."`,
    { label: `adversarial-verify-${i}`, model: "opus" }
  ))
);

const blocked = verifyWave.filter(v => v && v.startsWith("rejected"));
if (blocked.length > 0) {
  log(`BLOCKED: ${blocked.length} change(s) rejected by adversarial verify. Fix before continuing.`);
}
```

---

## pipeline() vs parallel() - when to use which

| Need | Use |
|---|---|
| Each item through multiple sequential stages, stream as they complete | `pipeline(items, stage1, stage2, ...)` |
| All tasks must complete before the script continues (barrier) | `parallel(thunks)` |
| Single agent call, structured return | `agent(prompt, { schema })` |

`pipeline` streams work through stages with no barrier - the second stage for item 1
starts as soon as item 1 finishes stage 1, without waiting for item 2 to finish stage 1.
This is the right default for large fan-out (e.g., process 20 files through explore +
fix + verify). Use `parallel` only when you genuinely need a synchronization point.

---

## Key rule

Synthesis stays with the orchestrator. Subagents return distilled reports only -
file:line citations, verdict strings, and short structured summaries. The orchestrator
integrates them, makes decisions, and narrates progress via `log()`. A subagent that
returns raw source or tries to synthesize across multiple changes has overstepped.
