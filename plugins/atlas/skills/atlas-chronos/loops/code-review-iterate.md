---
id: code-review-iterate
name: Code review iterate
category: review
cadence: self-paced
inputs:
  - pr_ref: the pull request under review (number or URL)
  - feedback_source: where review comments and CI status appear
  - address_owner: who applies the requested changes (atlas:implementer in a session)
  - merge_definition: approved, CI green, and merged (or ready to merge)
---

# code-review-iterate

Drive a pull request through review rounds until it is approved and mergeable. Each round: read the latest feedback and CI status, address every actionable comment, push, re-request review. Self-paced because you advance only when a round is fully addressed - not on a timer. The loop ends at approval plus green CI, not at "comments replied to."

## Steps

1. **Read the round.** Pull current review comments and CI status from `feedback_source`. Separate actionable change requests from questions and nits.
2. **Address every actionable item.** Route the changes to `address_owner`. For each comment, make the change or reply with the reason it should not change - never leave an actionable comment silently unaddressed.
3. **Verify locally.** Run the project gate (lint/typecheck/test/build) before pushing so the next CI round is not a re-run of the same failure. Per atlas-metis law 5, confirm the gate result with an independent re-run in a fresh context (dispatch `atlas:verifier`) rather than `address_owner` self-attesting that the round is green before push.
4. **Push and re-request.** Push the round, re-request review, update the PR description if scope shifted.
5. **Decide (self-pace).** If approved and CI is green, finish (gate before merge). If new feedback arrived, go to step 1 for the next round.

## Stop condition

The PR is approved with green CI and ready to merge (`merge_definition`), or it is blocked on a reviewer/decision and reported.

## Template (self-paced /loop)

```
/loop Read the latest review comments and CI status for <pr_ref> from <feedback_source>. Address every actionable comment (change it or reply why not), run the project gate locally, then push and re-request review. If approved with green CI, stop (gate before merge). If new feedback arrived, continue with the next round; if blocked on a reviewer, stop and report.
```

Omit the interval to self-pace each round. Pushing writes and merge is the final gate - stop for approval before merging.
