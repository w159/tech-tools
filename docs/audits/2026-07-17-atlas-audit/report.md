# Atlas CODE Audit - 2026-07-17

Scope: `plugins/atlas/` hooks + scripts, `docs/` SSOT, `mcp_servers/` (auvik import path).
Baseline at audit start: 967 tests pass, 10 hooks wired in `hooks.json` (plus `atlas_doctor`), 21 skills, 12 agents.
Method: six parallel dimension reviewers (correctness x2, security, error-handling, docs-drift, dead-code/quality/coverage), then independent verification of the load-bearing claims.

Head commit audited: `56d1a9f` (feat: expand atlas canonical structure).

## Verification status

| Finding | How settled | Verdict |
|---|---|---|
| `additionalContext` dropped (4x) | fresh atlas:verifier vs LIVE official docs (raw curl) | CONFIRMED |
| auvik dangling import (3 sites) | direct `ls` + grep this session | CONFIRMED |
| `disable_skill` YAML corruption | traced real function bytes this session | CONFIRMED |
| curator stale oscillation | reviewer reproduced live | CONFIRMED (not re-run here) |
| skill_factory unescaped quote | reviewer reproduced live | CONFIRMED (not re-run here) |
| prompt_optimizer ValueError / CSI leak | reviewer reproduced live | CONFIRMED (not re-run here) |
| MEMORY.md injection chain | reviewer code-trace | PLAUSIBLE - see coupling note |
| atlas_memory read-error clobber | reviewer code-trace | PLAUSIBLE |
| docs-drift items | reviewer git/find evidence | CONFIRMED (cited both sides) |

Environment note: FOUR of the six reviewers plus the verifier independently reported FABRICATED tool output this session (fake "file unchanged / lean-ctx dedup" Read stubs, fake bash errors referencing tools not in the toolset, fabricated WebFetch "verbatim" quotes). Each defended by re-reading real bytes via `python3`/`curl`. Findings below rest on real-byte re-reads, not first-pass tool output.

---

## HIGH findings

### H1-H4. Hooks emit `additionalContext` in a shape Claude Code silently drops
Files: `session_boot.py:416-421` (SessionStart), `auto_skill.py:83` (Stop), `memory_capture.py:288` (Stop/SubagentStop), `nudge.py:134` (Stop/SubagentStop).

Every one writes `json.dumps({"additionalContext": ...})` as a BARE top-level key. The live Claude Code contract recognizes `additionalContext` only nested under `hookSpecificOutput` with a matching `hookEventName`. Top-level universal fields are `continue`, `stopReason`, `suppressOutput`, `systemMessage`, `terminalSequence` - `additionalContext` is not among them. So the operating-contract/methodology reminder, the resume block, the structure warning (session_boot), and every self-improvement report (auto_skill, memory_capture, nudge) never reach the model. These hooks' primary documented purpose is currently a no-op.

Correction to the original review: it claimed Stop/SubagentStop cannot carry `additionalContext` at all. Per current official docs that is FALSE - both accept `hookSpecificOutput.additionalContext`. The uniform fix for all four is to wrap the payload:
```python
out = {"hookSpecificOutput": {"hookEventName": "<Event>", "additionalContext": msg}}
```
No event here is incompatible with context injection.

Untested: `test_session_boot.py` asserts on `data["additionalContext"]` at top level, so the suite validates the hook's self-consistency, not the real contract. Fixing the hooks requires updating these assertions.

### H5. Stored prompt-injection sink in agent-global memory (COUPLED to H1)
`memory_capture.py:145,160` -> `atlas_memory.py:165,195` -> `session_boot.py:349-356,417`.
Transcript text matching the `user_correction`/`assumption_admission` regex is persisted verbatim (200-char truncation only) into agent-global `~/.atlas/memory/MEMORY.md` (cross-project, never expires), then loaded into every future session's context. No human review gate. An attacker who lands regex-matching text in a transcript (via a file/page/issue Claude reads and paraphrases) gets a durable instruction payload re-injected as trusted context.

Coupling: the SessionStart injection path is the SAME `additionalContext` key that H1 proves is currently DROPPED. So today this sink is LATENT - MEMORY.md content does not actually reach model context. Fixing H1 ACTIVATES this injection path. Fix H5 (sanitize/escape on write, or gate on review) in the SAME change as H1, or the H1 fix ships a live injection vector.

### H6. `atlas_memory._read_file` swallows read errors, then callers overwrite the file
`atlas_memory.py:109`: `except (OSError, UnicodeDecodeError): return []`. `add`/`replace`/`remove`/`apply_batch` (165-332) read under lock, then unconditionally `_write_file(path, entries)`. A transient read glitch or any non-UTF8 corruption makes the whole memory/project file get rewritten with only the newest entry - all prior lessons destroyed, no error surfaced. Same file as H5: it is both an injection sink and a data-loss risk.

### H7. Shipped dangling import (in the commit that just landed)
`56d1a9f` deleted `mcp_servers/_shared/` (2,386 lines) but `mcp_servers/auvik-mcp/src/tools/status.ts:5` (base-url), `shared.ts:12` (response-shaper), `shared.ts:19` (error-envelope) still import from `../../../_shared/`. Directory confirmed absent. auvik-mcp will not build. The CHANGELOG entry for `56d1a9f` documents only the docs/.atlas scaffold and never mentions the deletion.

### H8. `disable_skill` corrupts SKILL.md frontmatter
`atlas_context_optimizer.py` `disable_skill`. Rebuild is `"---" + new_fm + "---" + content[end:]`; `splitlines()` drops the frontmatter's trailing newline and `content[end:]` still begins with the original closing `---`. Result: `description: foo------\nbody` - doubled/tripled dashes glued to the last field, no newline, broken YAML. `optimize --apply` damages every skill it disables. (This gated audit step 4; that step runs `--dry-run` only, which never writes.)

### H9. `atlas_curator` stale-marker oscillation
`atlas_curator.py:98-109,173-223`. `_skill_activity_time` scans `rglob("*")` mtimes including the curator's own `.stale` marker, so writing the marker resets the skill's activity clock. Reproduced live: run 1 marks stale, run 2 sees the fresh `.stale` mtime and "reactivates", forever. Auto-created skills can never reach the 90-day archive path.

### H10. `skill_factory` unescaped quote in generated frontmatter
`skill_factory.py:70-83`. `description: "{description}"` interpolated unescaped. A description containing `"` yields invalid YAML (`description: "Handles "quoted" input"`), corrupting the generated SKILL.md. Reproduced live.

### H11-H14. Docs drift (all cited both sides)
- `AGENTS.md:46,63,64` makes running `test-mcp-tools.mjs` a mandatory checklist item; the file does not exist anywhere in the repo. README already documents it as missing; AGENTS.md was never updated. A fresh agent following AGENTS.md runs a command that fails.
- `CHANGELOG.md:134-141` (2026-07-15 "SSOT correction") narrates a `docs/` -> `.atlas/` migration that never happened: `.atlas/plans`, `.atlas/specs`, `.atlas/architecture` do not exist; the files are still tracked in `docs/`.
- `README.md:28` cites plugin version `5.0.0` at a file:line that now reads `5.1.0` (self-contradicts CHANGELOG:101).
- `README.md:174-193` undercounts test scripts: claims 5 hook tests (13 exist) and 9 script tests (13 exist).

### H15. Vendored hooks doc is stale (new, from verification)
`docs/claude-code/features/hooks.md:1832,1998-2038` states SubagentStop does not support `additionalContext` and omits it from the Stop table. Live official docs contradict this - both accept `hookSpecificOutput.additionalContext`. If the H1-H4 reviewer reasoned from this vendored copy, that is why the sub-claim was wrong. Refresh the vendored copy.

### H16. Untested drift-detection module
`plugins/atlas/skills/atlas-setup/scripts/plugin-health.py` has NO test file; `manifest_declared_counts`/`main` (the drift logic) are entirely untested - and per the error-handling reviewer this same module prints PASS when the manifest is unreadable (see M-cluster).

### H17. God functions
`session_ingest.py:760 codex_adapter` (110 lines, nesting 11), `atlas_doctor.py:222 run_checks` (150 lines), `session_boot.py:303 main` (120 lines). Each violates the 50-line/SRP standard; the deepest are the hardest to change safely.

---

## MEDIUM findings (compact)

| File:line | Issue |
|---|---|
| `prompt_optimizer.py:152,230` | `int(_env(...))` unguarded -> uncaught `ValueError` on non-numeric env crashes the prompt hook (violates its own "never block" contract). Reproduced. |
| `prompt_optimizer.py:68,90-105` | `_CSI` regex only matches single-param CSI; multi-param SGR (`\x1b[38;5;108m`) leaks literal `[38;5;108m` into the optimized spec. Reproduced. |
| `skill_factory.py:111-174` | stored-injection via unescaped transcript text in generated SKILL.md bodies (live sink, independent of H1 - skills are read when invoked). |
| `memory_capture.py:253-263` | `atlas_memory.add()` failure reason discarded (no stderr, no note); facts silently dropped when the 4000-char budget is hit. |
| `session_ingest.py:899-935` | `--backfill` swallows per-file `except Exception: continue` with no logging; reports only successful count. |
| `dispatch_tripwire.py:83,86` | `current_run_id`/`is_orchestrating` not individually try-excepted -> DB error falls through to fail-OPEN, contradicting the adjacent "fail CLOSED" comment; an inline edit can slip the deny gate. |
| `completion_gate.py:408-446` | DB errors in orchestration/verifier-coverage checks silently disable the Definition-of-Done Stop gate for the session. |
| `prompt_optimizer.py:388-397` | `arm_orchestration` swallows DB errors silently (no stderr, unlike siblings) -> session never flagged orchestrating; downstream deny + Stop gates go dormant. |
| `plugin-health.py:37-87` | prints PASS on skills/agents count when `plugin.json` was unreadable (`None` treated as "match"). |
| `atlas_context_optimizer.py:167-231` | `limit_sessions` applied as `LIMIT rows*10` on tool_calls, no `GROUP BY session_id`; a chatty session crowds out others -> recently-used skill/agent wrongly disabled. |
| `atlas_db.py:93-99` | `os.makedirs(dirname(path))` raises `FileNotFoundError` when `ATLAS_DB` is a bare filename. |
| Dead code | `atlas_db.py` analytics API (`run_metrics`, `trends`, `tool_usage`, `context_tool_health`, `signal_rollup`, `signal_counts`, `repeated_prompts`, `idle_assets`, `record_improvement`, `asset_audit_summary`, `note_asset_restore`) + `atlas_memory.apply_batch` - 0 production callers, test-only. |
| Coverage | `scaffold_docs.py` (8 public funcs untested incl. gitignore seeding), `atlas_doctor.py` (`find_registration`, `marketplace_plugin_version`, `record_maintenance`), `session_ingest.py` (`summarize_input`, `is_synthetic_session`). |
| Quality | ~10 further >50-line / deep-nesting functions (optimizer `optimize`, curator `apply_transitions`, `_extract_lessons_from_session`, completion_gate `_reason`, memory_capture `_extract_facts`, etc.). |

## LOW findings
- `install_hooks.py:240-247` non-atomic `settings.json` write (backup taken, but no tempfile+`os.replace`; sibling `atlas_memory._write_file` does it right).
- `atlas_context_optimizer.py:319-332` `disable_agent` swallows `OSError` silently, unlike `disable_skill`/`enable_skill` which log.
- `atlas_db.py:131 backfill_run_kinds` schema-backfill branch unasserted.
- Broad `except Exception` density: `session_boot.py` 14, `session_ingest.py` 12, `nudge.py` 9.

---

## Synthesis: fix order

1. **H1-H4 + H5 together.** Wrapping `additionalContext` under `hookSpecificOutput` activates the MEMORY.md injection sink. Sanitize-on-write (H5) and fix the read-error clobber (H6) in the same change, then update `test_session_boot.py` to assert the real contract shape.
2. **H7 now.** auvik-mcp is broken at head. Either restore the shared modules for auvik or repoint its imports; add a CHANGELOG note for the `_shared` deletion.
3. **H8 before any `optimize --apply`.** The optimizer corrupts frontmatter on disable. Do not run `--apply` until fixed. Dry-run is safe.
4. **H9, H10** are self-contained one-function fixes with live repros.
5. **H11-H15** docs-curator sweep: AGENTS.md test harness, CHANGELOG migration narrative, README version + counts, vendored hooks.md.
6. MED gate-fail-open items (dispatch_tripwire, completion_gate, prompt_optimizer arm) are a coherent cluster: the orchestration enforcement layer degrades silently on any DB hiccup. Worth one focused pass.

Not safe to ship head as-is: H7 breaks a build, H1-H4 mean the hook layer's context injection does not work, and the docs SSOT actively misdirects a fresh agent.
