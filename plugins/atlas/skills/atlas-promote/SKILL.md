---
name: atlas-promote
description: Draft a plain-language announcement for a just-shipped feature or fix, grounded in what actually changed - a release note, Slack-style update, and changelog entry presented as copy-pasteable chat blocks. Use when the user says "announce", "draft a release note", "write the changelog entry", "promote this", or points at a merged PR, a docs/plans/ artifact, or a docs/lessons/ entry and wants it communicated. Every claim traces to the PR, diff, or plan - no invented capability, no marketing fluff. Output is chat-only by default; a docs/CHANGELOG.md append is optional via atlas:docs-curator. Never posts anywhere - delivery is always manual.
when_to_use: draft release note, announce shipped feature, changelog entry, Slack update for a change, promote what shipped
allowed-tools: Read, Glob, Grep, Bash
argument-hint: '[what shipped and/or channels, e.g. "the CSV export PR as a Slack update"]'
---

Apply the Operating Contract to this entire task. It is injected below.

```!
cat "${CLAUDE_PLUGIN_ROOT}/references/operating-contract.md"
```

If the contract did not load above, read `${CLAUDE_PLUGIN_ROOT}/references/operating-contract.md` and apply it before proceeding.

## What this skill is

Port of CE `ce-promote` (post-shipping announcement-draft runtime) into atlas. It turns a change that just shipped into user-facing copy inside the engineering workflow, so the announcement does not wait on a separate writing pass. CE's Spiral brand-voice integration is dropped in this port: atlas has no equivalent voice-matching runtime, so every draft is direct drafting. The done-condition carries over unchanged.

**Done when:** every drafted channel is presented as a labeled, copy-pasteable block grounded in the actual change, and the user has been offered a revision. **This skill drafts only.** It never posts, publishes, schedules, emails, commits, or opens PRs - not to Slack, social, or any external channel. Delivery is a human action, always.

## Non-negotiables

- **Grounded or absent.** Every claim in a draft must trace to the PR body, the diff, the plan artifact, or the lesson entry. A capability the change does not deliver does not appear, however good it would sound. If the evidence supports only a fix note, draft a fix note - not a feature story.
- **Outcome, not implementation.** Lead with what a user can now do that they could not before. "Export any report to CSV in one click", not "added a CsvSerializer and an export endpoint". Name user-visible names (commands, flags, screens), not internal ones.
- **No fluff.** Plain declarative sentences. No promotional adjectives, no significance inflation, no exclamation stacking. The operating contract's output prose rules apply to every draft.
- **Chat-first.** The chat blocks are the deliverable. Nothing is written to disk unless the user explicitly asks for the changelog append.
- **Subagents never see the user.** Any question about channels, tone, or whether to record goes to the user directly, not through a dispatch.

## Phase 1 - Establish what shipped

A free-form description in `$ARGUMENTS` is the source of truth. Otherwise derive it from context, using whatever is available and never waiting on any single source:

- **Merged/active PR** - `gh pr view <number|branch> --json title,body,url,state` (the title and body usually state the user-facing value)
- **Plan artifact** - `docs/plans/<task-slug>.md` (a shipped plan states intent, scope, and acceptance criteria)
- **Lesson entry** - `docs/lessons/<YYYY-MM-DD>-<slug>.md` (a lesson ships as a pattern or gotcha, not a feature - draft accordingly)
- **The diff** - `git diff main...HEAD --stat` or the merge diff, skimmed so claims are grounded in what actually changed
- **Changelog** - top entry in `docs/CHANGELOG.md` (may already state the change plainly; reuse its framing)
- **Recent commits** - `git log --oneline -15` for the arc of the change

Then write a 1-3 sentence summary of the **user-facing value** before drafting anything. If the sources disagree or you cannot confidently tell what shipped or for whom, ask one short question rather than guessing.

Grounding check before Phase 3: for each intended claim, name its source. Claims you cannot source are dropped, not softened.

## Phase 2 - Pick channels

Default set, matching the assignment:

1. **Release note** - 1-3 sentences naming the new capability and who benefits.
2. **Slack-style update** - short, human, first-line carries the value; reads like a teammate posted it, not a press office.
3. **Changelog entry** - one declarative line (or short bullet) in the `docs/CHANGELOG.md` house style: dated section, `Added`/`Fixed`/`Changed`, evidence or doc paths in parens per the template in `docs-ssot`.

If the user named other channels (email, blog intro, demo script), draft those instead of or in addition. Scale to the change: a small fix warrants one or two short drafts, a flagship feature the full set. Do not force a fixed template onto a one-line fix.

Per-channel shape:

- **Release note** - plain, complete, no truncation concerns; states capability and benefit.
- **Slack** - hook in the first line (feeds truncate); no preamble; one idea; one CTA only if the channel earns it.
- **Changelog** - one line, factual, matches the existing file's formatting exactly. Read the file first; never invent a section heading it does not use.
- Never reuse one draft verbatim across channels.

One strong draft per channel by default; more only when asked, capped at ~3.

## Phase 3 - Draft

Draft every channel against the Phase 1 value summary and the grounding check. For each draft, keep the mapping claim-to-source in mind (you do not print it, but every line in the copy must survive the question "which diff line, PR sentence, or plan criterion says this?").

If the diff reveals the change is internal-only (refactor, dependency bump, tooling) with no user-facing surface, say so plainly and draft the changelog line only - an internal change dressed up as a user win is an invented capability.

## Phase 4 - Present

Show every draft as a clean, copy-pasteable block labeled by channel:

```
### Release note
<the copy>

### Slack update
<the copy>

### Changelog entry
<the copy>
```

Offer to revise (tone, length, angle, another channel). Then offer exactly one durable option: **"Want the changelog entry recorded in docs/CHANGELOG.md?"**

## Phase 5 - Optional changelog append (docs-curator only)

If the user says yes, dispatch the `atlas:docs-curator` agent - atlas's sole durable-doc writer; this skill never writes `docs/` itself. Use the full dispatch spec from `${CLAUDE_PLUGIN_ROOT}/skills/atlas-orchestrate/references/subagent-kit.md` (required `GOAL:`/`DELIVERABLE:`/`SUCCESS CRITERIA:`/`OUT OF SCOPE:`/`STOP CONDITIONS:` sections and the batched ToolSearch line), and a CONTEXT block carrying:

- the exact changelog entry text approved in Phase 4,
- the change's evidence paths (PR number/URL, plan or lesson path, evidence dir if one exists),
- the instruction to match `docs/CHANGELOG.md`'s existing newest-first format and section headings, not the template's.

If the dispatch fails or the curator reports it could not write, surface that to the user and hand them the entry text to paste manually. Do not write the file from this skill as a fallback.

If the user says no or does not answer, stop: the chat blocks stand as the deliverable.

## Boundaries

- **Never auto-post.** No Slack, social, email, or any external delivery - not even "just a draft sent for review". Drafting ends at the chat blocks.
- No commits, no PRs, no tags. If a release process should follow, name it to the user; do not run it.
- Capturing what was learned from the change (as opposed to announcing it) belongs to `atlas-compound` / `docs-curator`.
- Broader doc updates beyond the changelog append are a separate `docs-curator` pass, not a side effect of promoting.
