---
name: atlas-security
description: "Triages open GitHub Dependabot, code-scanning and secret-scanning alerts, plans one grouped fix on a single working branch, has a fresh verifier confirm each fix, and reports honestly what could not be read or fixed. Use when asked to handle vulnerabilities, security alerts, Dependabot or the security tab."
when_to_use: "dependabot alerts, vulnerabilities, security alerts, code scanning alerts, secret scanning, fix CVEs, bump vulnerable packages, security tab, the session banner says open security alerts"
allowed-tools: Read, Glob, Grep, Bash, Edit, Write, Agent, Task, ToolSearch
argument-hint: '[--kinds dependabot,code,secret] [--repo owner/name] [plan-only]'
---

**atlas-security never commits on the default or a protected branch, never opens one branch or PR per alert, and never pushes or opens a PR without the atlas-ship consent gate.** It reads alerts through `gh`, fixes what code can fix on ONE branch, and reports plainly what it could not read, could not fix, or needs the user for.

Apply the Operating Contract to this entire task. It is injected below.

```!
cat "${CLAUDE_PLUGIN_ROOT}/references/operating-contract.md"
```

If the contract did not load above, read `${CLAUDE_PLUGIN_ROOT}/references/operating-contract.md` and apply it before proceeding.

`plan-only` stops after Step 2. `ATLAS_SECURITY=off` disables the whole feature; say so and stop.

## Step 1 - Fetch alerts and the plan

Run both, from the repo root:

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/atlas_security.py" alerts --json
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/atlas_security.py" plan --json
```

Each kind reports `ok` with a count or `unavailable` with a reason. An unavailable kind is never "0 alerts". Done when both outputs are read and every kind has a status. The secret value is never in the output; never go fetch it.

## Step 2 - Triage in one table

One table, sorted by severity: kind, id, package or rule, severity, fix (target version, "no patch", "rotate", or "unavailable"). Under it, state plainly which kinds could not be read and why (HTTP 403 means the token lacks `security_events` or the feature is off; 404 means disabled or no access; `gh` missing; not authenticated). Offer the one-line fix for the reason (`gh auth refresh -s security_events`, enable the feature in repo settings). Done when the table and the unreadable-kinds note are shown; for `plan-only`, stop here.

## Step 3 - One working branch

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/atlas_git.py" branch security-$(date +%F)
```

It reuses the branch if it exists and honours the branch cap. Never create a branch per alert, never commit on the default branch (the atlas_git guard enforces it; do not work around it with `allow`). Done when `git branch --show-current` prints the working branch.

## Step 4 - Fix by ecosystem group

Dispatch `atlas:implementer` once per ecosystem group (npm, pip, go, cargo, ...) in the enforced shape from `${CLAUDE_PLUGIN_ROOT}/skills/atlas-orchestrate/references/subagent-kit.md`. Each brief carries the exact commands from the plan, the lockfile to regenerate, and the project's real gates (derived from `package.json`, `pyproject.toml`, `Makefile`, CI). A major-version bump with breaking changes is not applied silently: the implementer stops and reports it. Code-scanning alerts: write a failing test or reproduction first where the rule allows it, then fix one rule+path item per change. Secret alerts are not fixed by code (Step 7). Done when each group has a diff plus gate output, or a reported blocker.

## Step 5 - Independent verification

Dispatch `atlas:verifier` in a fresh context (never fork). For each fixed Dependabot alert it must confirm, from the regenerated lockfile, that the installed package version is outside `vulnerable_range`, and that the gates pass. The verifier, not the implementer, decides "fixed". Done when every alert is marked fixed or not fixed with lockfile evidence.

## Step 6 - Local commit

Invoke atlas-ship in commit-only mode with the changed manifests, lockfiles and tests. One conventional commit per ecosystem group at most. Done when `git status` is clean of those files.

## Step 7 - Report

Four lists, evidence-first, no inflated claims:

- **Fixed** - alert id, package, old to new version, verifier evidence.
- **Not fixable** - no patch available (keep the advisory id; suggest pinning, replacing, or accepting the risk with the user's say-so), and failed fixes with the reason.
- **Needs you** - secrets (rotate the credential at its provider FIRST, then remove it from history; Atlas cannot do that by code), major upgrades with breaking changes, dismissals.
- **Unavailable** - kinds that could not be read, with the reason.

Push and PR happen only through atlas-ship's consent gate and the repo's `prs` policy (`atlas_git.py policy`); the default is that the human confirms, and it is one PR for the whole branch. Dependabot closes its own PRs once the default branch contains the fix; list the ones the plan supersedes. Done when the report is shown and the branch state is stated.
