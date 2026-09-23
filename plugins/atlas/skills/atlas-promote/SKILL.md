---
name: atlas-promote
description: Draft a plain-language announcement for a just-shipped feature or fix - a release note, Slack-style update, or changelog entry grounded in what actually changed. Use after a merged PR, a completed plan, or a recorded lesson, when the user wants the work announced.
when_to_use: a feature or fix just shipped (merged PR, completed docs/plans/ item, or docs/lessons/ entry) and the user wants an announcement or changelog drafted
allowed-tools: Read, Glob, Grep, Bash, Write, Task
argument-hint: '[optional: what shipped and/or channels, e.g. "a release note and a Slack update"]'
---



Apply the Operating Contract to this entire task. It is injected below.

```!
cat "${CLAUDE_PLUGIN_ROOT}/references/operating-contract.md"
```

If the contract did not load above, read `${CLAUDE_PLUGIN_ROOT}/references/operating-contract.md` and apply it before proceeding.

Read `${CLAUDE_SKILL_DIR}/references/announcement-channels.md` for the per-channel shapes and grounding rules, and apply them at drafting time.

Turn something that just shipped into copy-pasteable, plain-language announcement copy, right inside the engineering workflow.

**Done when:** every drafted channel is presented as a labeled, copy-pasteable block, the user has been offered a revision, and any requested changelog recording has been dispatched or completed. **This skill drafts only - it never posts, publishes, schedules, commits, pushes, or opens PRs.** Delivery to any external channel is a human action, always.

Drafting is direct - from the editorial fundamentals in the reference file. No external copy tooling is involved: this skill must never wait on, install, or fail on an external CLI.

## Phase 1 - Establish what shipped

A free-form description in the arguments is the source of truth. Otherwise derive it from context, using what is available and never waiting on any single source (the docs/ + .atlas/ Single Source of Truth defines these paths):

- **Merged/active PR** - `gh pr view --json title,body,url` (the title and body usually state the user-facing value)
- **The diff** - `git diff main...HEAD --stat` (or against the release base), skimming notable changes so the claim is grounded in what actually changed
- **Changelog** - the newest entry in `docs/CHANGELOG.md`
- **Plan artifact** - the matching `docs/plans/<task-slug>.md`, including its verification/evidence sections
- **Lesson** - the matching `docs/lessons/<YYYY-MM-DD>-<slug>.md`
- **Recent commits** - `git log --oneline -15` for the arc of the change

Then write a 1-3 sentence summary of the **user-facing value**: what a user can now do that they couldn't before, and why they'd care. Outcome, not implementation - "Exports any report to CSV in one click", not "Added a CsvSerializer and an export endpoint."

**Grounding rule:** every claim in every draft must trace to the PR, diff, plan, lesson, or changelog entry. No invented capability, no roadmap items stated as shipped, no marketing fluff beyond what the evidence supports. If you cannot confidently tell what shipped, ask one short question rather than guessing.

## Phase 2 - Pick channels

Default to a **release note**, a **Slack-style update**, and a one-line **changelog entry**. If the user named channels - X post, LinkedIn, email, blog intro, demo script - draft those instead of or in addition to the defaults (shapes in the reference file). Scale to the change: a small fix warrants one or two short drafts, a flagship feature a cross-channel set. Don't force a fixed template.

## Phase 3 - Draft the copy

Draft every channel per the shapes and rules in `${CLAUDE_SKILL_DIR}/references/announcement-channels.md`. Core rules that apply to every channel:

- Lead with the user-facing outcome - what someone can now do, not how it was built.
- One idea per piece; plain, declarative sentences. No hype adjectives, no "seamless/revolutionary/game-changing", no exclamation marks.
- Never reuse one draft verbatim across channels - match each channel's native shape and length.
- Internal jargon stays out unless the audience is the dev team (a Slack update to engineers may name the module; a release note may not).

## Phase 4 - Present the drafts

Show every draft as a clean, copy-pasteable block labeled by channel:

```
### Release note
<the copy>
```

Offer to revise (tone, length, angle, more variations, another channel). Remind the user the drafts are theirs to deliver - nothing has been posted anywhere.

## Phase 5 - Record (only on request)

If the user wants the changelog entry recorded in `docs/CHANGELOG.md`, dispatch `atlas:docs-curator` in a bounded Task call using the dispatch spec shape from `${CLAUDE_PLUGIN_ROOT}/skills/atlas-orchestrate/references/subagent-kit.md` (GOAL / CONTEXT / TOOLS with the batched ToolSearch line / NON-INTERACTIVE line / DELIVERABLE / SUCCESS CRITERIA / OUT OF SCOPE / STOP CONDITIONS / REPORT BACK), passing the approved draft entry and the current date. The curator owns `docs/CHANGELOG.md` per the docs SSOT; the skill itself never writes it directly. If the user does not ask for recording, stop after Phase 4 - chat output is the default and complete deliverable.

VERIFY:
- Re-read each draft against the evidence from Phase 1: every claim traces to the PR, diff, plan, lesson, or changelog entry; no invented capability.
- If a changelog recording was dispatched, confirm the curator's report names the exact `docs/CHANGELOG.md` entry written.

REPORT:
- The grounded summary of what shipped and its source (PR, diff, plan, or lesson path).
- Every drafted channel as a labeled block.
- Whether a changelog recording was requested, dispatched, or declined, and its outcome.
- The standing reminder that delivery to any channel is manual.
