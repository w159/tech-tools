---
name: atlas-handoff
description: Produce a dense session handoff so a fresh session resumes with zero re-discovery. Use at a checkpoint before context fills, a break, or handing off work.
when_to_use: produce a dense session handoff at a checkpoint before context fills, a break, or when handing off work to a fresh session
allowed-tools: Read, Glob, Grep, Bash, Write
argument-hint: (no args; run at a checkpoint)
---



Apply the Operating Contract to this entire task. It is injected below.

```!
cat "${CLAUDE_PLUGIN_ROOT}/references/operating-contract.md"
```

If the contract did not load above, read `${CLAUDE_PLUGIN_ROOT}/references/operating-contract.md` and apply it before proceeding.

## Step 0 - gate preflight, BEFORE you write a word of the summary

Measured failure this step exists to kill: a run of sessions where the only ask was
"summarize this for handoff", the Stop hook then flagged docs drift or a missing
verified finding, agents were dispatched to close it, and the session ended with the
agents still running. The summary about the unfinished work became the unfinished work.
The gate is deterministic. You already know it will fire. Close it first, while the
context is still loaded.

Run these three checks now, inline. They are reads and small writes to `docs/` and
`.atlas/`, which an orchestrator is allowed to do directly - do NOT dispatch for them.

1. **Findings.** Read `.atlas/.run/findings.json`. List every stage this session shipped
   that has no entry. For each one where a check actually ran, write the row now:
   `python3 "${CLAUDE_PLUGIN_ROOT}/scripts/atlas_finding.py" --id <stage> --status
   verified|rejected|needs-evidence --title "<one line>" --evidence "<path or test id>"
   --reproduction "<exact command>"`. Where no check ran, write `needs-evidence` with
   the exact command that would settle it. Do not invent a `verified`.
2. **Docs drift.** `git status --short` and `git diff --name-only`. If any non-docs file
   changed with no `docs/` file beside it, update `docs/CHANGELOG.md` (and
   `docs/ROADMAP.md` if items completed) yourself, right now, with file:line evidence.
3. **Blockers you cannot close in this session.** Name them. Do not start a dispatch
   that cannot finish. An honestly open gate documented in the handoff beats a
   half-finished remediation wave.

Report the preflight result in two short lines (findings written, docs reconciled) and
only then continue.

## The handoff

Produce a session handoff for the current work.

Use `templates/handoff.md` as the document seed and follow the field
schema in `references/handoff-memory-schema.md` for the structured shape
(both the prose file and the memory record use the same fields).

Where to write it:
- If serena has an active project, write the record with `write_memory` (key
  `handoff/<topic-slug>`); `list_memories` / `read_memory` retrieve it next session.
  There is no `prepare_for_new_conversation` tool in serena 1.6 - compose the record
  yourself from the field schema.
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
