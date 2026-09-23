---
name: atlas-ship
description: Ship finished work end to end - verify a clean, gate-passing tree with a fresh-context atlas:verifier, make the local commit via the atlas-commit contract, then STOP and require an explicit user confirmation before any push or PR open. PR creation goes through the github device pr_create op with a body grounded in the actual diff plus any linked plan or finding; CI watching is offered as an explicit atlas-babysit-pr handoff, never automatic. Without a git remote, stops at the local commit and says so plainly.
when_to_use: commit verified work and, only after explicit user confirmation, push it and open a PR
allowed-tools: Read, Glob, Grep, Bash, Edit, Write
argument-hint: '[exclude:<paths>] [description-only] [babysit:off|checkpoint]'
---

**atlas-ship never pushes, opens a pull request, edits a PR body, or performs any remote write without an explicit user confirmation at the point of risk; the local commit is the only step that ever runs without asking.** This is the deliberate inversion of CE's `ce-commit-push-pr`, which treats the act of invoking it as authorization to publish. In atlas, invoking this skill authorizes verification and a local commit only - the push and the PR are decisions the user owns, made fresh each time, in the conversation, after seeing what would leave the machine.

Ported from CE's `ce-commit-push-pr` (Steps 1-5 plus `context.md`, `commit-and-push.md`, `pr-description-writing.md`, `apply-and-handoff.md`). Deliberately NOT ported: the auto-push/auto-PR posture itself, stack mode and its postures, the branding badge block, the `ce-noslop` composition pipeline (atlas composes directly from the diff), and the automatic babysit handoff (CE's run is "not done" until its babysitter owns the PR; atlas asks, and a declined watch is a successful terminal). Where CE trusts `gh` probes alone, PR creation here goes through the `xd://github` device (`pr_create` op) with `gh` as fallback.

Apply the Operating Contract to this entire task. It is injected below.

```!
cat "${CLAUDE_PLUGIN_ROOT}/references/operating-contract.md"
```

If the contract did not load above, read `${CLAUDE_PLUGIN_ROOT}/references/operating-contract.md` and apply it before proceeding.

## Modes

- **Full workflow** (default) - Steps 1-6: resolve state, verify, commit locally, confirmation gate, push + PR, optional babysit handoff.
- **Description-only** - the user wants just a description ("write a PR description", "describe this PR"). Run Step 1 for the range, compose per `references/pr-body.md`, print the title and body, and stop. Nothing is applied unless the user separately asks, and then only through the Step 4 gate.
- **Description update** - refresh an existing PR's body, no push intent. Compose, preview the exact new title/body against the existing one, and apply via the device only after an explicit yes at the Step 4 gate (same rule as a push; a PR-body edit is a remote write).

## Step 1 - Resolve repository state

Read `references/repo-state.md` and run its probe sequence first - one argv-form call per probe, exit status as control flow, everything a snapshot re-verified before each consequential action. Decisions it drives:

- **Not a git repo** - report and stop.
- **No remote configured** - the shipping path ends at the local commit. Say so plainly up front ("No git remote - this ship stops at the local commit"), still run Steps 2-3 so the work is verified and committed, then report the end state. Never attempt a push, never ask a confirmation question whose answer cannot change anything.
- **Open PR already exists for this branch** - the push (after consent) lands on it; skip `pr_create` and offer the description update instead.
- **PR state unknown** (device or `gh` errored) - resolve auth/connectivity first. A failed probe is never "no PR"; never risk opening a duplicate.
- **Detached HEAD, or on the default branch with work** - create a feature branch automatically (name derived from the change content; add a non-conflicting suffix if taken), re-read `git branch --show-current`, and continue. Do not ask whether to branch. On the default branch with no work - report and stop.
- **Feature branch** - continue.

## Step 2 - Verify a clean, gate-passing tree (compose atlas:verifier)

Before anything is committed, an independent context confirms the tree is shippable. Dispatch `atlas:verifier` in a fresh context (never fork - it must carry none of this session's assumptions) using the enforced dispatch shape from `${CLAUDE_PLUGIN_ROOT}/skills/atlas-orchestrate/references/subagent-kit.md` (single `GOAL:`, `DELIVERABLE:`, `SUCCESS CRITERIA:`, `OUT OF SCOPE:`, `STOP CONDITIONS:`, batched `ToolSearch` line). Its scope:

1. **Project gates** - run the project's active gates exactly as its `AGENTS.md`/`CLAUDE.md` defines them (tests, lint, typecheck). Evidence is command output, not "should pass".
2. **Diff inventory** - `git status` plus the full diff of what would be committed: the material this Step 3's message and Step 5's PR body are grounded in.
3. **Docs-current status** - when `docs/` exists: `docs/CHANGELOG.md` entry present for the change, `docs/ROADMAP.md` reconciled. Missing docs-current is reported as a residual for the user to waive or fix - never silently shipped, never auto-expanded into a docs task mid-ship.

End the dispatch with the verifier contract line: "Write your verdict (PASS/FAIL plus evidence paths) to `.atlas/.run/findings.json` before returning. A response without a findings.json write is invalid." After the return, re-read `.atlas/.run/findings.json`; an absent or truncated verdict means re-dispatch, not proceed.

- **FAIL on a gate** - do not commit or ship a red tree. Route the failure through `atlas-debug` (or an `atlas:implementer` fix round) and re-verify. Stop and report if the fix is out of this ship's scope.
- **PASS with residuals** - continue; the residuals ride into the Step 4 confirmation ask.

If `git status` shows nothing to commit, report that and stop.

## Step 3 - Commit locally (compose atlas-commit)

Hand the verified diff to the `atlas-commit` skill (same plugin, `plugins/atlas/skills/atlas-commit/SKILL.md`) via the host's normal skill-invocation mechanism, passing the named files and any `exclude:<paths>` from the invocation. Its contract applies verbatim: stage named files only, never `git add -A`/`git add .`, message grounded in the actual diff, `fix:` over `feat:` when ambiguous, plan unit IDs appended when already in hand, `exclude:` files left out and reported, trailing path list on `git commit`, message written to a file and applied with `git commit -F`.

If `atlas-commit` cannot be loaded, apply its inline core yourself and say so in the report: named-files staging, one logical change per commit (file level, 2-3 max, no `git add -p`), message file + `git commit -F <file> -- <files>`, confirm with `git status`.

Report the commit hash(es) and subject(s), and state plainly: **local only so far - nothing has left this machine.**

## Step 4 - STOP: the push/PR confirmation gate

This step does not exist in CE. Present one message containing:

- the commit hash(es) and subject(s) about to ship;
- the branch and the target remote (or "no remote - nothing to confirm, ship ends here");
- exactly what will happen on yes: `git push -u origin HEAD`, then a PR from `<head>` to `<base>` titled `<title>` whose body leads with `<first sentence>`;
- any verifier residuals (including docs-current gaps) the user would be waiving.

Then wait. Full consent mechanics - what counts as an explicit yes, what never counts, the one-action scope of a confirmation - are in `references/push-gate.md`.

- **Explicit yes** - continue to Step 5.
- **No, silence, or an unrelated reply** - report the local commit as the end state and give the user the exact commands to run themselves (`git push -u origin HEAD`). This is a successful terminal, not a failure. A later "ship it" re-enters at Step 5 with a fresh re-verification.
- **No remote** - skip this step entirely and report the local commit as the final state.

## Step 5 - Push and open the PR (only after explicit yes)

Re-verify at the point of risk (CE's snapshot rule): branch is still the intended one, remote still present, PR presence re-checked immediately before create - a "no PR" from Step 1 is a stale snapshot, and a PR that appeared since (or was missed by an unknown-state probe) means take the existing-PR path, never open a duplicate.

1. **Push** - `git push -u origin HEAD`, pushing the live HEAD, never a remembered branch name. Never `--force`/`--force-with-lease`. If the remote rejects as non-fast-forward, stop and report - resolving remote-history divergence (fetch/rebase/push-again) is a fresh user decision, not this skill's.
2. **Compose the PR title and body** per `references/pr-body.md`, grounded in the actual three-dot diff (`base...HEAD`) and any linked artifacts already in hand: `docs/plans/<slug>.md`, `.atlas/findings/<YYYY-MM-DD>-<slug>.md`, verified entries from `.atlas/.run/findings.json`, the plan unit IDs on the commits. Never a generic summary; never invented `Fixes`.
3. **Create via the github device.** Write JSON to `xd://github` with `op: "pr_create"`, `title`, `body`, `head: <current branch>`, `base: <default branch>` (pass `repo` when the checkout's default remote is not the target; `draft: true` only if the user asked for a draft in the confirmation). Bash `gh pr create` is the fallback only when the device is unavailable - and then the body goes via `--body-file <path>`, never stdin or `--body "$(...)"` (`gh` exits 0 with an empty body). On the device path, pass the body text directly; do not round-trip through a shell heredoc.
4. **Report** the PR URL, the shipped commit range, and the residuals the user waived.

## Step 6 - Babysit handoff (only if the user wants it)

CE auto-hands every published PR to `ce-babysit-pr`; atlas offers it. After the PR URL, one line: CI watching is available via `atlas-babysit-pr` (checkpoint tick or sustained watch) - want it? Only on a yes, invoke `atlas-babysit-pr` naming the PR (pass `checkpoint` when the user wants one tick and a report). It then owns the watch and holds its own push-consent gate for any fix it makes - hand off cleanly, do not run watch mechanics yourself, and do not substitute `gh pr checks --watch`, a poll loop, or a promise to check later.

A declined watch is the successful terminal of this skill: the PR URL plus the Step 7 report is done. If the user wants watching but `atlas-babysit-pr` cannot load, report that blocked - never improvise a narrower watch.

## Step 7 - REPORT

- Verifier verdict and its findings.json evidence path; residuals waived by the user.
- Commit hash(es) and subject(s) (or "nothing to commit").
- The confirmation exchange: what was asked, what was answered (or that it was never reached - no remote).
- Push and PR results with the URL, or the exact local-only end state with the user-runnable commands.
- Babysit ownership: handed off (with mode), declined, or unavailable.

Never say "shipped" for a state that is only committed locally; never say "done" for a state that skipped the gate without saying the gate was skipped and why.
