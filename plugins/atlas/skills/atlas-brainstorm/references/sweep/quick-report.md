# Quick report path

Use when the artifact covers one specific issue, is short, or the user asks for "quick", "small", "simple", or "just summarize". The goal is one concise, evidence-backed bug report - not a multi-artifact requirements package.

## Workflow

1. Read the artifact in full (it is short by definition). Apply the evidence rules: verbatim quote + anchor for every claim.
2. Emit the bug report inline in chat so the user can confirm before anything touches disk. Write a file only if the user asks - and then a single `bug-report.md` next to the source artifact or at a path the user names. Never auto-create `docs/features/` output on this path.
3. No quote verification dispatch is required for the quick path (the artifact is short enough to re-check by eye), but the same rule holds: a claim without a verifiable quote is inference, and inference is labeled as such.

## Bug report shape

- **Title** - one sentence naming the broken behavior.
- **Steps to reproduce** - bullets reconstructed from the artifact (what the user did, in order).
- **Expected vs. actual** - what the user said should happen vs. what happened.
- **Evidence** - verbatim quote(s) with anchor (timestamp / ticket id / message number), plus 0-2 frame references when a recording is involved.
- **Suggested next step** - one sentence: file an issue, run `atlas-debug`, or escalate to extensive analysis.

## Optional likely-surface line

Only if the workspace is the product source AND the broken surface is named clearly in the transcript or visible UI, add one line:

```
Likely surface: src/web/export.ts:88 - Confidence: Medium
```

Skip the section entirely when the mapping is speculative; speculative mappings belong to the extensive path's source-mapping pass.

## What this path skips

- No category split, no requirements kickoff, no `docs/features/` artifact.
- No source-mapping pass across the codebase.
- No durable commit of raw material - if frames were extracted, they live in a temp location and are discarded unless the user asks to escalate.
- No handoff to `atlas-brainstorm`. The quick path ends at the report.

## Escalation

If, while reading, the artifact turns out to contain multiple distinct issues, requests, or a workflow walkthrough, stop and tell the user: "This artifact has more than one issue - switching to the extensive path." Then load `../finding-format.md` and `../personas/feedback-analyst.md` and restart as the extensive path, keeping the quotes already extracted.
