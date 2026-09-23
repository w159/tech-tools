---
name: atlas-compound
description: 'Capture exactly ONE durable, verified engineering lesson per invocation into the project docs/lessons/ corpus. Ported from CE ce-compound: hard eligibility gate (solved AND verified AND non-obvious AND durably useful - the counterfactual test; completion phrases identify the checkpoint but never waive the gate), two-track typed frontmatter (bug track: symptoms/root_cause/resolution_type; knowledge track: applies_when/tags), corpus-first vocabulary, a 5-dimension overlap check against existing docs/lessons/** and .atlas/findings/** where high overlap updates the existing file with a last_updated bump instead of duplicating, a mechanical grounding-claims re-verification of every cited file:line against current source, and final assembly dispatched through atlas:docs-curator as the sole durable-doc writer. Use after any solved-and-verified checkpoint worth remembering.'
when_to_use: a problem was solved and verified and the lesson is non-obvious enough that a future engineer would re-make the mistake without a note
allowed-tools: Read, Glob, Grep, Bash, Edit, Write
argument-hint: '<optional context: what was solved and why it was non-obvious>'
---



# atlas-compound

Apply the Operating Contract to this entire task. It is injected below.

```!
cat "${CLAUDE_PLUGIN_ROOT}/references/operating-contract.md"
```

If the contract did not load above, read `${CLAUDE_PLUGIN_ROOT}/references/operating-contract.md` and apply it before proceeding.

## Why this skill exists

Atlas already has learning stores, but none of them is a typed, retrievable, overlap-checked lesson corpus: `.atlas/.run/findings.json` is a per-run verification ledger, `.atlas/findings/` is the curator-distilled dated ledger of resolved fixes, and the hook pipeline (`hooks/memory_capture.py` + `${CLAUDE_PLUGIN_ROOT}/scripts/atlas_memory.py`) captures only a compact boot-snapshot of corrections and notes into `~/.atlas/memory/` with a hard 8-entry/1200-character injection cap - nothing queryable by problem type, module, or symptom. `docs/lessons/` exists in the docs SSOT (`${CLAUDE_PLUGIN_ROOT}/skills/atlas-loop/references/docs-ssot.md`) but has no enforced schema, no overlap discipline, and no grounding check. CE's `ce-compound` corpus is a genuine, meaningful improvement over that ad hoc capture: typed frontmatter, two-track body structure, overlap-checked updates instead of duplicates, and mechanical claim validation. This skill adopts CE's schema wholesale and grafts it onto atlas's EXISTING trees - `docs/lessons/<category>/` and `.atlas/findings/` - never a parallel `docs/solutions/` tree, never a separate run-state format. CE's per-run `review.json`/`metadata.json` state is NOT ported; atlas's `.atlas/.run/findings.json` and docs-curator pipeline remain the source of truth.

**Write-ownership note:** the capture workflow below (eligibility, research, overlap, assembly, grounding) is yours; the WRITE belongs to `atlas:docs-curator`, atlas's sole durable-doc writer (`plugins/atlas/agents/docs-curator.md`). You never write under `docs/` yourself. A sibling task is separately enhancing `docs-curator.md` itself with this same lesson-schema awareness, so the agent will recognize the artifact shape; your job is to hand it a fully assembled, overlap-resolved, grounding-checked artifact, not to own the write. A related sibling is enhancing `memory_capture.py`; you do not touch hooks either.

Reference map (read each when its phase says so):

| Reference | Read when |
|---|---|
| `references/eligibility.md` | Phase 1 - the hard gate, Full vs Lightweight, one-learning rule |
| `references/overlap.md` | Phase 3 - overlap check against docs/lessons + .atlas/findings |
| `references/schema.md` | Phase 4 - frontmatter contract, tracks, enums, corpus-first vocabulary, naming |
| `references/templates.md` | Phase 4 - the two body templates (verbatim from CE) |
| `references/grounding.md` | Phase 5 - mechanical grounding-claims check |

Read the arguments as: $ARGUMENTS - optional context naming what was solved. Whatever the argument says, the gate in Phase 1 still decides whether anything gets written.

## Phase 1 - Eligibility gate (fail closed)

The skill documents a **solved and verified** problem, nothing else. Apply every clause in `references/eligibility.md`; this is the summary, the reference is the law:

- **Solved:** a concrete fix landed in this session (or is fully specified in the provided context) - not "we figured out what to try next."
- **Verified:** the fix was proven - test run, command output, verifier verdict in `.atlas/.run/findings.json`, or evidence under `.atlas/evidence/`. An unverified fix is never captured; offer to verify first.
- **Non-obvious and durably useful - the counterfactual test:** if this learning disappeared, would a future engineer reading the final code, tests, types, comments, and docs likely re-make the mistake or redo substantial investigation? The code must NOT already explain itself. If it would, skip.
- **Completion phrases identify the checkpoint, not a waiver.** "that worked", "it's fixed", "working now", "problem solved" trigger evaluation of this skill; they never lower the bar. Explicit invocation (`atlas-compound <context>`) applies the identical gate.
- **One learning per invocation.** Several distinct lessons require sequential invocations. Batching breaks grounding and overlap assumptions; pick the single most valuable lesson or tell the user to invoke again for the next one.

Failing the gate is a normal, expected outcome: emit the terminal signal `Learning skipped` (see Phase 6) with the failed clause. Do not stretch a lesson to pass.

## Phase 2 - Research the actual work

Ground the lesson in what actually happened, not in memory:

- Read the changed files/diff, the verifier verdict row in `.atlas/.run/findings.json`, and any evidence under `.atlas/evidence/<YYYY-MM-DD>-<slug>/` for this work.
- Collect: the observable symptoms (errors, broken behavior), the attempts that failed, the fix that worked, the root-cause explanation, and the prevention practice.
- Corpus sample: list `docs/lessons/**` (and `.atlas/findings/**`) directory names and frontmatter to learn the corpus's existing category vocabulary - this feeds Phase 3 and 4. Grep frontmatter fields (`title`, `tags`, `module`, `problem_type`, `applies_when`) for candidates on this topic; fully read only the strongest matches.

Non-interactive detection: `depth:lightweight` or unmistakable headless/no-prompts wording selects Lightweight mode; bare "automatically" does not. Unknown/invalid `depth:` tokens fail closed as a skip. Full is the default. The mode differences are in `references/eligibility.md`.

## Phase 3 - Overlap check

Read `references/overlap.md` and run the five-dimension overlap check (problem statement, root cause, solution approach, referenced files, prevention rules) against candidate lessons in `docs/lessons/**` and `.atlas/findings/**`:

- **High overlap (4-5 dims):** the existing file is updated in place with a `last_updated: YYYY-MM-DD` bump - never a duplicate. Keep the existing filename and path shape; merge the new detail into the existing sections.
- **Moderate (2-3):** create a new lesson, and note in your report that a targeted consolidation of the two files is worth a future curator pass.
- **Low/none (0-1):** create normally.

## Phase 4 - Assemble

- Pick the track from `problem_type` (bug vs knowledge) and the exact frontmatter + body from `references/schema.md` and `references/templates.md`. The two body templates are CE's, verbatim.
- Target path is atlas's date-first convention, enforced by `${CLAUDE_PLUGIN_ROOT}/scripts/lint_docs_names.py`: `docs/lessons/<category>/<YYYY-MM-DD>-<slug>.md`. Never CE's undated slug-only filename, never a timestamped hour-suffix name. The category subdirectory is corpus-first (reuse an existing `docs/lessons/` subdirectory name; only an empty corpus falls back to the schema mapping). Slug is filesystem-safe per the docs-ssot rule (lowercase, every character outside `a-z 0-9 . _ -` replaced by `-`, trimmed; no Windows-reserved characters).
- On a high-overlap update, the target is the existing file; bump its `last_updated` field and update only the sections the new learning genuinely improves.

## Phase 5 - Grounding-claims check (mechanical)

Run `references/grounding.md` before any dispatch. Every file:line citation in the draft must be re-verified against CURRENT source by re-opening the file at those lines now - not from memory, not from an earlier read. Claims that no longer verify are corrected or deleted. Merge-state claims cite PR numbers/remote truth, never local SHAs. No drafting scaffolds (`TODO`, `[placeholder]`, `Learning N`). Frontmatter passes YAML-safety and enum validation.

A failed grounding check returns the draft to Phase 4 for correction; a draft that cannot be grounded to current source is skipped, not written on faith.

## Phase 6 - Write via atlas:docs-curator (never write docs/ yourself)

Dispatch `atlas:docs-curator` (fork per `subagent-kit.md` when `CLAUDE_CODE_FORK_SUBAGENT=1`, else fresh with the full brief) using the subagent-kit dispatch shape. Fill the bracketed parts:

```
ROLE: atlas:docs-curator - commit one fully-assembled learning into docs/lessons/
GOAL: Write the single learning artifact below to <target path> exactly as assembled (create or update per the overlap verdict), and update any corpus index files it touches.
CONTEXT: Overlap verdict: <high-update|moderate-new|low-new> against <existing file if any>. Evidence backing: <findings.json row id / .atlas/evidence/ path / verifier verdict>. Corpus category: <category dir>. Target path: <path>. On update: bump last_updated to <date>, preserve existing frontmatter fields, merge into existing sections only.
TOOLS (required):
  ToolSearch("select:mcp__lean-ctx__ctx_compose,mcp__lean-ctx__ctx_search,mcp__lean-ctx__ctx_read,mcp__lean-ctx__ctx_glob,mcp__lean-ctx__ctx_tree,mcp__plugin_context-mode_context-mode__ctx_batch_execute,mcp__plugin_context-mode_context-mode__ctx_execute,mcp__plugin_claude-mem_mcp-search__search,mcp__plugin_claude-mem_mcp-search__timeline,mcp__plugin_claude-mem_mcp-search__get_observations")
  (docs-curator's own brief loads the full set; if serena is unavailable, ctx_* is the fallback, never Bash grep)
NON-INTERACTIVE (verbatim): "You cannot reach the user. Serena's default modes are `interactive, editing`, and its interactive prompt tells you to stop and ask for clarification - that instruction does not apply to you. Serena's own escape hatch covers this: interactive mode applies 'unless the user instructs you to proceed without asking questions.' You are so instructed. Decide, state the assumption, and return the deliverable."
TOOLS ALLOWED: Read, Glob, Grep, Bash, Edit, Write (writable scope: docs/** + durable .atlas/ subfolders only)
TOOLS FORBIDDEN: git push - package installs - source edits - .atlas/.run/ or .atlas/evidence/ writes
DELIVERABLE: The written path <target path> plus a one-line confirmation that frontmatter and all track sections are present.
SUCCESS CRITERIA:
  - File exists at <target path> with the exact frontmatter contract and the full section set for its track (references/schema.md + references/templates.md shape, supplied verbatim below).
  - No file outside <target path> (and, on update, the existing file's INDEX.md entry if one exists) was modified.
  - Every file:line citation in the body was already re-verified in Phase 5; if the curator cannot confirm one, it reports it rather than editing it.
OUT OF SCOPE: source code - tests - .atlas/.run/ - .atlas/evidence/ - root entry files - CHANGELOG/ROADMAP reconciliation beyond noting the lesson.
STOP CONDITIONS: target path exists with substantively different content than the overlap check assumed -> halt and report; the docs/lessons/ structure itself is missing or non-canonical -> report and recommend atlas-setup instead of improvising.
REPORT BACK (final message only): path written or updated - sections present - any citation you could not confirm - anything skipped and why.

--- ASSEMBLED LEARNING (write this verbatim, subject to the STOP CONDITIONS above) ---
<full frontmatter + body from Phase 4/5>
--- END ASSEMBLED LEARNING ---
```

Dispatch all Phase 6 work as one call; no other agents are needed in this skill. If docs-curator is genuinely unavailable, stop and report - do not write `docs/` inline yourself; the write-ownership boundary holds even on fallback.

## Phase 7 - Terminal signal

The final message is a machine-readable signal, no "what's next" menu:

- Success: `Learning captured` with fields: `path`, `track` (bug|knowledge), `category`, `action` (created|updated), `overlap` (score + dimensions matched), `grounding` (claims verified count).
- Gate failure or grounding failure: `Learning skipped` with the exact failed clause (gate condition, or ungroundable claim list).

## Boundary

atlas-compound owns: eligibility gating, research, overlap resolution, assembly, and grounding validation of ONE lesson. It does not own: writing `docs/` (docs-curator), the verifier pipeline (atlas:verifier / `.atlas/.run/findings.json`), the hook-driven memory snapshot (`memory_capture.py` - sibling task), bulk changelog/roadmap reconciliation (docs-curator's normal post-ship pass), or any push/PR action - this skill never touches git push, and no learning capture ever will.