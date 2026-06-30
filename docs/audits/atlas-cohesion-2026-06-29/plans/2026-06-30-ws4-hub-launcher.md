# WS4 - Knowledge-graph hub + atlas-launch launcher + engine hardening

Branch: atlas-ws4-hub (off main, after WS2 merges)
Program spec: ../program-spec.md (WS4 section, decisions D2/D3/D4)

## Goal (the user's original cohesion ask)

Close the loop: cartographer/survey produce findings + a graph; the hub turns each actionable
finding into a clickable node and a one-command remediation launch (`atlas-launch <id>`) that
starts an atlas-engine session pre-loaded with that finding's handoff. No more dead-end audits.

## Verified design facts (corrects spec assumptions)

- Both cartographer (`SKILL.md:64-66,104-105`) and survey (`SKILL.md:76-77,82`) already write
  `docs/audits/atlas-<skill>-<date>/handoffs/<id>.md` remediation prompts - but they reference a
  NON-EXISTENT `/atlas-engine` command. D4 fix: target `atlas-launch`.
- `atlas-handoff` (command) is the session-RESUME checkpoint - a different "handoff" sense. Keep
  its name; the new launcher is `atlas-launch`. Add a one-line disambiguation in each skill.
- graphify `graph.json` nodes carry `source_file` (all nodes) and `id`/`label`/`community`/
  `file_type`, but **no line spans** (verified on `mcp_servers/auvik-mcp/graphify-out/graph.json`,
  387 nodes, zero line fields). So D3's "nearest-enclosing span by file:line" degrades honestly to
  **file-level** matching: a finding at `path:line` maps to the node whose `source_file == path`
  (or the longest suffix match). The manifest records this is file-granular.
- 15 `/atlas-*` launchers today; no `atlas-launch`, no `hub/`.

## Tasks

### Task 1 - `scripts/build_hub.py` (the machinery, fixture-tested)
A stdlib script: `build_hub(run_dir, graph_jsons)` that
- reads every `handoffs/<id>.md` and the run's `report.md`/`findings/*.md` for `file:line` +
  severity (best-effort parse; tolerate missing fields),
- loads one or more `graphify-out/graph.json`, indexes nodes by `source_file`,
- writes `hub/manifest.json` = array of `{id, kind:"finding"|"system", file, line, severity,
  node_id, node_match:"exact|suffix|none", handoff_path, prompt_summary}` (D3, file-granular),
- copies/overlays each graph into `hub/` and emits a branded `hub/index.html` (Task 2).
- [ ] Check: `scripts/test_build_hub.py` runs build_hub on a temp run-dir (2 handoffs + a small
  findings file) against the real auvik `graph.json` fixture and asserts: manifest.json exists,
  has one entry per handoff, each entry's `node_id` resolves to a real node id (or
  `node_match:"none"` when the file is absent from the graph), and index.html is non-empty.

### Task 2 - branded Atlas hub HTML (in build_hub.py)
`hub/index.html`: the graphify graph rendered with actionable nodes marked; clicking a marked node
shows its finding, the handoff excerpt, and the exact `atlas-launch <id>` command. Atlas theme
(approved): cartography/discovery narrative (maps, compass, sextant, expedition) and an Atlas token
set - its OWN palette/type/iconography, NOT Henssler client tokens. Self-contained (inline CSS/JS,
reads `manifest.json` + `graph.json`; no network, no build step).
- [ ] Check: open `hub/index.html` from the Task 1 fixture run; it renders, lists the actionable
  nodes, and each shows a copyable `atlas-launch <id>`. Capture a screenshot to evidence/.

### Task 3 - `commands/atlas-launch.md`
- `atlas-launch <id>`: find the most recent `docs/audits/atlas-*-<date>/hub/manifest.json`, resolve
  `<id>`, load its `handoff_path` prompt, set the D1 orchestration marker
  (`atlas_db.py mark-orchestrating "${CLAUDE_CODE_SESSION_ID}" "$(pwd)"`), and invoke the
  `atlas-engine` skill with the handoff as the opening task.
- No-arg: list the actionable nodes (id, severity, summary) from the most recent run's manifest.
- NO new `/atlas-engine` command is created - `atlas-launch` is the single launcher; `atlas-engine`
  stays the skill it invokes.
- [ ] Check: `atlas-launch` (no arg) on the fixture run lists the actionable ids; the file exists
  with valid frontmatter (`grep -l description commands/atlas-launch.md`).

### Task 4 - wire survey + cartographer
- Output trees gain `hub/` (manifest.json + index.html + copied graph).
- After writing `handoffs/`, the orchestrator runs `build_hub.py` on the run dir.
- Handoff prompts target `atlas-launch <id>` (drop the phantom `/atlas-engine`); add the
  atlas-handoff-vs-atlas-launch disambiguation note.
- [ ] Check: `grep -n "atlas-launch" skills/atlas-survey/SKILL.md skills/atlas-cartographer/SKILL.md`
  present; `grep -n "/atlas-engine" skills/atlas-cartographer/SKILL.md` no longer used as a command
  (the skill is still referenced as a skill, not a slash command).

### Task 5 - harden atlas-engine (approved scope add)
As the substrate atlas-launch invokes, atlas-engine must: set the D1 marker on start (already wired
WS1), consume a handoff prompt as its opening task (make explicit in SKILL), and rely on the WS2
recall/dispatch/finalize signals (already wired). Fix any concrete marker/finalize lifecycle gap
surfaced while wiring. Keep targeted - no rewrite.
- [ ] Check: atlas-engine SKILL has an explicit "opening task may be a handoff prompt from
  atlas-launch" line; the existing hook/DB suites stay green.

### Task 6 - propagation + evidence
- `plugin.json:4`: launcher count 15 -> 16 (atlas-launch). README: add a hub section; survey/
  cartographer Output trees updated (Task 4).
- [ ] Final: `node ../../test-mcp-tools.mjs` not needed (no MCP change); run the atlas test suites;
  capture build_hub fixture output + HTML screenshot to
  `docs/audits/atlas-cohesion-2026-06-29/evidence/ws4-hub.md`.

## Acceptance
On a fixture run dir (handoffs + findings + a real graph.json), build_hub produces a manifest whose
entries resolve to real graph nodes and a branded hub/index.html that lists actionable nodes with
their `atlas-launch <id>` commands; `atlas-launch` no-arg lists those ids. (A full live survey ->
hub -> launch round-trip is demonstrated if a survey run is available, else the fixture proves the
machinery.)

## Out of scope (YAGNI)
- No live web server / cockpit (companion-skill launch model only).
- No second graph substrate (overlay the graphify graph).
- Line-level node matching (graphify graphs are file-level; manifest is file-granular and says so).
