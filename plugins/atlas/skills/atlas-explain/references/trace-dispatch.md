# Explorer Trace Dispatch

The exact dispatch spec for grounding an `atlas-explain` answer. Compose per `plugins/atlas/skills/atlas-orchestrate/references/subagent-kit.md` - the tripwire denies a dispatch missing any of the five required blocks, so use this shape verbatim, filling the slots.

Before dispatch, replace each placeholder line with the matching block from the "Shared TOOLS and NON-INTERACTIVE blocks (inlined at dispatch)" section of `${CLAUDE_PLUGIN_ROOT}/skills/atlas-orchestrate/references/subagent-kit.md`; a prompt that still contains a placeholder is malformed. Drop the `Edits:` line (read-only role).

Read-only role: the explorer must not write anything. Its final message is the only thing this skill reads, so the SCHEMA below is load-bearing.

## Dispatch template

```
ROLE: atlas:explorer - read-only behavior trace for an evidence-backed explanation
GOAL: Trace how <one behavior, e.g. "the retry queue drains failed jobs after a worker crash"> actually works in this repo and return the path with file:line evidence.
CONTEXT: <only what it cannot derive itself: entry-point paths or symbols from the request, the triggering condition the user asked about, any prior finding id or doc path that constrains the answer>
{{TOOLS_BLOCK}}
  (no Write/Edit tools - read-only role)
{{NON_INTERACTIVE}}
DISCOVER FIRST: confirm the best-fit capability for this exact job, check live skills/MCP/LSP.
TOOLS ALLOWED: read-only tools only
TOOLS FORBIDDEN: package installs - migrations - .env edits - git push - Write/Edit - any file modification
DELIVERABLE: the trace report in the SCHEMA below, returned as your final message
SUCCESS CRITERIA:
  - Every claim carries a file:line pointer you actually read this run.
  - The trace names entry point, state changes, ownership boundaries, and the failure paths relevant to the question.
  - Rationale claims are labeled: quote the comment/commit/doc that states a reason, or mark the claim [inference] with supporting evidence.
  - Anything you could not resolve is listed under open_questions, never guessed.
OUT OF SCOPE:
  - Modifying any file; writing any artifact or findings entry.
  - Explaining adjacent subsystems not named in the GOAL.
  - Recommending changes - explanation only.
STOP CONDITIONS:
  - The named symbol/file/ref does not exist: stop and report that fact instead of tracing a substitute.
  - The behavior spans >4 ownership boundaries: report that the question is unscoped rather than fanning out further.
  - Dispatch-fatal tool outage after the serena fallback: report what you grounded and what remains ungrounded.
SCHEMA: explain-trace v1
summary:      <2-3 sentences: the mechanism in plain terms>
trace:        [ { claim: <one line of behavior>, evidence: <file:line you read>, kind: behavior|documented-rationale|inference } ]
boundaries:   [ <ownership/state boundary the answer depends on, with file:line> ]
failure_paths:[ <condition -> observed behavior, with file:line> ]
open_questions: [ <what you could not resolve and what it would take> ]
```

## Slicing (when one dispatch is not enough)

Split by **ownership boundary**, not by file count: each slice must be independently answerable ("what happens inside the worker", "what happens in the queue store", "what the caller observes"). Dispatch all slices in ONE message. Read every returned `trace` entry against its evidence; where two reports overlap or contradict, resolve by reading the source yourself - the explorer report is a map, not the truth.

## Diff and window traces

Same spec, different GOAL/evidence: for a diff, the GOAL names the resolved ref and the CONTEXT carries what the request implies it changed; evidence is `git show <ref>` plus the touched files and any motivating doc under `docs/`. For a window, the GOAL names the resolved date range and the evidence is `git log --since/--until` with touched files. An empty range/window is a STOP CONDITION - report the absence rather than tracing a substitute.

## Inline fallback

When Task dispatch is unavailable or fails on a reason that survives correcting the invocation, run the same trace inline: same tool routing (batched `ToolSearch` first), same evidence budget (read spans, not whole files), same SCHEMA - and disclose the inline fallback in one line in the delivered answer. A trivial single-symbol lookup never needed the dispatch in the first place.