# Verification & Grounding

The principle: **a claim is not done until an external artifact proves it.** Self-assessment proves nothing. Every check passes against something outside the model's own confidence, or it is not a check.

## Introspection is not verification

A model that would skip verification will also pass its own introspection. Asking "does this look right?" tells you only what the model already believed. It is the same reasoning grading itself.

A real check is satisfied by an EXTERNAL artifact:

- a test that actually runs and goes green;
- a file that exists in the expected shape (read it back, do not assume);
- a source that was actually opened and read, not recalled;
- output diffed against the spec, byte for byte where it matters.

If the only evidence is the model's say-so, there is no evidence.

## The Step-3 / Step-4 split

These are two different gates, and both are required.

- **Step 3 - the objective failable gate.** It CAN fail. Run the command, hit the endpoint, read the row back. Red here means stop and fix, not rationalize. This is the gate from the stage map's failable check (see `multi-stage-planning.md`).
- **Step 4 - skeptical self-critique, AFTER the gate passes.** Even with green output, name at least one residual weakness: an untested path, a fragile assumption, a state not exercised, a source skimmed not read. Then fix it or flag it explicitly.

Step 3 confirms the thing works. Step 4 assumes it is still wrong somewhere and goes looking. A pass on Step 3 is not permission to skip Step 4.

## Adversarial verification wave

Verification runs in a SEPARATE agent - different identity AND independent judgment - never the agent that produced the work. The verifier:

- re-derives the check from the user's ORIGINAL symptom, verbatim (not from the implementer's restatement of it);
- reproduces the failing case independently;
- tries to REFUTE the result, not confirm it;
- defaults to **"refuted / needs-evidence"** when uncertain. Uncertainty is not a pass.

Optionally spawn N independent skeptics and require a majority to confirm. Give them distinct lenses, not N copies of the same check:

- correctness (does the logic hold?)
- security (what does an attacker do with this?)
- reproduction (can the original failure be triggered again?)
- does-it-actually-reproduce (does the claimed fix survive the exact original repro?)

Route this to `atlas:verifier`. Its `rejected` verdict sends the item back to a fresh implementer with the failure attached.

## Completeness critic

A final pass - `atlas:completeness-critic` - that asks one question: **what is missing?**

- claims asserted but never verified;
- sources cited but not actually read;
- surfaces or states never exercised (loading, empty, error, success);
- original requirements left unmet;
- docs left stale by the change.

Its findings are not commentary. They become the next wave of work.

## Anti-hallucination guards (every subagent follows these)

- **"I don't know" is allowed.** Saying "not enough information" is a valid, expected answer. Guessing to fill silence is not.
- **Ground every claim in a source actually read.** Cite `file:line` or quote the exact text. A claim with no citation is unverified.
- **For long documents, extract first, then reason.** Pull the exact relevant lines into view, then reason over those lines - not over memory of the document.
- **Do not import outside facts** the task did not provide. If you must, label them `[unverified]` so the orchestrator sees they came from outside the task.
- **Mark any gap with no failable check as `unverified`** so it stays visible downstream instead of silently passing as done.
- **Verify a path exists before acting on it.** Never assume a generated file is present; read it back or stat it first. Prefer repo-relative resolution and `${CLAUDE_PLUGIN_ROOT}` for plugin-internal paths.
- **Confirm tool schemas before calling deferred/MCP tools.** Use `ToolSearch` to load the schema; pass arrays and objects as real JSON, not strings. A missing schema causes `InputValidationError` - the most common non-path failure mode.
- **Wrap external/MCP/network calls with a sane timeout** and one retry on transient failure. Surface the error explicitly; never silently swallow it.

## Mark unverified, visibly

`unverified` is a flag, never a completion state. You do not finish a task as "unverified." You either produce the artifact that proves it, or you stop and report blocked:

```
BLOCKED: [specific blocker]
Tried: [A, B, C]
Need: [decision / credential / access / clarification]
```

Shipping "should work" is the failure this whole file exists to prevent.
