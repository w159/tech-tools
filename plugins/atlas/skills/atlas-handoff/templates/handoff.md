# Handoff Document Seed

Copy this template to the project's memory store or `docs/handoffs/`
directory and fill the brackets. One handoff per file. The goal is a
fresh session resumes with zero re-discovery - record only what the next
session needs to act.

```markdown
# Handoff: <one-line topic>

- **Written:** <ISO 8601>
- **Session:** <CLAUDE_CODE_SESSION_ID>
- **Working dir:** <absolute path>

## Goal and current state

- Goal: <one sentence>
- Done: <what is complete>
- Verified: <what is verified, with the evidence - command and output>
- Remaining: <what is not yet done>

## Files touched

- <absolute path> - <symbols/sections changed; one line per file>

## Decisions

- <decision> - <why>
- Ruled out: <option> - <why>

## Open questions

- <question, or "none">

## Next concrete step

- <the single next action>

## Re-run commands (to confirm current state)

- `<command>` -> expected: <output>
- `<command>` -> expected: <output>
```

## Rules

- Precise, not narrative. Record only what a new session needs to act.
- No summary of intent. If a sentence does not help the next session do
  work, cut it.
- Every "verified" claim names the command run and the output observed,
  not an assumption.
- Every re-run command is real and complete enough to reproduce current
  state, paired with its expected output.
- Every file path listed exists; every named symbol is correct.