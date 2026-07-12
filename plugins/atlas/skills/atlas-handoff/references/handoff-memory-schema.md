# Handoff Memory Schema

The structured shape of a handoff record, for storage in Serena project
memory or an on-disk file. The schema is the contract a fresh session
relies on to resume without re-discovery.

## Fields

| Field | Type | Required | Purpose |
|---|---|---|---|
| `topic` | string | yes | One-line description of the work. |
| `written_at` | ISO 8601 | yes | When the handoff was produced. |
| `session_id` | string | yes | The CLAUDE_CODE_SESSION_ID that wrote it. |
| `working_dir` | absolute path | yes | The directory the work ran in. |
| `goal` | string | yes | The single outcome that defines done. |
| `done` | list[string] | yes | What is complete. May be empty. |
| `verified` | list[{claim, command, output}] | yes | Each verified claim with its evidence. |
| `remaining` | list[string] | yes | What is not yet done. May be empty. |
| `files` | list[{path, changes}] | yes | Files touched, with the symbols or sections changed. |
| `decisions` | list[{decision, why}] | yes | Decisions made and the reason. |
| `ruled_out` | list[{option, why}] | yes | Options explicitly rejected and the reason. |
| `open_questions` | list[string] | yes | Unresolved questions. May be empty. |
| `next_step` | string | yes | The single next concrete action. |
| `rerun` | list[{command, expected}] | yes | Commands to confirm current state, each with expected output. |

## Storage locations (in priority order)

1. **Serena project memory** - if Serena is available, use
   `prepare_for_new_conversation` and write the output to project memory.
   Key: `handoff/<topic-slug>`.
2. **Project docs directory** - write to `docs/handoffs/<topic-slug>.md`
   if the project keeps a docs tree.
3. **Project memory store** - write to the project's declared memory
   location if neither of the above is available.

If you cannot tell where the project keeps memory or docs, ask once,
then proceed.

## Verification before write

- Every `verified` entry: the `command` was actually run this session
  and the `output` is what was observed (copied, not paraphrased).
- Every `rerun` entry: the command is real and complete; the `expected`
  output is specific enough to confirm state.
- Every `files[].path` exists at write time; every named symbol is
  correct.

## Anti-patterns

- Narrative prose ("we discussed", "the plan is to"): cut it.
- Intent without action ("we want to improve"): cut it.
- A claim of "done" with no evidence: move it to `remaining`.
- A re-run command with no expected output: incomplete; fill it in.