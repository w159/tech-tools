# The loop library

atlas-chronos matches a recurring or iterative task to the best-fit loop
from a curated library, then instantiates it. The library lives in
`loops/` (one file per loop plus an `INDEX.md` catalog). This reference
documents the three cadences and how to pick one, so the SKILL.md can
stay about routing. Read this when you are deciding which cadence a
task wants, or when you are adding a new loop to the library.

## The three cadences

Every loop runs on exactly one cadence. The cadence decides who drives
the repetition.

| Cadence | Who repeats it | How you instantiate it |
|---|---|---|
| **interval** | A timer | Hand to the built-in `/loop` skill: `/loop <interval> <prompt-or-slash-command>`. The interval is a duration like `5m`, `30s`, `2h`. |
| **self-paced** | The model decides when to go again | Hand to `/loop` with no interval so the model self-paces between iterations until the stop condition is met. |
| **fan-out** | Parallel subagents, once or per wave | Run as a Workflow: dispatch N independent subagents in one message, then an adversarial `atlas:verifier` pass. No timer; the loop is the wave plus its verification, repeated until the queue is drained. |

## How to pick a cadence

The task's shape, not the user's wording, picks the cadence:

- A **time-driven** poll or recurring check is **interval**. Examples:
  watch a flaky build (`build-fix-loop`), poll a live incident
  (`incident-triage`), re-run a suspect test many times
  (`flaky-test-hunt`).
- An **until-converged** refine is **self-paced**. Examples: exhaust a
  search space (`loop-until-dry`), reconcile docs drift item by item
  (`doc-reconcile`), profile and fix the top hotspot until a target is
  met (`perf-profile-iterate`), drive a PR through review rounds
  (`code-review-iterate`), run a multi-step migration stage by stage
  (`migration-pipeline`), build test-first (`red-green-tdd`).
- A **breadth-first sweep** of independent items is **fan-out**.
  Examples: review a change set through several lenses
  (`fan-out-adversarial-verify`), bump many dependencies in isolation
  (`dependency-bump-sweep`), triage a batch of scanner findings
  (`security-finding-verify`).

When in doubt: time-driven is interval, until-converged is
self-paced, breadth-first is fan-out.

## The library catalog

`loops/INDEX.md` is the compact catalog. It lists every loop with its
id, category, cadence, and one-line `when-to-use`. Read `INDEX.md`
first (progressive disclosure: never preload the individual loop
files; the index is enough to choose). Then read only the chosen
loop's file for its full steps and template.

Current categories and their loops:

| Category | Loops |
|---|---|
| discovery | loop-until-dry (self-paced) |
| review | fan-out-adversarial-verify (fan-out), code-review-iterate (self-paced) |
| build | red-green-tdd (self-paced), build-fix-loop (interval) |
| docs | doc-reconcile (self-paced) |
| ops | incident-triage (interval) |
| maintenance | dependency-bump-sweep (fan-out) |
| testing | flaky-test-hunt (interval) |
| data | migration-pipeline (self-paced) |
| performance | perf-profile-iterate (self-paced) |
| security | security-finding-verify (fan-out) |

## Adding a new loop

If no loop fits, say so plainly, then offer the closest one as a
starting point or propose a new loop. A new loop is a new
`loops/<id>.md` file following the existing frontmatter shape plus a
row in `loops/INDEX.md`. Use `templates/loop-spec.md` as the scaffold.
The `<id>` must be a filesystem-safe slug (lowercase, only
`a-z 0-9 - _`), because a colon in any filename makes the repo
un-checkout-able on Windows.

## Loops compose

A `fan-out` sweep can feed a `self-paced` refine on the survivors.
When you chain loops, name the handoff: what the first loop produces,
what the second consumes. The chain is data dependency, not ceremony.

## Instantiation rules (apply to every loop)

- **Inputs are explicit.** Each loop file declares an `inputs` list in
  its frontmatter. Resolve every input before running. Prefer
  discovery (read the repo, the manifest, the failing command) over
  asking; ask only for genuinely unknowable values (a target URL, an
  interval preference, a budget).
- **Interval choice is deliberate.** Pick the cadence interval from the
  task tempo, not a default. A deploy poll is minutes; a backlog sweep
  that hammers an API needs a longer gap or rate awareness. State the
  interval and why.
- **Fan-out stays bounded.** Cap concurrent subagents (~4-6 in
  flight) and always close a wave with an independent verifier before
  spawning dependents. Reuse the atlas squad (`atlas:explorer`,
  `atlas:implementer`, `atlas:verifier`) rather than generic agents
  when the work is code.
- **Destructive loops gate.** If the chosen loop writes, migrates,
  pushes, or is visible to others, surface the blast radius and stop
  for approval before the first mutating iteration. Read-only loops
  (status polls, discovery sweeps) may run freely.
- **State the stop condition.** Every loop must know when it is done.
  A loop with no stop condition is a defect.
- **Hand off cleanly to `/loop`.** For interval and self-paced loops
  the deliverable is the exact `/loop ...` line the user (or the
  session) runs. Do not simulate the timer yourself; `/loop` owns the
  cadence.