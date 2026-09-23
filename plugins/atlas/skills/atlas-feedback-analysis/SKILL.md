---
name: atlas-feedback-analysis
description: 'Turns a raw user-feedback artifact - call transcript, support-ticket thread, session-recording transcript, or pasted notes - into structured, evidence-quoted findings: verbatim pain points, feature requests, usability friction, and sentiment, each tagged, prioritized, and traceable to an exact source quote. Routes a quick single-issue pass (inline report, no durable artifact) versus an extensive multi-issue pass (durable docs/features/<YYYY-MM-DD>-feedback-analysis-<slug>.md plus a requirements kickoff for downstream brainstorm/planning). Every quoted finding is adversarially verified against the source artifact before it counts; unquotable claims are marked as inference or dropped.'
when_to_use: analyze a feedback transcript, ticket thread, or session notes into prioritized findings
allowed-tools: Read, Glob, Grep, Bash, Edit, Write
argument-hint: '<feedback artifact path, or nothing if pasting notes>'
---

Apply the Operating Contract to this entire task. It is injected below.

```!
cat "${CLAUDE_PLUGIN_ROOT}/references/operating-contract.md"
```

If the contract did not load above, read `${CLAUDE_PLUGIN_ROOT}/references/operating-contract.md` and apply it before proceeding.

Read `${CLAUDE_SKILL_DIR}/references/evidence-rules.md` before extracting anything: it defines what counts as evidence, the observed/inference/requirement separation, confidence levels, and the privacy rules for committing feedback artifacts.

# atlas-feedback-analysis

Turn raw product feedback into structured evidence for downstream agents. This is the consumption side of feedback capture: something (a call recording transcript, a support-ticket thread, a user-session recording transcript, pasted notes, or a feedback artifact produced by the `atlas-sweep` skill) exists, and the project needs its signal preserved as structured, quotable findings instead of a paragraph of impressions.

Ported from Compound Engineering's `ce-riffrec-feedback-analysis` and generalized: there is **no required capture tool**. Whatever artifact the user supplies is the input. There is also **no bundled analyzer binary** - extraction is done by you (and dispatched subagents), which makes the evidence rules stricter, not looser: every claim must carry a verbatim quote or a concrete observed fact from the source.

## Accepted inputs

- Text artifacts: call transcripts, support-ticket threads, chat logs, meeting notes, pasted prose. Preferred; fully analyzable.
- Video/screen-recording files (`.mp4`, `.mov`, `.webm`): extract frames via the platform's native media preview (`read` with a frame selector); work from visible UI text, error surfaces, and any supplied transcript. **If there is no transcript and none can be produced, say so and analyze only what the frames show** - never invent dialogue.
- Audio files: only analyzable if a transcript exists or the user supplies one. Otherwise report the blocker: "audio-only artifact with no transcript - supply a transcript or notes" - and stop. Do not fabricate.
- A directory or bundle from `atlas-sweep` or any prior feedback-ingestion run: read its transcript/notes files as ordinary text artifacts.

An unreadable, missing, or untranscribable input ends with an actionable blocker, never a partial success claim.

## Choose the path

Route from the input; read only the references named for that route.

- **Quick report** - the artifact covers one specific issue, is short, or the user asks for "quick", "small", or "just summarize". Read `references/quick-report.md`. Ends with one inline evidence-backed bug report; no durable artifact unless the user asks.
- **Extensive analysis** - the artifact contains multiple issues, requests, a workflow walkthrough, or the user wants requirements material. Read `references/finding-format.md` and `references/personas/feedback-analyst.md`. Ends with the durable analysis doc under `docs/features/` and, unless the user asked only to extract, a handoff into `atlas-brainstorm`.

When the input is ambiguous, inspect its length and issue count before choosing. If still unclear, ask the user which path applies before running anything heavy.

## Common rules

- **Raw material is local-only by default.** Extracted frames, raw media, and unsanitized source dumps go under `.atlas/evidence/<YYYY-MM-DD>-<slug>/` and are not committed unless the user explicitly confirms the content contains no sensitive customer data. Feedback transcripts frequently contain names, account details, and PII - treat them as sensitive until proven otherwise.
- **Committed text artifacts must be sanitized and repo-relative.** Any durable doc uses repo-relative evidence paths, redacts or genericizes customer identifiers, and quotes only what survives that redaction. When in doubt, keep the quote but replace the customer's name with `<customer>`.
- **No external CLI dependency.** Never shell out to a vendor capture tool to do this work. If the user names one (a capture app, a recording zip format), treat its emitted files as ordinary inputs per the Accepted-inputs rules.
- **Push/PR gating.** This skill never pushes, opens a PR, or merges. It writes local artifacts only; the durable doc is a local commit at most, and only if the user asks to commit.

## Extensive path workflow

1. **Read the artifact in full.** For long transcripts, read in sequential chunks; never sample. Note the source anchor scheme (timestamps, ticket ids, message numbers) you will cite.
2. **Extract exhaustively.** Capture every distinct problem, request, expectation, confusion point, and sentiment signal with a verbatim quote or frame reference. Over-capture is the design goal: separate capture from prioritization, and keep low-priority items represented rather than dropped. Apply the review heuristics and the severity/confidence tagging from `references/evidence-rules.md`.
3. **Categorize** every finding into exactly one primary category, tagging secondary categories where real: `PainPoint` (bug, failure, breakage), `FeatureRequest` (asked-for behavior), `UsabilityFriction` (works but confuses, slows, or annoys), `Sentiment` (trust/attitude signal without a concrete behavior ask).
4. **Source-map when the workspace is the product code.** Dispatch `atlas:explorer` (read-only) to map findings to likely components, routes, services, and tests. Classify each mapping as likely-surface / missing-surface / indirect / unknown with High/Medium/Low confidence and a file:line evidence note - per the grounding rules in `references/evidence-rules.md`. Prefer "no current implementation found" over a speculative mapping; missing surfaces are product findings, not analysis failures. Source mapping is supporting material, never a filter: unmapped findings stay.
5. **Verify the quotes.** Dispatch an independent `atlas:verifier` (fresh context, artifact path supplied) to confirm each quoted finding's quote appears verbatim in the source and the cited anchor is correct. Unverifiable quotes are corrected, downgraded to inference, or dropped - the report never ships a quote the verifier cannot find. Stamp the verification verdict via `python3 "${CLAUDE_PLUGIN_ROOT}/scripts/atlas_finding.py"` into `.atlas/.run/findings.json`.
6. **Write the durable doc** to `docs/features/<YYYY-MM-DD>-feedback-analysis-<slug>.md` using the template in `references/finding-format.md` (filename slug must be filesystem-safe per the docs SSOT naming rules). If `atlas:docs-curator` is available, dispatch it to make this the actual write; otherwise write it directly and note that the curator pass was skipped.
7. **Hand off.** Unless the user explicitly asked only to extract or analyze, announce that analysis is complete and hand the requirements-kickoff section to `atlas-brainstorm` (or `atlas-prompt`/`make-plan` when the user wants to go straight to a plan) with the durable doc as its evidence manifest. The callee owns requirements confirmation and prioritization.

## Report

- The path taken and why (input shape that routed it).
- Finding counts per category and severity, with the doc path for the extensive path.
- Verification result: how many quotes the verifier confirmed, and what was downgraded or dropped.
- The handoff target, if any.
