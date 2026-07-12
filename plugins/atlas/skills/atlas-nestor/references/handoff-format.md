# Inter-stage handoff format

atlas-nestor composes skills into an ordered stack and runs them stage
by stage. The baton passed between stages is the inter-stage handoff: a
short, structured note that tells the next skill what the previous one
produced, where the evidence lives, and what constraints to honor. Read
this when you are carrying context between stacked skills, or when a
stage lost the thread and you need to know what the prior stage should
have handed it.

## Why a handoff, not a re-discovery

Every skill in a stack starts with its own orientation. Without a
baton, each stage re-reads the repo, re-derives what the last stage
already found, and burns context and wall-clock re-establishing state
the prior stage already held. The handoff exists so stage N+1 starts
from stage N's conclusions, not from zero. It is a one-paragraph baton,
not a full session-resume checkpoint. For a full session checkpoint,
use the separate `atlas-handoff` skill.

## The baton format

Carried forward between every stage. One paragraph, four fields, in
this order:

```
PRODUCED: <what this stage made, named by its output artifact path>
EVIDENCE: <where the proof lives, .atlas/docs/evidence/<file>.md or a test result>
STATUS:   <verified | rejected | partial, in one phrase>
NEXT:     <the constraint or input the next stage must honor>
```

Rules:
- `PRODUCED` names the artifact, not the activity. "Wrote
  .atlas/docs/audits/atlas-athena-<date>/report.md" not "did an audit."
- `EVIDENCE` is a path the next stage can open. If the stage produced
  no evidence artifact (a pure discovery stage, a confirm-only stage),
  say so explicitly: `EVIDENCE: none (read-only stage)`.
- `STATUS` is one of `verified`, `rejected`, or `partial`. Never
  "done" or "complete": those are not handoff states, they are
  completion-gate states owned by atlas-metis.
- `NEXT` is the single most important constraint the next stage must
  honor. If there is none, say `NEXT: none`.

## What goes in the stack plan vs the handoff

The stack plan (Step 3 of the SKILL.md) is written once, before
execution. It lists the ordered skills, what each contributes, and what
each hands the next stage. The handoff is written at each stage
boundary, during execution. The plan is the intent; the handoff is the
observed result. The plan names the skill chain; the handoff carries
the actual artifact and evidence path.

## Recording the stack plan

The approved stack plan is written to `.atlas/docs/plans/` as a short
numbered list before execution starts:

```
1. <skill> -> <contribution> -> hands <stage-2-input>
2. <skill> -> <contribution> -> hands <stage-3-input>
3. <skill> -> <contribution> -> (close: definition-of-done)
```

Each line is one stage. The `-> hands <X>` clause is what that stage's
handoff baton's `PRODUCED` field should contain when the stage
completes. Mismatches between the plan and the actual handoff are the
signal that a stage drifted; the orchestrator reconciles before
advancing.

## When a stage has nothing to hand

A discovery-only stage (atlas-ariadne mapping, atlas-athena audit) hands
its report path and the finding count. An implementation stage hands
the changed paths and the verifier verdict. A stage that failed or was
rejected hands its `STATUS: rejected` and the rejection reason, and
the orchestrator decides whether to re-run the stage, substitute a
skill, or stop and ask the user.

## Boundary with atlas-handoff

atlas-nestor's handoff is the inter-stage baton inside one session, for
one stack. `atlas-handoff` is the separate session-resume checkpoint
that survives a session end and lets a new session pick up the work.
They share a name, not a purpose. Do not write a nestor handoff when
the user asked to pause and resume; that is atlas-handoff's job.