---
name: atlas-explain
description: Evidence-backed explanation of how or why existing behavior works, answered directly in chat. Use when the user asks "how does X work", "why does Y happen", "explain this module/call path", or a plain-language "wtf does this do" / "what the" question about a file, message, or passage. Dispatches atlas:explorer to trace the actual code path (never answers from memory), grounds every claim in file:line evidence, separates what the code does from why it was likely built that way (inference marked as such), read-only with no artifacts written — fast and cheap. This one skill intentionally covers both ce-explain's how/why investigation and the wtf utility's plain-language "what is this" explainer as a single atlas entry to avoid two near-duplicate skills in the catalog.
when_to_use: how does X work, why does Y happen, explain this code, wtf does this do, what the
allowed-tools: Read, Glob, Grep, Bash
argument-hint: '[question, concept, file, diff ref, or work window; blank = your last message]'
---



Apply the Operating Contract to this entire task. It is injected below.

```!
cat "${CLAUDE_PLUGIN_ROOT}/references/operating-contract.md"
```

If the contract did not load above, read `${CLAUDE_PLUGIN_ROOT}/references/operating-contract.md` and apply it before proceeding.

Read `${CLAUDE_SKILL_DIR}/references/intake-and-grounding.md` before classifying the request or grounding any claim, and `${CLAUDE_SKILL_DIR}/references/trace-dispatch.md` before dispatching an explorer.

## What this skill is

Port of CE `ce-explain` and CE `wtf`, merged into one atlas skill on purpose: both answer questions about things that already exist, both are read-only, and CE's split between them is a naming convention, not a mechanism difference. A "how does the retry queue work" question and a "wtf does this file do" question take the same path here — intake, evidence trace, chat answer. Explaining a historical choice is not endorsing it today.

**Done:** the question is answered in chat, with every factual claim carrying `file:line` evidence and every unresolvable point listed as an open question — or the specific blocker is returned. No artifacts are written; publication, fixes, and judgment calls are separate actions, not conditions of having explained the subject.

## Non-negotiables

- **Never answer from memory or assumption.** "I know this codebase" is not evidence. If the code path has not been traced in this run, trace it before claiming it.
- **Read-only.** No file writes, no artifacts, no findings.json stamping (this skill never claims "done/fixed", so the verifier pipeline does not apply). Git commands are observation only — no push, no PR, no commit, ever.
- **What vs why are different claims.** Code shows behavior, not intent. Label each rationale claim: *Documented* (a comment, commit message, doc, or linked issue states it), *Inference* (you derived it — say so, and give the supporting evidence), or *Unknown* (the record is silent — say so; a missing search result does not prove there was no reason).
- **Consumer first.** A person needs a working answer; a calling workflow needs text it can incorporate. Answer the asked subject only — do not explain an adjacent thing when the asked thing is unresolvable; report that instead.

## Execution flow

### Phase 1 — Intake

Classify the request into exactly one input shape — **concept** (how/why a piece of the repo works), **diff** (what a specific change did), **window** (what happened over a work period), or **plain-language target** (the `wtf` path: a file, link, pasted passage, "the migration part", or blank = your last message) — per the rules in `references/intake-and-grounding.md`. Resolve discoverable facts (which file, which ref, which window) before asking anything; ask only when missing information materially changes the answer. A bare invocation with no recoverable subject gets one short clarifying question, not an invented topic.

### Phase 2 — Ground

Trace the actual code path, the diff, or the commit window — per `references/intake-and-grounding.md`'s grounding rules.

- **Concept:** follow the trigger through its state changes, ownership boundaries, and effects in current source and relevant tests. A filename or conversation claim does not establish behavior.
- **Diff/window:** resolve the change or range; gather evidence with `git show`, `git log`, and the touched files plus any motivating doc under `docs/`. Empty range or empty window: report the absence — do not silently explain something else.
- **Dispatch:** anything beyond a trivial single-symbol lookup goes to `atlas:explorer` as a read-only Task dispatch using the exact spec in `references/trace-dispatch.md`. When one pass cannot name the boundaries without hand-waving, split the question into one slice per ownership boundary (two minimum, four maximum — more means the question is still unscoped: narrow it and trace again) and dispatch the slices together in one message. If Task dispatch is unavailable or fails on a reason that survives correcting the invocation, run the trace inline with the same evidence budget and disclose that in one line.
- **External concepts** (no footprint in this repo): skip repo grounding entirely. If no web/research tool is reachable, you may explain from model knowledge, but label it **Unverified — from model knowledge, not checked against current sources**.

### Phase 3 — Compose the answer in chat

- Open with the direct answer in one or two sentences. No preamble, no restatement of the question.
- Then the trace: the mechanism with `file:line` for every claim, prose or a small diagram/table when it improves understanding. A function call does not establish guarantees about its uninspected implementation — check or hedge.
- Then the why, with the three labels above, each tied to its evidence (`src/x.py:42` comment, commit `abc1234`, `docs/decisions/…`). Preserve the conditions and failure paths that matter.
- Plain-language mode (`wtf`): the reader can say what the source means and what, if anything, they must decide or do, without going back to the source. Open with the point; keep exact names, commands, and values the user will need; keep failures, caveats, and open questions — the explanation must not sound more certain than the source; add no claims the source does not make. Shorter than the source; never walk it section by section. No analogies, no cheerleading.
- If re-reading your own earlier message under plain-language mode shows it was wrong, say so and correct it.

### Phase 4 — Deliver and stop

The chat answer is the deliverable. Do not manufacture follow-on work or destination menus.

## Boundaries

- Judgment on whether an approach should be adopted or changed belongs to the atlas POV/perspective skill, not here — explaining a historical choice is not endorsing it today.
- A failure to diagnose or fix belongs to `atlas-debug`; a factual explanation of current behavior stays here.
- Generating alternatives or scoping implementation belongs to brainstorming/planning skills.
- Capturing the explanation as durable project learning belongs to `atlas-compound` / `docs-curator`; producing an explanation does not authorize writing `docs/`.