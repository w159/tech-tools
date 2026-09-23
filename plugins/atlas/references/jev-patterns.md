# Jev patterns

Recipes for using the `typesafe` connector well. Read `jev-decisions.md` first - it holds
the contract every one of these obeys (Noul has no confidence, normalize scores, one call,
send state not files, degrade to silence).

These are ported from TypeSafe's published patterns and cookbooks, not invented here.
Source: `docs.typesafe.ai/patterns`, `docs.typesafe.ai/cookbooks`.

## Pick a pattern

| You need to | Pattern | Atlas home |
|---|---|---|
| ask several things about one artifact | Speculative fan-out | everywhere; it is the default |
| decide whether it is safe to act on an answer | Confidence-gated routing | anything that writes or dispatches |
| rank items on several dimensions at once | Composite scoring | `atlas-audit`, `atlas-refactor`, `atlas-validate` |
| send work to the right handler | Intent routing | `planner`, `atlas-orchestrate` |
| pick one item out of many, cheaply | Rank-then-verify | `explorer`, `/atlas menu <need>` |
| walk a tree to a leaf | Hierarchical / beam search | deep taxonomies, large module trees |
| know whether an answer is stable | Self-consistency | high-stakes single decisions |
| express a question that has parts | Structured criteria | any question backed by a schema or record |
| improve the question set itself | Autoresearch loop | project-level tuning, not mid-task |

---

## Speculative fan-out

**When.** Always, by default. Any time you are about to ask Jev one question about
something, ask every question you might plausibly want about it instead.

**Why.** Questions run in parallel server-side and do not see each other's answers, so
extra questions barely move latency and cost far less than extra round trips. The limit
is 20 per call.

**Shape.** Include questions whose relevance depends on another answer in the same call.
Classify *and* ask the follow-ups for every branch at once.

```json
{
  "state": "<the artifact>",
  "questions": {
    "kind":            { "type": "choice", "instructions": "...", "criteria": { "bug": "...", "perf": "...", "docs": "..." } },
    "severity":        { "type": "score",  "instructions": "...", "criteria": ["...", "...", "..."] },
    "has_repro":       { "type": "noul",   "instructions": "..." },
    "touches_schema":  { "type": "noul",   "instructions": "..." }
  }
}
```

**In code.** Read `kind`, then use only the answers that branch needs. `severity` and
`has_repro` are simply ignored when `kind` is `docs`. That is the pattern working, not
waste.

**Anti-pattern.** A Jev call, then a second Jev call over the same state because the first
answer raised a follow-up. Both questions belonged in the first call.

---

## Confidence-gated routing

**When.** Before acting on any Choice or Score answer, and especially before anything
that writes, dispatches, or is hard to undo.

**Why.** The answer tells you *what*; confidence tells you *whether to act on it*. One
global threshold is wrong because actions differ in blast radius.

**Three bands.** Act automatically / proceed but confirm first / do not act.

**Thresholds scale with risk.** Suggested atlas defaults:

| Action | Act automatically | Confirm first | Do not act |
|---|---|---|---|
| Ordering a read (which file to open first) | `>= 0.5` | - | `< 0.5` |
| Adding a note or finding to a report | `>= 0.6` | `0.5 - 0.6` (mark `[unverified]`) | `< 0.5` |
| Choosing which agent to dispatch | `>= 0.7` | `0.5 - 0.7` (say the second choice too) | `< 0.5` (ask) |
| Anything that edits, migrates, or deletes | never on Jev alone | - | - |

The bottom row is not a threshold, it is the contract: Jev never authorizes a write.

**In code.** Gate on the floor first, then branch on the answer, then apply that action's
own threshold. For a Noul there is no confidence - use distance from 0.5, and treat
`0.4 .. 0.6` as the do-not-act band.

---

## Composite scoring

**When.** A judgment has several independent dimensions and you want one ranking out of
them.

**Why.** Asking "how good is this overall" gives you one opaque number. Asking four
narrow questions and combining them in code gives you the same ranking plus the ability
to see *why* one item beat another, and to retune without re-querying.

**Shape.** One Score per dimension, in a single call. Each rubric is independent; do not
try to make the level counts match.

**In code.** Normalize every dimension (`score / (len(legend) - 1)`), then weight. The
weights live in atlas, never in the question - that is the point.

```
overall = 0.4*type_safety + 0.2*dedup + 0.2*simplicity + 0.2*robustness
```

Different surfaces may weight the same dimensions differently. A refactor pass cares more
about duplication and simplicity; a hardening pass cares more about frailty. Same call,
two weight maps.

`${CLAUDE_PLUGIN_ROOT}/scripts/jev_reduce.py --weights '{"type_safety":0.4,...}'` does the
normalize-and-weight step; use it rather than doing the arithmetic in prose.

**Report the dimensions, not just the composite.** A composite alone is unreviewable.

---

## Intent routing

**When.** A request has arrived and something must decide who handles it: a deterministic
script, a specific atlas agent, or the human.

**Why.** Classifying with one fast typed call is cheaper than having a full agent read the
request to decide it is not the right agent. The expensive handler only gets invoked for
the work that actually needs it.

**Shape.** One Choice over the handlers, plus a Score for how involved the work is, plus
any Nouls that change the route (touches schema? needs credentials? destructive?). One
call.

```json
{
  "state": { "request": "<the user's ask>", "repo_signals": { "stack": "...", "has_tests": true } },
  "questions": {
    "handler": {
      "type": "choice",
      "instructions": "Which atlas surface should take this request?",
      "criteria": {
        "explorer":    "Answer a structural question about existing code. Read-only.",
        "implementer": "Make one bounded, already-specified code change.",
        "planner":     "The work is not yet specified enough to implement.",
        "verifier":    "Check a claim that someone has already made.",
        "human":       "Needs a decision, credential, or access that no agent has."
      }
    },
    "scope": {
      "type": "score",
      "instructions": "How much of the codebase does this request touch?",
      "criteria": ["One symbol or file", "One module", "Several modules", "Cross-cutting or architectural"]
    },
    "destructive": { "type": "noul", "instructions": "Would completing this request delete data, drop schema, or make an irreversible external change?" }
  }
}
```

**In code.** Floor on `handler.confidence` first (below 0.5, ask rather than guess). Route
on `handler.choice`. Let `scope` decide whether the route needs a planner pass first, and
let `destructive` force a human confirmation regardless of everything else.

**Never** let the route silently override an explicit instruction from the user. This
picks a default, it does not overrule.

---

## Rank-then-verify

**When.** You have many candidates and need at most one - and "none of them" must stay
available as an answer.

**Why.** This is the shape that measured the biggest win in TypeSafe's own testing: over
488 turns against a 182-skill roster, a rank-then-verify suggestion cut wrong selections
from 16.8% to 7.3%, and cut "picked something when nothing fit" from 9.8% to 4.0%. The
abstain gate is doing much of that work - a bare list of names invites a guess.

**Two calls, and the second one is justified** because it sees state the first did not.

*Call 1 - skim everything, cheaply.* One Choice over all candidates with one-line
descriptions, plus Nouls asking whether **any** candidate is needed at all.

*Call 2 - read the shortlist properly.* Take the top 2-3 by probability. Re-ask with each
candidate's full description and the opening of its real content. Include a Noul per
candidate asking whether it genuinely does the thing. This call may still reject all of
them.

**In code.**

```
if mean(gate_nouls) < 0.3:            -> suggest nothing
shortlist = top 3 by probabilities
if max(fits_noul for shortlist) < 0.3 -> suggest nothing
else                                  -> the winner
```

**Deliver it as a hint, never a substitution.** The output is one line: "most likely
relevant: X - ignore this if it does not fit what was actually asked." The reader keeps
its own judgment and its full candidate list. In `explorer`, the winner is the file you
read *first*, never the file you report on without reading.

---

## Hierarchical / beam search

**When.** The candidate set is a tree deep enough that listing every leaf would blow the
255-option Choice cap or the state budget - a deep taxonomy, a large module tree, a
monorepo's package graph.

**Why.** One Choice per level keeps each question small, and the probabilities at each
node tell you whether the branch was actually clear.

**Greedy** takes the top child each time and cannot recover from an early mistake.
**Beam** keeps the best K paths and evaluates every frontier in parallel - in one call,
since the questions are independent - so later evidence can repair an ambiguous early
turn. Prefer beam with K=3 whenever the first level's top two probabilities are close.

**Scoring paths.** Length-normalize so shallow and deep leaves compare fairly:

```
path_score = product(edge_probabilities) ** (1 / decisions)
separation = top_path_score / second_path_score
```

`separation` near 1.0 means the tree did not actually discriminate - report the ambiguity
rather than the winner. For trees deeper than ~10 levels use `exp(mean(log(p)))` instead,
to avoid underflow.

**Show the subtree, not just the branch name.** When asking which branch to take, pass
each option's children as its description (structured criteria, below). A branch name
alone often does not reveal that the right leaf lives under it.

---

## Self-consistency

**When.** One decision matters enough that you want to know whether it is stable, and you
cannot verify it any other way.

**Why.** Jev is designed to return stable answers across repeats, so *instability is
itself the signal*. Agreement across runs means the state supports the answer;
disagreement means the question or the state is underspecified.

**Shape.** Ask the same question N times (3 is usually enough). Compare.

**In code.** Unanimous -> treat normally. Split -> downgrade to `[unverified]` and route
to human or verifier review, and say the vote in the report ("2 of 3"). Never average a
split into a confident-looking single number.

**Cost note.** This multiplies calls, which house rule 2 otherwise forbids. Reserve it for
the rare single decision that justifies it; it is not a default.

---

## Structured criteria

**When.** A question has labelled parts, or its criteria already exist as a schema,
taxonomy, or record.

**Why.** Jev reads structure. Flattening a JSON record into a prose template loses the
labels that make the question unambiguous, and costs tokens doing it.

**Where it is allowed.** `instructions`, Choice option descriptions, Score level
descriptions, and Noul `true`/`false` - all accept string, object, array, or null.

**Multi-part instructions:**

```json
"instructions": {
  "question": "Does the changed function still honor its documented contract?",
  "compare": ["docstring", "implementation"],
  "focus": "Return type and error cases, not naming."
}
```

**Options carrying their own subtree**, for the beam search above:

```json
"criteria": {
  "mcp_servers": { "typesafe-mcp": {}, "falcon-mcp": {}, "panos-mcp": {} },
  "mcp_node":    { "node-typesafe": {}, "node-auvik": {} }
}
```

**Passing a real record** rather than describing it: hand Jev the schema row, the
`package.json` fragment, or the config object directly as `state` or as criteria. Do not
serialize it into a sentence first.

---

## Autoresearch loop

**When.** A project uses Jev enough that the fixed question set is worth improving. This
is a maintenance activity for whoever owns the atlas config - **not** something an agent
runs during a task.

**Why.** The standard four questions are a reasonable prior, not a tuned instrument. If a
project has labelled outcomes - diffs that later needed a follow-up fix, findings that
turned out to be false positives - those labels can drive better questions than hand-
writing them.

**The loop.**

1. Propose questions (an LLM does this; Jev does not write its own questions).
2. Answer them across the labelled corpus with `typesafe_decide`, one call per item.
3. Fit or score against the known outcome, and record which questions carried signal.
4. Feed the worst-predicted items back into the next proposal round - what separates the
   items the current questions get wrong from the ones they get right is exactly what the
   next question should ask about.
5. Repeat. Most of the gain lands in round one; later rounds refine.

Actions per round are `add`, `revise` (same target, better wording), and `drop` (it is not
earning its slot). The 20-question cap is the budget being competed for.

**Where the result goes.** Into the thresholds and question set in `jev-decisions.md`, in
one reviewable place. Never into scattered per-skill copies.
