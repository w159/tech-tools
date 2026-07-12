---
name: atlas-handoff
description: Produce a dense session handoff so a fresh session resumes with zero re-discovery. Use at a checkpoint before context fills, a break, or handing off work.
when_to_use: produce a dense session handoff at a checkpoint before context fills, a break, or when handing off work to a fresh session
allowed-tools: Read, Glob, Grep, Bash, Write
argument-hint: (no args; run at a checkpoint)
---



Apply the Operating Contract to this entire task. It is injected below.

```!
cat "${CLAUDE_PLUGIN_ROOT}/skills/atlas-metis/references/operating-contract.md"
```

If the contract did not load above, read `skills/atlas-metis/references/operating-contract.md` and apply it before proceeding.

Produce a session handoff for the current work.

Use `templates/handoff.md` as the document seed and follow the field
schema in `references/handoff-memory-schema.md` for the structured shape
(both the prose file and the memory record use the same fields).

Where to write it:
- If Serena is available, use its prepare_for_new_conversation tool and write the output to project memory.
- Otherwise, write the handoff to the project's docs directory or its memory store.
- If you cannot tell where the project keeps memory or docs, ask once, then proceed.

The handoff must capture, factually and specifically:
- Goal and current state: what is done, what is verified (with the evidence), and what remains.
- Files touched: exact paths, plus the key symbols, functions, or sections changed in each.
- Decisions made and why, plus anything explicitly ruled out and the reason.
- Open questions and the single next concrete step.
- The exact commands to re-run to confirm current state, each with its expected output.

Keep it precise, not narrative. Record only what a new session needs to act. No summary of intent. Omit anything not actionable for a fresh session.

VERIFY before reporting:
- Confirm every "verified" claim names the command run and the output observed, not an assumption.
- Confirm the re-run commands are real and complete enough to reproduce the current state, each paired with its expected output.
- Confirm every file path listed exists and the named symbols are correct.

REPORT:
- Where the handoff was written (Serena memory key, or the file path).
- The exact commands a fresh session should run first to confirm current state, with expected output.

If a required input is missing or ambiguous, ask once for it, then proceed.
