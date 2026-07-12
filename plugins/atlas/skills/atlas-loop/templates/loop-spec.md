# Loop spec scaffold

Use this scaffold when you are adding a new loop to the library. One
file per loop, saved as `loops/<id>.md`, plus a row in
`loops/INDEX.md`. See `references/loop-library.md` for the cadence
rules and when each cadence fits.

Copy the block below, fill every field, then delete the section that
does not match your cadence (interval/self-paced keep the `/loop`
template; fan-out keeps the Workflow shape).

```
---
id: <filesystem-safe slug, lowercase, only a-z 0-9 - _; no colon, slash, or space>
name: <human-readable name>
category: <discovery | review | build | docs | ops | maintenance | testing | data | performance | security>
cadence: interval | self-paced | fan-out
inputs:
  - <input name>: <one sentence: what it is and whether it can be discovered or must be asked>
  - <input name>: ...
---

# <id>

<One paragraph: what this loop does, why it repeats, and what cadence it runs on.>

## Steps

1. **<step>.** <what happens in this step, including which agent runs it if it is an atlas session>.
2. **<step>.** ...
3. **<step>.** ...
4. **<step>.** ...
5. **<step>.** ...

## Stop condition

<One sentence: the exact condition that makes this loop done. A met
condition, a drained queue, a green check, or an explicit iteration
cap. A loop with no stop condition is a defect.>

## Template (interval / self-paced)

/loop <interval, or omit to self-pace> <prompt-or-slash-command with the inputs resolved>

## Workflow shape (fan-out)

```
Wave 1 - <role> (single message, parallel):
  Agent(<atlas squad agent>): <brief>
    Return: <output contract>
  ... one per <unit> ...

Wave 2 - adversarial verify (single message, parallel, fresh context):
  Agent(atlas:verifier): <brief, derived from the symptom not the worker's conclusion>

Synthesize: <what the orchestrator keeps and how it ranks it>
```
```

## Field rules

- `id` is the filename (minus `.md`) and the `atlas-launch` target. It
  must be a filesystem-safe slug. No colon, slash, or space: the repo
  must stay checkout-able on Windows.
- `category` must match an existing category in `loops/INDEX.md`, or
  you are introducing a new one (state that in the INDEX row).
- `cadence` must be exactly one of `interval`, `self-paced`, `fan-out`.
- `inputs` is a list. Every input the loop needs must be declared here,
  with a one-sentence description. If an input can be discovered (read
  from the repo, the manifest, the failing command), say so; only
  genuinely unknowable values (a target URL, an interval preference, a
  budget) are asked.
- The `Steps` section is the ordered procedure. Name the agent that
  runs each step in an atlas session (route edits to
  `atlas:implementer`, confirmation to `atlas:verifier`).
- The `Stop condition` is mandatory. No loop ships without one.
- Keep only the template section that matches the cadence. Delete the
  other two.

## After writing the file

Add a row to `loops/INDEX.md`:

```
| <id> | <category> | <cadence> | <one-line when-to-use> | loops/<id>.md |
```

The `when-to-use` line is what the matcher scores against, so write it
from the task's intent, not the loop's mechanism. "Watch a flaky build
and re-run until green" (intent) not "Run build-fix-loop on a timer"
(mechanism).

## Example (a self-paced loop row)

```
| red-green-tdd | build | self-paced | Implement a feature or fix test-first: write a failing test, make it pass, refactor, repeat per requirement. | loops/red-green-tdd.md |
```