# Prompt Spec Template

The canonical 7-section structured prompt for handing a task to a coding
agent. Use this format when the optimized prompt needs to be
self-contained for a subagent (one that has no prior context) - it is the
shape the subagents.md role-protocol expects.

Every section header is required. If a section has no content, write
`N/A` and a one-line reason. Do not omit the header.

## Template

```
TASK: <one sentence, measurable, verb-led>
EXPECTED OUTCOME: <what a reviewer can observe when this is done - a file, a test, a behavior>
CONTEXT:
  - paths: [<absolute paths the agent may touch>]
  - prior findings: [<ids or file:line refs from upstream work>]
  - constraints: [<invariants that must hold throughout>]
CONSTRAINTS:
  - <hard rules: no new deps, no .env edits, idempotent, etc.>
MUST DO:
  - <research docs before code>
  - <write failing test first if TDD applies>
  - <run the project gate (lint/typecheck/test/build) and show output>
MUST NOT DO:
  - <invent API signatures from training data>
  - <claim done without evidence>
  - <expand scope beyond the TASK line>
OUTPUT FORMAT:
  - <what the agent returns: a diff, a report, a file path + summary>
```

## Section-by-section rules

- **TASK** - one sentence, verb-led, measurable. If you need two
  sentences, split the task.
- **EXPECTED OUTCOME** - the observable artifact, not the process. A
  reviewer who never watched the work should be able to confirm this from
  the output alone.
- **CONTEXT.paths** - absolute paths only. The subagent starts with no
  memory of your session; relative paths are ambiguous.
- **CONTEXT.prior findings** - cite upstream work by id or file:line so
  the subagent does not redo discovery.
- **CONSTRAINTS** - invariants that hold throughout the work. Things the
  agent must not violate while doing anything else.
- **MUST DO** - the ordered steps the agent performs. Reference real tools
  by name (confirmed to exist in the session, not invented).
- **MUST NOT DO** - the anti-patterns that would make the output invalid
  even if it looks correct. Always include the two universal ones:
  inventing API signatures from training data, and claiming done without
  evidence.
- **OUTPUT FORMAT** - the literal shape of the return message. If the
  agent returns a file path, say so. If it returns a diff, say so.

## When to use this vs. the inline Optimized Prompt block

- The Optimized Prompt block (in SKILL.md) is for the main agent to act
  on directly in the same session.
- This 7-section spec is for handing the task to a subagent in a fresh
  context, or for persisting the task as a handoff artifact.
- Both are valid outputs of atlas-prompt; pick by where the work runs.