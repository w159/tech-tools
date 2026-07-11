---
name: atlas-chronos
description: 'Match a recurring or iterative task to the best-fit reusable loop from a curated loop-library and instantiate it, handing interval/self-paced loops to the built-in /loop skill and running fan-out loops as a parallel adversarial-verify Workflow. Use when the user wants to run something repeatedly, poll for status, iterate until a condition is met, sweep a backlog, or stand up a recurring/scheduled workflow.'
---

# atlas-chronos - the loop matcher

A **loop** is a reusable, parameterized iterative workflow: a body of work plus a **cadence** that decides how it repeats. This skill does not invent a loop from scratch each time. It reads a curated library, matches the user's task to the closest loop by its `when-to-use`, presents the top candidates, then **instantiates** the chosen one by filling its inputs and dispatching it on the right cadence.

Your job is selection and instantiation, not improvisation. Push the per-loop detail into the loop files; keep this file about routing.

**Elicitation:** present the top loop candidates via **AskUserQuestion** (best match first, marked recommended), not as prose the user must answer free-form. If the chosen loop has a cadence or bound the task did not fix (interval, max iterations, dry-run threshold), fold it into the same round as a second question with concrete option values. One round total; discoverable inputs (paths, test commands, current failure count) are detected, never asked.

## The three cadences

Every loop runs on exactly one cadence. The cadence decides who drives the repetition.

| Cadence | Who repeats it | How you instantiate it |
|---|---|---|
| **interval** | A timer | Hand to the built-in `/loop` skill: `/loop <interval> <prompt-or-slash-command>`. The interval is a duration like `5m`, `30s`, `2h`. |
| **self-paced** | The model decides when to go again | Hand to `/loop` with **no interval** so the model self-paces between iterations until the stop condition is met. |
| **fan-out** | Parallel subagents, once or per wave | Run as a Workflow: dispatch N independent subagents in one message, then an adversarial `atlas:verifier` pass. No timer; the "loop" is the wave plus its verification, repeated until the queue is drained. |

When in doubt: a *time-driven* poll or recurring check is **interval**; an *until-converged* refine is **self-paced**; a *breadth-first sweep* of independent items is **fan-out**.

## How you run

1. **Read `loops/INDEX.md` first.** It is the compact catalog (id, category, cadence, one-line when-to-use, file). This is progressive disclosure: never preload the individual loop files; the index is enough to choose.
2. **Match the task to a loop** by its `when-to-use` line. Score on intent, not keywords: does the user's recurring/iterative need fit this loop's trigger?
3. **Present the top 1-3 candidates**, each with a one-line rationale stating why it fits and what cadence it runs on. If exactly one is an obvious fit, lead with it and name the runner-up only if it is close.
4. **Confirm the pick** (a single line is fine), then **read that one loop file** for its full steps and template.
5. **Instantiate it.** Collect the loop's declared `inputs` from the user or the environment (ask only for what you cannot discover). Then:
   - **interval / self-paced** -> fill the loop's ready-to-paste `/loop` line with the resolved inputs and hand it off.
   - **fan-out** -> fill the loop's Workflow shape (the per-subagent spec and the verifier pass) and dispatch the first wave.
6. **State the stop condition** before the loop starts running. Every loop must know when it is done (a met condition, a drained queue, a green check, or an explicit iteration cap). A loop with no stop condition is a defect.

## No-args behavior

If this skill is invoked with **no task** (bare invocation, or "what loops do you have"), do not guess. Read `loops/INDEX.md` and **list the available loops grouped by category**, one line each (id - when-to-use - cadence). Close with a prompt: "Name a task and I will match it to a loop." Do not instantiate anything.

## Instantiation rules

- **Inputs are explicit.** Each loop file declares an `inputs` list in its frontmatter. Resolve every input before running. Prefer discovery (read the repo, the manifest, the failing command) over asking; ask only for genuinely unknowable values (a target URL, an interval preference, a budget).
- **Interval choice is deliberate.** Pick the cadence interval from the task tempo, not a default. A deploy poll is minutes; a backlog sweep that hammers an API needs a longer gap or rate awareness. State the interval and why.
- **Fan-out stays bounded.** Cap concurrent subagents (~4-6 in flight) and always close a wave with an independent verifier before spawning dependents. Reuse the atlas squad (`atlas:explorer`, `atlas:implementer`, `atlas:verifier`, etc.) rather than generic agents when the work is code.
- **Destructive loops gate.** If the chosen loop writes, migrates, pushes, or is visible to others, surface the blast radius and stop for approval before the first mutating iteration. Read-only loops (status polls, discovery sweeps) may run freely.
- **Hand off cleanly to `/loop`.** For interval and self-paced loops your deliverable is the exact `/loop ...` line the user (or the session) runs. Do not simulate the timer yourself; `/loop` owns the cadence.

## Composing and extending

- A loop file is a template, not a cage. If the best-fit loop is 80% right, instantiate it and note the one deviation rather than forcing a worse match.
- If no loop fits, say so plainly, then offer the closest one as a starting point or propose a new loop (a new `loops/<id>.md` following the existing frontmatter shape: `id`, `name`, `category`, `cadence`, `inputs`). The `<id>` must be a filesystem-safe slug (lowercase, only `a-z 0-9 - _`; no colon, slash, or space - see the slug rule in `atlas-metis/references/docs-ssot.md` "Naming conventions"), or the repo cannot be checked out on Windows. Adding a loop means adding its row to `loops/INDEX.md` too.
- Loops compose: a `fan-out` sweep can feed a `self-paced` refine on the survivors. When you chain loops, name the handoff (what the first loop produces, what the second consumes).

## First move

Read `loops/INDEX.md`. If the user named a task, match and present the top candidates. If they did not, list the library grouped by category and ask for a task.
