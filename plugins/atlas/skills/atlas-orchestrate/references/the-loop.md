# The Loop

Load from atlas-orchestrate when the matching trigger fires. Content is authoritative for the skill.

The orchestration loop

## The loop

Flex the shape to the task; a quick fix may collapse to two waves, a full audit may iterate 1-4 many times. The loop runs **forward and backward** - if a later fix invalidates an earlier check, re-run that earlier check before proceeding. **No step is optional for a shipping change.**

0. **Orient (you, cheap).** Detect project + codebase roots (dirs with their own manifest). Read the *actual* run/test/build/lint commands from those manifests - never invent them. **RECALL is a precondition to planning, not an optional nicety:** before you decompose any substantive task you MUST query `claude-mem` (`mem-search`) and `ctx_search` - and the committed `.agents/` notes if present - for prior work, decisions, and gotchas on *this task + this project*, and your orientation MUST either cite what you found (source + the lesson you are reusing) or state explicitly "no prior work found". Then record the recall outcome once so run health reflects it: `python3 "${CLAUDE_PLUGIN_ROOT}/scripts/atlas_db.py" record-recall "${CLAUDE_CODE_SESSION_ID}" hit` if recall surfaced a usable lesson, else `... miss` (fail-open: skip silently if the command is unavailable). Skipping recall and re-deriving a gotcha that memory already held is a violation of this step. Note live `serena`/LSP/MCP/skill capabilities. Scaffold per-root `docs/` artifacts. On boot or resume, reconcile recent work against docs/ per `${CLAUDE_SKILL_DIR}/references/session-lifecycle.md` before planning new work. Present a 5-10 line orientation + plan. **Gate before mutating anything.**
1. **Plan (you, `sequentialthinking` for non-trivial; `atlas:planner` for real decomposition).** Produce a **numbered stage map**: each stage yields exactly one verifiable artifact and names a **failable check** (the exact condition that would make the stage fail). The map is a **living document** in `docs/plans/` - update it as reality diverges. **Mirror it into `TodoWrite` immediately** (one todo per stage, see "The visible plan") - the stage map is for you, the todo list is for the user. Per stage, also fix: agent type, model tier, mandatory tools/skills. Ambiguous *feature* work routes through `brainstorming` -> `make-plan` first. See `references/multi-stage-planning.md`.
2. **Dispatch (subagents, parallel).** Tight spec from `references/subagent-kit.md`, including the output contract from Token discipline. Each self-discovers best-fit capabilities, pulls Context7 docs for any library it touches, **executes to validate**, returns a short grounded report.

   **Batch independent dispatches in ONE message (Law 2 is mechanical, not aspirational).** If stages A, B, C have no data dependency on each other, you MUST dispatch all three in a single assistant message with three `Agent` tool calls. One-agent-per-message is a Law 2 violation even if the eventual work is correct: the metric `parallel_waves` in the observability DB measures this directly, and sequential dispatch is the single most common reason runs stall. Before writing the message, ask yourself: "Can any of these stages start without the output of another?" If yes for all, they go in one message. If only some are independent, fan out the independent set in one message and serialize the rest.
3. **Verify (separate subagents) - the failable gate.** Run each stage's named failable check in a fresh context per law 5: reproduce the original failing case, derive an independent check, observe the result. This step asks "does the check pass on real execution?" - not "do I believe it works." **Write a `.atlas/.run/findings.json` entry for every implementer→verifier pair** so coverage is measurable and the completion gate's condition (g) has data to enforce. The format:

   ```json
   {"stages": [
     {"id": "S1", "implementer": "atlas:implementer", "verifier": "atlas:verifier",
      "status": "verified|rejected|pending", "evidence": ".atlas/evidence/<file>.md",
      "verifier_verdict": "confirmed|refuted|needs-evidence"}
   ]}
   ```

   **Mechanical rule: every `atlas:implementer` dispatch owes an independent check before any dependent stage starts - no exceptions, no "it's trivial."** What you owe is the *check*, not necessarily a second subagent. Two things satisfy it and they are interchangeable:

   - **A deterministic test run (the default).** The implementer runs the project's gate; you record the outcome with `python3 "${CLAUDE_PLUGIN_ROOT}/scripts/atlas_finding.py" --id <stage> --status verified --evidence "<test id>" --reproduction "<command>"`. A `verified` entry stamped during this run pairs an implementer exactly like a verifier dispatch does. A test cannot hallucinate, cannot be captured by a hook, and returns in seconds.
   - **An `atlas:verifier` dispatch (the exception).** Reach for it when no test can express the check - runtime behavior, a data claim, a security property, a docs-versus-code consistency question - and say in one line why.

   The completion gate blocks Stop on `max(0, unpaired_implementer_dispatches - verified_findings_stamped_this_run)`. A stage with neither a recorded test result nor a verifier dispatch is `pending`, not `verified`, and pending stages block dependents.

   **Right-size the wave.** One bounded change with a gate that can prove it is ONE implementer dispatch and a recorded test result - not a squad. Multi-surface or multi-stage work gets waves. What this never licenses is doing the work yourself because it is small: a one-line change is still an `atlas:implementer` dispatch. Delegation exists to keep your context clean, and that argument is strongest on small changes, where the reading-and-editing noise dwarfs the diff.

   **A subagent's `DECISION NEEDED:` is a hard stop, not a note.** A blocked subagent returns `DECISION NEEDED: <question + options>` instead of guessing (see `subagent-kit.md`). When you see that in a returned report, your very next action is `AskUserQuestion` with those options - before any further dispatch, before synthesis, before the wave continues. Relaying it as a line of prose in a long report is how decisions get lost: the user is watching output scroll, not reading it. If several agents in one wave came back blocked, batch their questions into a single `AskUserQuestion` call.

   **Subagents never dispatch subagents.** `Agent` (and legacy `Task`) are removed from every atlas agent's toolset and denied by the dispatch tripwire from any subagent context. If a returning agent says it needs another role, YOU dispatch it. **Per-stage gate (not just end-of-session):** a stage's dependents MUST NOT start until that stage is marked `verified` by an independent `atlas:verifier` (or specialist) in a fresh context, per law 5, in `.atlas/.run/findings.json`. A stage marked `rejected` *blocks its dependents* - send it back to a fresh implementer with the failure attached and re-verify before any dependent runs. This gate sits on the Verify step itself; it is upstream of, and additional to, the end-of-session completion gate below.
4. **Self-critique (skeptical pass).** Distinct from step 3: assume the change is wrong and hunt for the case that breaks it - missed negative case, off-by-one, a sibling code path, an earlier check the fix may have invalidated. Before declaring done, run an `atlas:completeness-critic` "what did we miss" pass over the whole change set. Introspection is not verification; this pass exists to find what the failable gate did not think to check.
5. **Synthesize (you, Opus-tier reasoning).** Integrate verified results, update `.atlas/.run/STATE.md` + `findings.json`, dispatch `atlas:docs-curator` to reconcile durable docs/, decide the next wave or finish.
6. **Gate writes.** Present any write/migration/cross-boundary action with blast radius + rollback before executing.
7. **Finish only through the gate below.**


## Mechanisms for repetition and large fan-out

When the work is *recurring or iterative* (poll a deploy, refine until a condition converges, sweep a backlog), do not hand-roll the cadence: invoke the `atlas-loop` skill to match the task to a curated **loop-library** entry and instantiate it - interval and self-paced loops hand off to the built-in `/loop` skill; fan-out loops run as a bounded parallel-plus-verify wave. For a *large deterministic fan-out/verify pass* (an audit, a sweep over many items, the same check applied across a whole surface), run it as a **Workflow**: the atlas fan-out pattern dispatches N independent subagents in a single message (concurrency-capped ~4-6 in flight), closes each wave with an independent adversarial `atlas:verifier`, and repeats wave-by-wave until the queue is drained - resumable from `.atlas/.run/work-log.md` and `findings.json` if interrupted. The per-stage gate (step 3) governs each wave: a stage's dependents wait on its `verified` mark.


## Definition of done - the completion gate

You may **not** claim a change is done, fixed, working, or complete - and may not stop - until, for **every** shipping change, all four hold:

- an **execution-evidence artifact** under `.atlas/evidence/` that shows the *originally failing case now correct* - a red->green / before->after capture (the bug reproduced, then the same input passing), not merely that some command ran or a file appeared; and
- an **independent verifier report** from a *different* agent than the author, one that re-derived its own check from the original symptom (law 5); and
- **runtime evidence, not only test evidence.** For any user-facing change (page, flow, endpoint the user will click), an `atlas:ui-runtime-tester` pass against the running app is part of the *same wave's* verification - never a close-out garnish after all implementation waves. For any schema-touching backend change, the verifier confirms migration parity with the environment the user actually runs (tests that `create_all` their own schema prove nothing about it). A wave whose verifiers only saw green unit suites has not verified the wave; and
- **docs/ is current** - `CHANGELOG.md` and `ROADMAP.md` reconciled, and every affected durable subfolder (`architecture/`, `features/`, `specs/`, `audits/`, `lessons/`, etc.) updated by `atlas:docs-curator`. This is mandatory and gate-enforced, not optional cleanup. Session start and end follow `${CLAUDE_SKILL_DIR}/references/session-lifecycle.md`: reconcile docs/ at start; at end a docs-curator moves every completed ROADMAP task to CHANGELOG with date and evidence.

**Close-out, in this order, before you say done.** Steps 1 and 2 are not advice: the completion gate enforces them as conditions (i) and (j), so a run that skips them is blocked at Stop, not merely non-compliant.

1. **Re-read the todo list.** Every item `completed`, or you name the exception out
   loud. An item still `in_progress` or `pending` means the run is not finished -
   this check is what stops a stage from being silently dropped.
2. **Close every worktree you opened.** A run that fans out writers leaves `git
   worktree` trees behind; they are not self-cleaning once they contain changes.
   For each one `git worktree list` still shows: **commit inside the worktree first
   if it is dirty** - `git -C <tree> status --porcelain` non-empty means uncommitted
   work that a merge would silently skip and `worktree remove --force` would
   destroy - then merge it into the local working branch (`git merge --no-ff
   <worktree-branch>`), then `git worktree remove` it and delete the merged branch.
   A worktree with a conflict is a blocker to report, not something to discard.
   Leaving trees behind is an incomplete run.
3. **Offer the push; never take it.** After merging, state the branch and the commit
   count and ask whether to push. `git push` is a law-6 write: it happens only on an
   explicit yes, in this message, for this push. Never push on your own initiative,
   and never treat an earlier approval as standing consent for a later push.

**"Unverified" is not a completion state.** If you cannot produce the artifact, the change is **not** done - say so explicitly and stop; do not declare success and do not let "mark it unverified" stand in for verification. Run `superpowers:verification-before-completion` at the close. The completion-gate `Stop` hook (`references/hooks-automation.md`) is the machine backstop for these conditions (plus ROADMAP/README presence and a code-changed-but-docs-didn't drift check); it is opt-out (on by default when `docs/` exists and the run is flagged orchestrating; disable with `ATLAS_GATE=off`).


