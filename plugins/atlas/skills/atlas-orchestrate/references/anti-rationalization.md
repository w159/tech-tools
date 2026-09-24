# Anti Rationalization

Load from atlas-orchestrate when the matching trigger fires. Content is authoritative for the skill.

Stop-thoughts and red flags

## Rationalization table - STOP if you think any of these

| The thought | The reality |
|---|---|
| "This is too small to delegate." | Size is not an exemption. Dispatch it - the user wants subagents driven hard. |
| "I'll just `find_symbol` / read it real quick to understand." | Discovery is dispatched. Your context is for synthesis, not source. |
| "It's a one-line fix, not bulk - I'll apply it." | Every code edit goes to a subagent. "One line" is the classic disguise. |
| "Not consequential enough for a second agent." | If it ships, it gets an independent verifier. You don't decide it's exempt. |
| "I ran the curl/test myself - that's evidence." | The *verifier* (a different agent) runs the confirming check. Your own run doesn't close the loop. |
| "The diff looks right, call it done." | Verification is observed runtime behavior, not reading a diff. |
| "I checked my own reasoning - it's sound." | A model that skips verification also passes its own introspection. Run the failable check; don't self-attest. |
| "I'll mark it unverified and move on." | Unverified != done. Produce the artifact or stop and say you're blocked. |
| "The code's done, I'll update docs later." | docs/ current is part of the gate. CHANGELOG/ROADMAP and affected subfolders update before done. |
| "I'll just spec the exact fix / the patch for the implementer." | That's writing it yourself in prose. Hand over goal + constraints + acceptance criteria - never the bytes. |
| "It ran / the file downloaded - that's the evidence." | Occurrence isn't correctness. Reproduce the *failing* case and show *that* case green. |
| "I'll tell the verifier exactly what to confirm." | A primed verifier rubber-stamps. Give it the symptom; let it derive its own check. |
| "I'll note my assumption in the reply and proceed." | An assumption disclosed after the fact is a defect, not a disclaimer - it is a recurring, measured friction category in this fleet's telemetry (assumption_admission; the classifier was tightened 2026-09-24 to stop counting quoted doc text). Resolve it with a tool call (read the file, run the query, check the config) or ask. Never act on it and mention it later. |
| "The request is clear enough - I'll start." | Restate the ask in one line before acting. A user correction ("that's not what I asked") means the restatement was skipped; user_correction is a measured category, though roughly 40% of its rows before 2026-09-24 were classifier false positives from pasted text and stop-condition boilerplate, now guarded out. |
| "It's basically what they asked for." | "Basically" is where corrections come from. Name the exact deliverable and check each part against it before reporting. |


## Red flags - these mean STOP and dispatch

"I'll open this file" * "too small to orchestrate" * "I'll fix it directly" * "I already tested it" * "I'll verify it myself" * "my reasoning is sound" * "the diff is fine" * "docs later" * "mark unverified and continue" * "I'm assuming" * "I noted the assumption" * "that should be equivalent". Each one means: **stop, dispatch, get observed-behavior evidence, get an independent verifier, and update docs/.**


