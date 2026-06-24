# Multi-Stage Planning

The principle: **plan before you touch anything, and make every stage prove itself.** Assumption-driven work is banned. You move forward only on checked output, and you move backward the moment a later fix invalidates an earlier check.

## The stage map

Before editing, write a NUMBERED plan. Each stage names its expected output AND a failable check - a check that can actually return red. A stage that produces nothing checkable is not a stage; merge it into the next one until it does. The map is a living document: when something you learn invalidates a stage, rewrite the map, do not patch around it.

```
Stage N: [name] -> [expected output] -> [failable check]
```

Example:

```
Stage 1: map the auth flow      -> call-path with file:line refs   -> a named entry point exists and is reachable
Stage 2: reproduce the 401      -> failing curl + captured body    -> request returns 401 with the reported message
Stage 3: fix token validation   -> minimal diff in requireAuth     -> the same curl now returns 200
Stage 4: regression sweep       -> green suite                     -> existing auth tests still pass
```

If you cannot write the failable check for a stage, you do not yet understand the stage. Go back to research.

## The bidirectional loop

The loop runs forward AND backward. If a fix at stage N invalidates an earlier stage's output, re-run that earlier check before continuing. A change that makes stage 4 pass but quietly breaks stage 2's assumption is a regression you created.

```
... Stage 3 fix lands -> does it touch anything Stage 1 or 2 proved? 
    yes -> re-run that earlier check now (not at the end)
    no  -> proceed to Stage 4
```

The cost of catching an error one stage back is trivial. The cost of catching it after five more stages built on top of it is catastrophic. Pay the trivial cost.

## The per-stage gate

A stage's dependents do not start until that stage is `verified`. The mark is written by an *independent* `atlas:verifier` (or specialist) running its own failable check in a *fresh* context, per law 5 in `SKILL.md`, and recorded in `docs/.run/findings.json`:

```
Stage N completes -> independent verifier runs Stage N's failable check in a fresh context
    verified -> dependents of Stage N may now dispatch
    rejected -> Stage N BLOCKS its dependents; re-implement (fresh implementer, failure attached) and re-verify first
```

This is the Verify step (`SKILL.md` step 3) applied per stage, not only at end-of-session. A `rejected` stage is a hard stop for everything downstream of it: do not run a dependent against an unverified or rejected predecessor, even to "save a round trip." Three failed verify cycles on the same stage -> mark `needs-human`, defer it, and proceed only with stages that do not depend on it.

## Delegation decision

Independent stages are the default fan-out unit: when two or more stages are genuinely independent - no shared state, no ordering dependency, neither needs the other's output - they MUST be dispatched in a *single message* so they run concurrently (~4-6 in flight). Single-message concurrent dispatch is the default; sequential, one-stage-per-message dispatch is reserved for a *real* data/ordering dependency where a stage needs an earlier stage's output. Do not invent a dependency to serialize work that could run in parallel.

The independence test still governs what counts as a separate stage: do not split a single coherent thought across subagents just to "use parallelism." Over-fan-out fragments a line of reasoning into pieces no one holds, and the orchestrator pays to reassemble them. One coherent investigation belongs in one agent.

When concurrent stages may edit the same files, give each subagent the dispatch-time `isolation: "worktree"` option (see `subagent-kit.md`) so their edits land in isolated worktrees and cannot collide. Read-only concurrent stages need no isolation.

When you do delegate, every subagent gets a 4-part brief:

1. **Its specific task** - one job, scoped to a distinct concern.
2. **What it must produce** - the exact artifact (a findings entry, a diff, a captured repro).
3. **Where to save outputs** - the path it writes to (e.g. `docs/evidence/`, `docs/.run/`).
4. **Relevant context from prior stages** - only what it cannot derive itself: paths, the failing case, finding ids from earlier waves.

(See `subagent-kit.md` for the full dispatch spec these four parts plug into.)

## Standing-consent orchestration mode

While the atlas-engine skill is active, the orchestrator has STANDING CONSENT to fan out to subagents for every substantive task without re-asking. Optimize for the most exhaustive correct answer, not the fastest one. Work solo only on trivial or purely conversational turns where a subagent would add nothing.

- The user can say **"mode off"** to revert to per-task confirmation (ask before each fan-out).
- Saying **"mode on"** - or re-invoking the skill - restores standing consent.

This is the skill-level translation of the API "mid-conversation system message" pattern. The skill contract cannot send itself a system message, so the consent lives here, in writing, as the standing agreement for the session.

## Effort and granularity sizing

Scale fan-out to the task. Do not manufacture subtasks to look busy, and do not cram a broad audit into one agent.

- A focused change to a module of a few hundred lines rarely needs more than ~10 subtasks.
- A broad audit of a large codebase justifies more - split by surface, layer, or component.
- Scope each subtask to a **distinct concern, component, or question.** Never per-line, never per-file-for-its-own-sake.

If two "subtasks" would always succeed or fail together, they are one subtask.

## Resumability

Maintain `docs/.run/work-log.md` as the session's memory:

- Decisions made and the rationale behind each.
- What was tried and failed (so it is not retried).
- Open items and their current status.

Re-read it before any continuation - after a pause, a handoff, or a context compaction - so no completed work is duplicated and no failed approach is repeated. The work-log is the difference between resuming and restarting.
