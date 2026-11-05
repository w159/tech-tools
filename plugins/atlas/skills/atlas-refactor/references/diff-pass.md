# Diff mode: post-implementation simplification pass

Loaded by `atlas-refactor` when the request is to simplify, tidy or clean up a fresh diff (blank arguments, `base:<ref>`, or named files that were just changed) rather than to restructure a named target.

## Contents

- [Step 1 - Resolve scope](#step-1---resolve-scope)
- [Step 2 - Dispatch exactly three read-only reviewers](#step-2---dispatch-exactly-three-read-only-reviewers-in-parallel)
- [Step 3 - Triage findings](#step-3---triage-findings)
- [Step 4 - Apply via atlas:implementer](#step-4---apply-via-atlasimplementer)
- [Step 5 - Verify via atlas:verifier](#step-5---verify-via-atlasverifier-gate-re-run)
- [Step 6 - Report](#step-6---report)

Simplify recently changed code for clarity, reuse, quality, and efficiency while preserving exact behavior. Prioritize readable, explicit code over compact code - fewer lines is not the goal. This is a bounded POST-IMPLEMENTATION simplification pass over a fresh diff: the change already works and this pass trims it without changing what it does. It does not restructure (that is the target mode of `SKILL.md`), review (that is `atlas-audit` / the review wave), or fix bugs (that is `atlas-debug`).

Dispatch uses the Task/Agent subagent-kit envelope; verification is an independent `atlas:verifier` plus `.atlas/.run/findings.json`. **Never push, open a PR, or merge** - this skill ends at local verification; commits and pushes stay user-gated like every atlas skill.

## Step 1 - Resolve scope

Resolve the simplification scope in this order; user-named scope is authoritative and never widened:

1. `$ARGUMENTS` names files/directories or describes a scope -> that scope. `base:<ref>` diffs against `<ref>`.
2. In git: the current branch versus its base (`git diff "$(git merge-base HEAD <base>)"`). Without a usable base:
3. Staged and unstaged changes (`git diff HEAD`).
4. Outside git or no diff: files the user named or that were edited earlier in this conversation.

If none of these yields a non-empty scope, ask ONE AskUserQuestion (what to simplify) rather than guessing.

**Preflight - kind of change, never size.** Drop documentation, generated or vendored files, dependencies and lockfiles, and mechanical-only churn from the scope; for mixed scopes keep only the code. Explicit small scopes still run. If nothing substantive human-authored remains, report that there is nothing to simplify and stop - no reviewers.

## Step 2 - Dispatch exactly three read-only reviewers in parallel

Create the run evidence directory: `.atlas/evidence/simplify/<YYYY-MM-DD>_<slug>/`.

Read all three persona prompt assets IN FULL, fill `{{SCOPE}}` in each with the resolved diff or file set, and dispatch each as a Task/Agent call in ONE message so they run concurrently:

- `${CLAUDE_SKILL_DIR}/references/personas/code-reuse-reviewer.md`
- `${CLAUDE_SKILL_DIR}/references/personas/code-quality-reviewer.md`
- `${CLAUDE_SKILL_DIR}/references/personas/efficiency-reviewer.md`

Before dispatch, replace the `{{TOOLS_BLOCK}}` and `{{NON_INTERACTIVE}}` lines in each persona (read-only: drop the `Edits:` line) with the matching block from the "Shared TOOLS and NON-INTERACTIVE blocks (inlined at dispatch)" section of `${CLAUDE_PLUGIN_ROOT}/skills/atlas-orchestrate/references/subagent-kit.md`; a prompt that still contains a placeholder is malformed. Pass each file's FULL content (placeholders filled) verbatim as the subagent prompt. Do not paraphrase the rubrics from memory - the exact rules are what keep the pass behavior-preserving. Exactly three reviewers: no more, no fewer.

- **Envelope.** Each persona file already embeds the required dispatch shape (GOAL / DELIVERABLE / SUCCESS CRITERIA / OUT OF SCOPE / STOP CONDITIONS) per `${CLAUDE_PLUGIN_ROOT}/skills/atlas-orchestrate/references/subagent-kit.md`; fill the placeholder and dispatch as-is.
- **Read-only.** Reviewers get no Write/Edit/Agent/Task tools.
- **Independence.** Reviewers share the scope but never see each other's findings.
- **Bounded dispatch.** Launch all three in one message. A concurrency-limit error means the harness is full, not that the reviewer failed: queue and retry after a slot frees. If a dispatch cannot recover, run that persona inline with the same prompt content and disclose the substitution.
- **Tier.** Sonnet / low effort - the read-only reviewer tier per subagent-kit's companion table.

## Step 3 - Triage findings

Read `${CLAUDE_SKILL_DIR}/references/diff-pass-apply-and-verify.md` and apply its triage rules: apply only worthwhile, provably behavior-preserving findings at confidence 75+; record false positives and low-value findings as skipped without asking the user; never simplify away a safety check; honor session-settled structure pins from plan artifacts; keep edits inside the mutation boundary (scope + the import/export lines it needs).

## Step 4 - Apply via atlas:implementer

Group accepted findings by file and dispatch `atlas:implementer` - one dispatch per independent file group, all groups in ONE message when independent, `isolation: "worktree"` only when groups truly collide on the same files (capped by `max_worktrees`, `${CLAUDE_PLUGIN_ROOT}/references/git-policy.md`) (per subagent-kit's conflict-check). Each implementer receives its files' exact findings (location, evidence, fix, autofix class) and edits only inside the mutation boundary. The orchestrator never edits target code directly. Done when every accepted finding is applied or reverted.

## Step 5 - Verify via atlas:verifier (gate re-run)

Dispatch `atlas:verifier` in a FRESH context (never a fork) to re-run the project's real gate as full blast-radius verification, exactly like the VERIFY phase of `SKILL.md`: project-wide typecheck and lint, then tests matched to blast radius (scoped for local changes, broader for shared/wide-reach changes, full suite when the runner cannot scope). The verifier adversarially confirms each applied fix is behavior-preserving and stamps `.atlas/.run/findings.json` via `python3 "${CLAUDE_PLUGIN_ROOT}/scripts/atlas_finding.py"`. A `rejected`/`needs-evidence` verdict sends the responsible finding back to a fresh implementer or reverts it, then re-verify. If no gate is configured, the report must say so explicitly.

## Step 6 - Report

Read the report format in `${CLAUDE_SKILL_DIR}/references/diff-pass-apply-and-verify.md`. Report what was already sound and what improved; applied counts by category (reuse / quality / efficiency), skipped count with reasons, gate commands with actual output, and the verifier verdict with its findings.json row id. If nothing changed, say so. Net lines removed is never the success metric.
