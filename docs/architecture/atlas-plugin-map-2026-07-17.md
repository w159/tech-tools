# Atlas Plugin Architecture Map - 2026-07-17

Produced by `atlas-audit architecture`. Three read-only explorers (orchestration engine, repo boundaries, MCP servers) mapped the tree; this is the synthesis. Input for the graphify wiki pipeline (`docs/architecture/` -> `docs/wiki/diagrams/`).

## Orchestration engine (hook -> DB -> subagent flow)

```mermaid
graph TD
    A["Hook config<br/>hooks.json"] --> B["SessionStart<br/>session_boot.py"]
    B --> C["Detect deps"] --> D["claude-mem load"] --> E["Emit context"]

    A --> F["PreToolUse<br/>dispatch_tripwire.py"]
    F --> G["atlas_db init"] --> H["Check orchestrating"] --> I["Deny / Allow"]

    A --> J["PostToolUse<br/>format_after_edit.py"] --> K["Parse JSON"] --> L["Format"]

    A --> M["Stop<br/>completion_gate.py"]
    M --> N["Parse"] --> O["Find root"] --> P["Evidence"] --> Q["Findings"]
    Q --> R["Docs check"] --> S["Verifier coverage"] --> T["Finalize DB"]

    A --> U["Stop + SubagentStop<br/>memory_capture.py"]
    U --> V["Parse"] --> W["DB connect"] --> X["Extract facts"]

    T --> Y["SQLite SSOT<br/>~/.atlas/atlas.db"]
    W --> Y
    G --> Y
    Y --> Z["runs / events / dispatches tables"]

    E --> CC["atlas-orchestrate skill"]
    CC --> DD["explorer"] & EE["implementer"] & FF["verifier"] & GG["docs-curator"]
    DD --> HH["atlas-db-audit skill"]
    HH --> II["schema-inventory"] & JJ["rls-privilege-audit"]
```

Key facts:
- SQLite SSOT schema at `atlas_db.py:11-86`; DB at `~/.atlas/atlas.db` (or `$ATLAS_DB`). Tables: `runs`, `events`, `dispatches`.
- Skills wire to agents by agent-type name in SKILL.md (e.g. atlas-db-audit -> schema-inventory / rls-privilege-audit / explorer).
- `session_boot` is fail-open throughout (any error exits 0). `completion_gate` is fail-closed on verifier/git checks but fail-open on structure checks. (The CODE audit flags several fail-open branches as contradicting their own comments.)
- Updated 2026-07-28 (atlas 5.2.0): the per-hook Stop-loop guard described in an earlier revision of this note was superseded the same day by a shared module, `plugins/atlas/scripts/atlas_hook_guard.py` (`read_payload()`, `should_run()`, `emit()`, per-session state at `~/.atlas/hookstate/<session_id>.json`). All five Stop hooks (`completion_gate`, `ingest_session`, `memory_capture`, `auto_skill`, `nudge`) now route through it instead of each hand-implementing its own `stop_hook_active` check and dedupe. The module adds a session-wide circuit breaker (`STOP_BURST_LIMIT = 5` Stop events per `STOP_BURST_WINDOW = 120` seconds trips it for the rest of the session, silencing every atlas Stop hook) that no per-hook throttle could provide on its own. `completion_gate.py` deliberately calls `should_run()` only, not `emit()`, so its repeat-until-fixed definition-of-done message is not deduped away; only the breaker can silence it. `memory_capture.py` separately keeps its own fact-level seen-marker (`~/.atlas/.memory_capture_seen`), which tracks facts rather than messages and is unrelated to the guard module. See `.atlas/findings/2026-07-28-stop-hook-memory-capture-loop.md`.
- Updated 2026-08-05: `should_run()` gained a `kind="capture"|"emit"` parameter (`atlas_hook_guard.py:140-159`) because the unconditional `stop_hook_active` short-circuit above was found to also silence the three capture-only hooks (`ingest_session`, `memory_capture`, and the new `chronicle_facet`, all now `kind="capture"`) on every completion_gate block -- the direct cause of a self-improvement telemetry stall. Only `kind="emit"` hooks (`nudge`, `auto_skill`, `completion_gate`) are still gated by `stop_hook_active`; the circuit breaker and per-hook throttle apply to both kinds unchanged. New Stop hook `chronicle_facet.py` writes one deterministic `facets` row per session plus mirrors `signals` into the new `friction_events` table, wired in `hooks.json` after `ingest_session.py`, before `memory_capture.py`. `completion_gate.py` conditions (f)/(g) rescoped from the whole git working tree to only this run's own written paths. See `docs/CHANGELOG.md` 2026-08-05 and `.atlas/findings/2026-08-05-stop-hook-active-silenced-capture-hooks.md`.

## Repo feature boundaries

- **Root `/skills/` (12 standalone tools):** az-cost-optimize, azure-deployment-preflight, cloud-design-patterns, codebase-brain, database-optimization, entra-agent-user, graphify, msgraph-sdk, msoffice-docs, scrapling-official, security-audit, webapp-testing. All target external domains (Azure, MS APIs, security, web).
- **`/plugins/atlas/` (the plugin):** 21 atlas-* skills + 12 agents + 12 hooks + scripts. Atlas-specific operations (audit, debug, orchestrate).
  <!-- 2026-08-05: hooks 11 -> 12 with the addition of chronicle_facet.py
       (Stop-chain facet capture). Count is the 11 scripts wired in
       hooks/hooks.json plus atlas_doctor.py --hook on SessionStart. -->
- **`/plugins/armada/` (org config layer):** 11 department agents carrying org branding/compliance context + the armada routing skill.
- **`/plugins/programmer/` (independent developer-tools plugin, added 2026-07-21):** 2 skills (tpp-audit, tpp-principles) + 1 agent (tpp-auditor) + 1 UserPromptSubmit hook. Pragmatic Programmer codebase auditor with an 89-concept glossary; not part of the atlas orchestration engine.
- **`/plugins/_standards/`, `/plugins/_templates/`:** scaffolding docs and skill/command/agent/plugin templates.
- **`/mcp_servers/`:** per-vendor MCP servers (auvik, cipp, connectwise-manage, vanta, knowbe4, ...).

## Duplication findings (candidates for unification)

| Concern | Sites | Note |
|---|---|---|
| JSON-stdin parse boilerplate | 8 hooks: bash_advisor, completion_gate, dispatch_tripwire, format_after_edit, ingest_session, memory_capture, nudge, prompt_optimizer | Identical `stdin.read()` -> `json.loads or {}` -> `except: return 0`. Extract one `read_hook_input()` helper. |
| Root-finding (walk up to `docs/`) | `completion_gate.py:54-70`, `session_boot.py:164-180` | Same upward-walk, two names (`_find_root` vs inside `find_structure`). |
| atlas_db bootstrap (sys.path + connect + init) | `dispatch_tripwire.py:122-134`, `completion_gate.py:390-408`, `memory_capture.py:216` | No shared bootstrap; each hook re-injects `scripts/` on sys.path and re-inits. One `atlas_db.bootstrap()` would centralize it. |
| MCP-server shell / `DomainHandler` interface | copied per server, `vanta` vs `knowbe4` have DRIFTED | The whole MCP-server shell is duplicated and the copies diverge. Highest-risk duplication: drift means per-server behavior differences. Candidate for a shared `mcp_servers/_shared` (note: that dir was just deleted in `56d1a9f`, breaking auvik - see CODE audit H7; the unification target must be rebuilt, not assumed present). |

M365 coverage duplication (previously `armada/agents/armada-m365.md` vs `atlas/skills/atlas-m365/SKILL.md`) is resolved: `atlas-m365` was deleted 2026-07-21 (see docs/CHANGELOG.md), leaving `armada-m365.md` as the sole M365 coverage.

## Simplest unification proposal

1. **One `hooklib.py` in `plugins/atlas/hooks/`** exporting `read_hook_input()`, `find_repo_root()`, and `db_bootstrap()`. Collapses the top three duplication rows across all hooks; smallest diff with the largest dedup.
2. **Rebuild a single MCP `_shared`** (error-envelope, base-url, response-shaper, DomainHandler) and repoint every server at it, reconciling the vanta/knowbe4 drift to one definition. This also fixes CODE-audit H7 (auvik dangling import). Do these together.
3. Leave the root-skills / atlas-plugin / armada three-layer split as-is - it is a real boundary (external tools vs atlas ops vs org governance), not accidental duplication.
