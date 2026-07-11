---
id: loop-until-dry
name: Loop until dry
category: discovery
cadence: self-paced
inputs:
  - search_space: what to probe (a codebase area, a log range, an API surface, a set of inputs)
  - probe_command: the command or query that returns findings for one pass
  - dry_definition: what "nothing new" means (zero new hits, an empty diff against the last pass)
  - cap: max iterations before stopping and reporting regardless
---

# loop-until-dry

Keep running the same probe until it stops finding anything new. The classic discovery loop: each pass narrows or expands the search, you record what is new, and you stop when a pass adds nothing. Self-paced because the model decides whether the last pass was productive before going again.

## Steps

1. **Seed.** Define `search_space` and the `probe_command` that surfaces findings for one pass. Record a baseline set (could be empty).
2. **Probe.** Run one pass. Collect findings. Send any large output through `context-mode` so raw bytes stay out of context.
3. **Diff.** Compare this pass against the running set. Anything new gets appended with its evidence (`file:line`, a row, a URL).
4. **Decide (self-pace).** If this pass added something new and you are under `cap`, refine the probe (widen the net, follow a new lead) and go to step 2. If it added nothing new, or you hit `cap`, stop. Before declaring the loop dry, dispatch `atlas:verifier` in a fresh context to re-run the probe independently per atlas-metis law 5 and confirm the pass truly returned no new findings, rather than self-attesting that the search is exhausted.
5. **Report.** Emit the full deduplicated finding set with evidence and state the dry condition that ended the loop.

## Stop condition

A pass returns no new findings (`dry_definition` met), or iteration count reaches `cap`.

## Template (self-paced /loop)

```
/loop Probe <search_space> with: <probe_command>. Append only findings not already in the running set, each with file:line or equivalent evidence. If this pass added something new and we are under <cap> passes, refine the probe and continue; if it added nothing new, stop and print the full deduplicated set plus the dry condition that ended the loop.
```

Omit the interval so the model self-paces between passes. Read-only by default - if a probe writes, gate before the first mutating pass.
