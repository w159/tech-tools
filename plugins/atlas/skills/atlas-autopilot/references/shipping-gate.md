# Shipping gate: steps 9-11 (commit, consent, ship)

The tail of the pipeline. This is where atlas-autopilot permanently diverges from
CE's `lfg`: `lfg` commits, pushes, opens a PR, and babysits CI as one autonomous
motion. atlas-autopilot stops after the local commit and asks. Nothing externally
visible happens without an explicit yes from the user, in this conversation, at
this gate. There is no flag, no prior authorization, and no CI urgency that waives
the stop.

## Step 9 - Local commit

Run `atlas-commit` (local only; it never pushes):

- Commit the run-owned files: the change scope, plus the atlas artifacts this run
  produced that belong in the tree - `docs/` updates (CHANGELOG entry, ROADMAP
  reconciliation, lessons), `.atlas/evidence/` captures, the durable
  `.atlas/.run/findings.json` ledger, the plan artifact if one was produced.
- Do NOT commit ephemeral run state (`.atlas/.run/STATE.md`, `work-log.md`).
- Verify the commit landed (`git log -1 --stat`) and the tree is clean of run-owned
  paths before presenting the gate.

**Gate:** a clean local commit. If the commit fails, fix the cause (hooks, staging,
merge markers) within normal effort; do not proceed to the gate with a broken tree.

## Step 10 - STOP: the consent gate

Present the summary and ask. This is a hard stop - the pipeline ends here until the
user answers, and ends permanently if they say no or do not answer.

The summary must cover, compactly:

- **What was done:** source used (plan/defect path), execution verdict with the
  verification evidence paths, simplify counts, review verdict, fixes applied and
  skipped (with filter reasons), residuals written (paths), compound write or skip,
  UI evidence or skip.
- **The commit:** SHA, branch, changed-file summary.
- **What shipping would do:** the branch to push, whether a PR would be opened
  (and its target), and what `atlas-babysit-pr` would watch afterwards.
- **Known risk:** anything from review or testing the user should weigh before the
  push - unapplied findings, budget exhaustion, skipped checks.

Then ask, plainly: push and open a PR, or stop here? A "yes" must be the user's own
words in this conversation. Silence, an unrelated reply, or a change of subject is
a no - end the run with the summary as the final report.

**If the user declines or stops answering:** report DONE-STOPPED with the summary,
the residuals, and the exact command or skill (`atlas-ship`) they can run later.
The work is safe on the local branch; nothing is lost.

## Step 11 - Ship and babysit (only after explicit consent)

With a confirmed yes:

1. **`atlas-ship`** - commit-and-push + PR with its own confirmation model, now
   satisfied. Pass the run context: plan/defect path, the consent-gate summary,
   residual findings (they render into the PR's "Unapplied review findings"
   checklist rather than vanishing).
2. **`atlas-babysit-pr`** on the opened PR, with the CI-repair budget (default 3
   rounds, shared `budget:N` override). CI failures and review comments route
   through `atlas-debug` (convergent fixes) and `atlas-resolve-pr-feedback`;
   divergent or product-shaped feedback becomes a `needs-human` residual - it does
   not get guessed at, and it does not consume the budget guessing.
   - **On budget exhaustion with CI still red or feedback still open:** stop
     babysitting, state plainly what remains broken and what was tried, and leave
     the PR open with the residual state rendered. Never report success with a red
     check; never loop past the budget.
3. **Close out.** Final report: PR URL, babysit outcome (green / stopped-with-
   residuals), budget rounds used, and the complete needs-human list. Update the
   findings ledger with the final state so the next session resumes from evidence,
   not memory.

Merge is never autopilot's act, even after consent - the user merges, or explicitly
asks for merge in a follow-up.
