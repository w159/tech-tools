---
name: atlas-pov
description: 'Forms a decisive, project-grounded independent opinion (an "oracle" verdict) on a technical decision, architecture choice, library pick, migration path, or contested question. Ports Compound Engineering''s ce-pov with atlas mechanisms: frame the decision, dispatch atlas:explorer as a grounding scout that builds an evidence dossier (project grounding, precedent/activity, and - via web_search/Context7 only when the question needs it - external evidence), enforce an evidence floor (no verdict without project-grounding evidence, and without external evidence when the question is not answerable from the repo alone), form ONE independent atlas verdict first, then grade the recommendation Adopt/Trial/Hold/Reject/Not-our-problem. Additional independent voices ("oracle this", "cross-check", named peer) are OPTIONAL and request-gated only: they dispatch one or two fresh non-voting subagent peer checks that receive identical normalized scope and no visibility into the host verdict or each other - these are same-host independent subagents, NOT cross-CLI/cross-model routing (atlas never shells to codex/cursor/grok binaries); CE''s true cross-model identity receipts are substituted with an explicit same-host independence caveat. Peers are evidence, not votes: atlas''s own verdict remains the decider, and reconciliation records whether peer disagreement moved it. Read-only: no code changes, no git operations; a report delivered in chat, optionally persisted to docs/decisions/<YYYY-MM-DD>-<slug>.md when durable.'
when_to_use: decide between options, pick a library or architecture, arbitrate a contested technical question, or provide a second opinion when explicitly asked ("oracle this", "cross-check")
allowed-tools: Read, Glob, Grep, Bash, Edit, Write
argument-hint: '<the decision, question, or contested choice to opine on>'
---

# atlas-pov

Decisive, evidence-floored, project-grounded opinion. This is not a brainstorm and not a
vote: one grounded verdict, formed first, defended with citations, graded on the
Adopt/Trial/Hold/Reject/Not-our-problem scale. Independent peer voices exist only when
explicitly requested, and they are evidence for reconciliation - never co-deciders.

Apply the Operating Contract to this entire task. It is injected below.

```!
cat "${CLAUDE_PLUGIN_ROOT}/references/operating-contract.md"
```

If the contract did not load above, read `${CLAUDE_PLUGIN_ROOT}/references/operating-contract.md` and apply it before proceeding.

## Read before running

Read `${CLAUDE_SKILL_DIR}/references/verdict-protocol.md` - it defines the framing packet,
the grounding-scout dispatch, the evidence floor, the verdict shape, reconciliation rules,
and the grading rubric. Read `${CLAUDE_SKILL_DIR}/references/peer-dispatch.md` before ANY
peer dispatch, and only after Phase 3 is complete.

## Phases

| Phase | What | Where |
|---|---|---|
| 0. Frame | Fix the decision, options, constraints, and what would change the answer; capture an immutable repo-state digest | `references/verdict-protocol.md` §1-2 (this file does it) |
| 1. Ground | Dispatch `atlas:explorer` as the grounding scout; it builds the evidence dossier (project grounding + precedent/activity, external evidence via `web_search`/Context7 when the question needs it) | `references/verdict-protocol.md` §2 |
| 2. Floor | Hard gate: no verdict without project-grounding evidence, and without external evidence when relevant | `references/verdict-protocol.md` §3 |
| 3. Verdict | Form ONE independent atlas verdict - written down BEFORE any peer exists | `references/verdict-protocol.md` §4 |
| 4. Peers | OPTIONAL, explicit-request only: one or two fresh non-voting peer checks | `references/peer-dispatch.md` |
| 5. Reconcile | Peers are evidence, not votes; atlas remains the decider; record movement or held position with reasons | `references/verdict-protocol.md` §5 |
| 6. Grade + deliver | Adopt/Trial/Hold/Reject/Not-our-problem, each grade citing dossier evidence; chat report, optional durable record | `references/verdict-protocol.md` §6-7 |

## Non-negotiables

- **Evidence floor is a gate, not a preference.** A verdict rendered from vibes, generic
  training knowledge, or a half-empty dossier is a defect. If the floor cannot be met, the
  honest output is "insufficient evidence" plus exactly what is missing - never a guess.
- **The atlas verdict exists before the peers.** Phase 3 output is written (chat or
  `.atlas/evidence/<YYYY-MM-DD>-<slug>/atlas-verdict.md`) before Phase 4 dispatches anything.
  A peer prompt must never contain the host's conclusion, a hint toward it, or another
  peer's answer.
- **Peers are never dispatched by default.** Only an explicit user request for a second
  opinion opens a panel (see `references/peer-dispatch.md` for trigger words and the
  same-host substitution statement).
- **Read-only output.** This skill changes no code, runs no migrations, and performs no git
  operations of any kind - no commit, no push, no PR, ever. The only writes are the optional
  evidence dossier under `.atlas/evidence/<YYYY-MM-DD>-<slug>/` and an optional durable
  record at `docs/decisions/<YYYY-MM-DD>-<slug>.md` (date-first, per the docs SSOT).
- **Same-host honesty.** Peer checks are independent in context, not in model. Say so in
  the report; never present peers as cross-model oracle routing.

## Composes with

`atlas:explorer` (grounding scout), the `Task` dispatch schema from
`${CLAUDE_PLUGIN_ROOT}/skills/atlas-orchestrate/references/subagent-kit.md` (peer and scout dispatches), fresh
`general-purpose` subagents as peers, and `${CLAUDE_PLUGIN_ROOT}/scripts/atlas_finding.py` to stamp a durable verdict into
`.atlas/.run/findings.json`. When the durable record is warranted and `atlas:docs-curator`
is available, dispatch it for the `docs/decisions/` write; otherwise the skill writes it.