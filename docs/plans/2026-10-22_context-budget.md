# Context budget: what the lead session pays today and what to change

Date: 2026-10-22. Status: audit complete, changes proposed, nothing implemented.

## Ask

Atlas should make a single lead session usable all day with little context growth, because the operating contract pushes work into subagents, tmux teams and background tasks. Audit the current cost and name the changes.

## Dataset and method

This session's own transcript (8.8 MB, 2821 lines, 6 human prompts, 104 Agent dispatches, 3 tmux teams) analysed by `python3 -I` scripts under `.atlas/.run/ctx-audit-measure*.py`; sources mapped read-only in `plugins/atlas/hooks`. Reports: `.atlas/.run/ctx-audit-measure.md`, `.atlas/.run/ctx-audit-sources.md`. Bytes are a proxy; tokens are about bytes / 4.

## What the lead actually paid (model-visible, measured)

| Source | Bytes | Tokens (est) | Owner |
|---|---|---|---|
| Harness listings sent once or on change: deferred tool list 159 KB, system prompt snapshot 150 KB, MCP server instructions 60 KB, CLAUDE.md and rules 50 KB, agent listing 48 KB | ~467 KB | ~117k | harness, plugin surface |
| PreToolUse:Agent hook stdout (the tripwire's permission JSON and rewritten dispatch prompts), 104 calls, mean 3.6 KB, max 12 KB | 377 KB | 94k if model-visible [unverified] | atlas |
| Tool results read inline by the lead: ctx_shell 142 KB (69 calls, max 28 KB), ctx_batch_execute 33 KB, ctx_read of reports 30 KB, context-mode ctx_search 27 KB, claude-mem 27 KB | ~260 KB | ~65k | lead behaviour |
| Tool inputs (mostly dispatch prompts, 140 calls, max 17 KB) | 201 KB | 50k | lead behaviour |
| Subagent hand-back messages, 14 (mean 4 KB, max 14 KB) | 66 KB | 16.5k | harness wrapper, atlas REPORT contract |
| SessionStart injections, 8 starts (max 21 KB; claude-mem resume, work state, superpowers text, atlas boot) | 39 KB | 10k | mostly other plugins |
| Task notifications, 23 x 0.9 KB | 20 KB | 5k | harness |
| Board floods `[atlas] N messages for you` (up to 10 x 600 chars per injection, on every matched tool call) | not isolated; one injection of 8 notes was 2.5 KB | | atlas `hooks/worker_inbox.py:39-40,204-214` |
| Per-prompt repeated lines: lean-ctx policy 225 B x 38, atlas contract 176 B x 36, batching reminder 126 B x 75, output style tag | 27 KB | 7k | lean-ctx plugin, atlas `prompt.submit`, harness |

Totals: injected context about 673 KB (168k tokens); conversation content about 550 KB (137k tokens). The lead ran at roughly 300k tokens of history before compaction for one working day of three waves, which is the problem the user describes.

Open measurement: whether PreToolUse hook stdout (377 KB) reaches the model or only the transcript. Claude Code sends `additionalContext` and permission decisions to the model, not raw stdout; the tripwire returns `updatedInput` with the rewritten prompt, which the model sees again as the tool input. Treat the 377 KB as "probably double-counted dispatch prompts" until a per-turn model-visible filter confirms it.

## Where the real leverage is

1. The lead reads too much itself. 260 KB of tool results and 201 KB of dispatch prompts were authored or read in the lead. Every report read with `ctx_read mode=full`, every multi-command `ctx_shell` with inline output, every board flood: these are the bytes a subagent should have absorbed. The inline-op tripwire counts calls, not bytes, so a 28 KB inline shell result costs the same as a 200 B one.
2. Dispatch prompts are long and repeated twice (tool input, then the tripwire's rewritten copy). A 2 KB prompt with the TOOLS/SCOPE/GOAL blocks is paid at least once per dispatch; 104 dispatches at 1.9 KB mean is 200 KB.
3. Hand-backs relay the whole worker report. The harness wrapper cannot be capped by atlas, but the REPORT contract can: STATUS plus at most 8 lines, full evidence in `.atlas/.run/reports/<worker>.md`. `worker_report_gate` already parses the report; it does not cap it.
4. Board injections churn (never cache-friendly) and fire on every matched tool call while notes are pending: `dispatch_tripwire_core.py:2252` with `MAX_NOTES=10`, `MAX_BODY=600`.
5. The per-prompt contract lines are small but identical every prompt, which is the cheap kind (prefix-cacheable); the large one-off listings are harness-level and only shrink by installing fewer skills, agents and MCP servers.

## Change list (atlas-controlled, ordered by saving per size)

| # | Change | Where | Saving per session (this session's numbers) | Size |
|---|---|---|---|---|
| 1 | Byte budget on inline reads: the tripwire's inline tier counts bytes of tool results, advises at 8 KB per call and 64 KB per turn, denies the next inline read over the turn budget with "dispatch an explorer; read the summary". | `hooks/dispatch_tripwire_core.py` inline tiers; PostToolUse has `tool_response` | up to 150 KB of the 260 KB | M |
| 2 | Report relay cap: `worker_report_gate` writes the full report to `.atlas/.run/reports/<name>-<ts>.md` and rewrites the hand-back to STATUS + DELIVERABLE + at most 8 evidence lines + the path. Subagent-kit REPORT block says the same. | `hooks/worker_report_gate_core.py`, `skills/atlas-orchestrate/references/subagent-kit.md` | 40 of 66 KB | M |
| 3 | Dispatch prompt compression: the tripwire's `updatedInput` must not re-emit the whole prompt; shared TOOLS/SCOPE boilerplate moves to a one-line reference (`CONTRACT: atlas-v1`) the worker expands from `subagent-kit.md`, so prompts drop from about 2 KB to about 0.7 KB. | `hooks/dispatch_tripwire_core.py` (updatedInput), `references/subagent-kit.md`, agent definitions read the contract at start | 100 KB plus the 377 KB hook stdout if it is model-visible | M |
| 4 | Board injection coalescing: one line per injection, `[atlas] 8 board notes (3 done, 1 blocked): atlas_todo.py notes --since <ts>`, full text only for `done:`/`BLOCKED`/`STATUS:` notes, cap 3 notes and 200 chars, never on Read/Grep/Glob results. | `hooks/worker_inbox.py:39-40,201-214`, `dispatch_tripwire_core.py:2252` | about 2 KB per injection; dozens per wave | S |
| 5 | Team wait returns a digest: `atlas_mux.py wait` prints one line per member (name, exit, last STATUS) and the report paths, never note bodies; the lead reads `.atlas/.run/reports/` on demand. | `scripts/atlas_mux.py` wait/notes | small per call, removes the need for the lead's post-wait board parsing (the 28 KB ctx_shell results here) | S |
| 6 | SessionStart boot block: lead gets the status-header rule and the three team commands only; tool-routing, memory and recall lines move to the operating contract file the model reads once. Repeat starts in one session (8 here, from compaction and resume) re-inject nothing. | `hooks/session_boot_core.py` | up to 30 KB | M |
| 7 | Task-notification and hand-back dedup: when a hand-back already arrived for an agent id, the later task-notification carries only the id (the harness sends both). Atlas cannot drop the notification, but `worker_report_gate` can shorten the hand-back to one line when the full report path is already on the board. | `hooks/worker_report_gate_core.py` | 10 KB | S |
| 8 | Context meter in the lead's own surface: the new statusline already shows ctx %; add the per-turn growth and the top offender category from a hook-maintained `~/.atlas/ctx-ledger-<session>.json` so the user sees what is eating the window while it happens. | `hooks/dispatch_tripwire_core.py` (PostToolUse sizes), `scripts/atlas_statusline.py` | none directly; makes the budget visible | M |
| 9 | Compaction hygiene: `PreCompact` writes a dense handoff (`atlas-handoff` format) to `.atlas/.run/handoff-<session>.md` and SessionStart after compaction injects only its path plus 10 lines, instead of the full claude-mem resume block. | `hooks/ingest_session.py` (already runs on PreCompact), `session_boot_core.py` | the 21 KB resume block per compaction | M |

Process changes with no code: the lead dispatches explorers for any read over 20 lines and never opens a worker report with `mode=full`; verifiers write verdicts to findings.json and return three lines; curators return file lists only.

## Harness-controlled (report, do not build)

Deferred tool list (159 KB), system prompt snapshot (150 KB), MCP server instructions (60 KB), agent listing (48 KB): these scale with installed plugins and MCP servers, not with atlas. The atlas-setup doctor could report the installed surface in KB and name the heaviest servers so the user can disable unused ones. TodoWrite nudges, the batching reminder and the `[Subagent hand-back]` wrapper are Claude Code's.

## Proposed order

Wave A (S items, one implementer): 4, 5, 7. Wave B (M items, two implementers + verifier): 1 and 2, then 3. Wave C: 6, 8, 9. Each wave verified by re-running the measurement script on a fresh session that performs the same three-dispatch task before and after, reporting model-visible bytes per turn.
