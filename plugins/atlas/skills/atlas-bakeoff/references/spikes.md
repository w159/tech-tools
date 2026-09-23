# Phase 3 — Proof-of-concept spikes (optional)

Spikes exist because some comparisons cannot be settled by reading: does the migration actually preserve the query pattern? Is the library's streaming API usable under our backpressure? Does the data-model shape express the hot query without a join explosion?

## When to spike — the uncertainty test

Spike a claim only when ALL of these hold:

1. **Decisive**: the score on a named criterion could flip the recommendation based on this claim.
2. **Genuinely uncertain**: reading docs or code did not settle it — you would otherwise be asserting an `unverified` score as if it were known.
3. **Cheap**: the spike fits in a bounded scratch exercise (minutes, not days), in throwaway files or a throwaway branch.

If a claim is decisive but NOT cheap to check, do not spike it — return it as an explicit evidence need in the final report and let the recommendation carry that caveat. If it is cheap but not decisive, skip it; a bake-off is not a playground.

## How to run a spike

Dispatch `atlas:implementer` with a bounded brief (the subagent-kit schema, with the implementer's write scope explicitly confined):

```
ROLE: spike engineer - throwaway proof-of-concept, no production impact
GOAL: answer ONE question with a running result: <the uncertain claim, stated falsifiably>
CONTEXT: the candidate mechanism it belongs to, the criterion the claim feeds, the file/paths the
  experiment draws from. The claim to test, verbatim, with what "confirms" and what "refutes" it.
TOOLS: [batched ToolSearch line per subagent-kit; implementer write tools]
DELIVERABLE: the spike script/scratch files plus a short writeup: what was run, the actual output,
  and the verdict (claim confirmed | refuted | inconclusive + why).
SUCCESS CRITERIA: the question is answered by command output, not reasoning; everything written lives
  under the designated scratch location; the local gate still passes with scratch present.
OUT OF SCOPE: production source edits - package installs beyond the dev sandbox - git push - PRs - merges
STOP CONDITIONS: the spike needs > the time budget, or requires touching production code to be
  meaningful - report inconclusive with the reason instead of escalating scope.
REPORT BACK: verdict + evidence path. SCHEMA: spike-report v1
  claim: <verbatim>
  verdict: confirmed|refuted|inconclusive
  evidence: <cmd + output or evidence path under .atlas/evidence/<YYYY-MM-DD>-<slug>/>
  residue: <exact list of files/branches created, for cleanup>
```

All independent spikes go out in one message, in parallel. Spikes for different candidates never share a scratch location.

## Isolation and residue rules

- **Scratch location**: throwaway files under a clearly temporary path (e.g. `/tmp/<slug>-spike/` or a gitignored `spikes/` dir), or a throwaway git branch when the experiment must live inside the repo's build/tooling context. Name branches `spike/<YYYY-MM-DD>-<slug>` so origin is obvious.
- **Never push, never open a PR, never merge, never touch production source.** A spike that cannot run without mutating production code is by definition not cheap — convert it to an evidence need.
- **Cleanup is mandatory and verified**: after the bake-off concludes, delete scratch files and throwaway branches (`git branch -D spike/...` is a local-only destructive op on a branch created by this run — that is the one deletion this skill performs without further confirmation). Verify with `git branch --list 'spike/*'` returning empty and the scratch dir gone.
- **Evidence that matters is preserved before cleanup**: copy the run output the verdict rests on into `.atlas/evidence/<YYYY-MM-DD>-<slug>/` before deleting the scratch. A refuted-then-deleted spike with no retained output proves nothing.

## Feeding the comparison

A confirmed claim turns its criterion score from `unverified` to scored WITH the evidence path cited. A refuted claim scores the criterion on the refutation — and if the refutation kills a hard constraint, the candidate is eliminated and the report says so plainly. An inconclusive spike stays `unverified` and becomes a named evidence need; it never silently rounds to `adequate`.
