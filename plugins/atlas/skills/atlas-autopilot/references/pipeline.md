# Pipeline: steps 1-8 (source gate through UI testing)

Per-step contracts for the autonomous portion of atlas-autopilot - everything from
intake up to (but not including) the local commit. The shipping tail is a separate
contract: `shipping-gate.md`. Step numbers here match the pipeline table in SKILL.md.

## Step 1 - Intake routing

Classify the invocation into exactly one route, in this precedence order. Do not
reclassify later; if new information changes the route, stop and re-run intake.

| Precedence | Input looks like | Route |
|---|---|---|
| 1 | A named `atlas-plan` artifact (`docs/plans/<date>-<slug>-plan.md`) with U-ID implementation units | **Plan route.** Validate it is implementation-ready (units present, per-unit verification defined, no open blocking questions). A requirements-only or plan with unresolved blocks is NOT a valid source - send it back through `atlas-plan` (or `atlas-brainstorm` if the shape itself is unsettled). |
| 2 | A diagnosed defect return from `atlas-debug` (root cause named, fix verified, scope isolated) | **Defect route.** Only a `fixed`-status verified return advances. A `diagnosed-no-fix`, `needs-human`, or `blocked` return stops the pipeline: report the diagnosis and stop. |
| 3 | A raw task with settled shape but no plan | **Plan-first route.** Run `atlas-plan` to produce the implementation-ready artifact, then continue as route 1. If the product shape is unsettled (competing approaches, undefined UX, a fork the user must own), run `atlas-brainstorm` first and stop there - brainstorm's output is a human decision, not pipeline fuel. |
| 4 | A non-code request (docs, analysis, a question, an audit) | Route to the owning skill (`atlas-explain`, `atlas-audit`, ...) and end the pipeline. Autopilot is for code work. |

Sanitize what passes downstream: child skills and agents receive the plan path or
defect summary plus only the context they cannot derive themselves. Never paste
artifact bodies into dispatch prompts - pass paths.

## Step 2 - Execution gate

Hand execution to `atlas-orchestrate`. It owns the dispatch waves (`atlas:implementer`
for writes, `atlas:verifier` for independent confirmation), the worktree isolation,
and the evidence capture. This skill does not implement, and does not re-verify what
orchestrate already verified - it checks that the return is genuinely complete:

- Every plan U-ID (or the defect's owning-layer fix) attempted, with receipts.
- Independent verification: verifier verdicts stamped in `.atlas/.run/findings.json`,
  runtime/red-green proof under `.atlas/evidence/<YYYY-MM-DD>-<slug>/`.
- No `DECISION NEEDED` items left uncollected. If orchestrate's waves surfaced
  user-owned decisions (product forks, destructive scope), collect them, and route
  any genuine product-shape question to `atlas-brainstorm` (hard line 3). Collect
  non-shape decisions yourself, batched, and re-dispatch.

**Gate:** a complete, verified return advances. A partial return gets one bounded
recovery re-dispatch with the failure attached; a second failure stops the pipeline
with a plain report. Never advance on "should work."

## Step 3 - Simplify

Run `atlas-simplify` on the change scope (branch diff or fix scope).

- **Skip** when the change is docs-only or the diff is under ~10 changed lines -
  there is nothing to simplify and the pass costs more than it can save. Record the
  skip and the reason; a silent skip is a defect.
- The pass must be behavior-preserving: whatever blast-radius checks the change
  implies (typecheck, tests, captured sample runs) run after simplification and must
  pass before step 4.

## Step 4 - Review

Run `atlas-review` in **report-only mode** (no `apply:local`). This skill never
passes the apply flag; mutation happens only in step 5, under this skill's filter.

Take the report and its validated findings as-is. Do not re-review, do not merge in
your own opinions, do not let severity ranking influence the step-5 filter - the
filter is confidence + mechanicalness, nothing else.

## Step 5 - Apply mechanical fixes (bounded)

Filter the review's findings with BOTH conditions:

1. **High confidence** - the finding is validated (P0/P1 through `atlas:verifier`,
   or confidence 75/100+ and independently confirmed) and the reviewer's evidence
   is concrete.
2. **Mechanical** - the fix is a local, behavior-safe edit with no design judgment:
   dead code removal, a missing guard with an obvious form, a typo, a naming fix, an
   obvious test gap with an obvious home. Anything requiring a decision about how the
   product should behave is NOT mechanical, whatever its severity.

Apply the passing set via bounded `atlas:implementer` dispatches (batch by file,
one wave where independent), each closed by verification of the affected scope.

- **Budget:** default 3 rounds. A round = one implementer dispatch + its
  verification. Count rounds even when a round fixes nothing.
- **On exhaustion with findings remaining:** stop applying. Do not take "just one
  more round." Persist everything unapplied per step 6 and report the budget state.

## Step 6 - Persist residuals

Every finding not applied, every deferred decision, and every budget exhaustion is
written - never dropped, never left only in the review report:

- **Operational record:** a findings entry in `.atlas/.run/findings.json` per
  residual, with the finding, why it was not applied (not mechanical / low
  confidence / budget exhausted / needs a product decision), and its evidence path.
- **Durable follow-up:** items a future session should pick up go into
  `docs/ROADMAP.md` with status `planned` (or `blocked`, with the blocker).
- **Product-shape residuals** route to `atlas-brainstorm` in the summary (step 10),
  not into a silent TODO.

**Gate:** the pipeline may not proceed to compound/commit while any known residual
exists only in the review report text.

## Step 7 - Compound (conditional)

Run `atlas-compound` ONLY when the run produced durable learning that is not already
carried by the code, the tests, the plan artifact, or the defect diagnosis:

- Qualifying: a non-obvious root cause whose failure pattern will recur, a
  convention decision future sessions must honor, a tooling or environment gotcha.
- Not qualifying: what was built (the plan and CHANGELOG carry it), how it was
  verified (evidence carries it), routine fixes (findings.json carries them).

Durable captures land in `docs/lessons/<YYYY-MM-DD>-<slug>.md` per the docs SSOT.
Record an explicit skip with one line of reasoning when nothing qualifies - a skip
is a decision, not an omission.

## Step 8 - UI testing (conditional)

When the change is UI-shaped (routes, components, styles, user-visible behavior):

- `atlas-dogfood` for a self-directed walkthrough of the changed surface.
- `atlas-test-browser` for scripted real-browser verification of the affected flows.

Evidence (screenshots, console/network captures) lands under `.atlas/evidence/` and
is referenced from the run summary. Skip only when the change has no user-visible
surface; record the skip reason. A UI-shaped change with no live-browser evidence
does not pass the step-9 gate.
