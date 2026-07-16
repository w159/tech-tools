# graph.json to hub pipeline

This reference documents the Phase 4 pipeline that turns the architecture mode's per-root
graphify output and handoff prompts into a navigable, one-command-launchable
knowledge-graph hub. Read this when you are building the hub in Phase 4 of an
atlas-audit run, or debugging a hub that came out wrong.

## Pipeline shape

```
graphify (per root)             build_hub.py                  hub/
  graphify-out/graph.json  -->  ${CLAUDE_PLUGIN_ROOT}/  -->    manifest.json
handoffs/<system-slug>.md        scripts/build_hub.py         index.html
```

Inputs:
- One `graph.json` per discovered root, written by the `graphify` skill under
  each root's `graphify-out/`. the architecture mode runs graphify per root (Phase 1) so each
  graph stays under graphify's size gate.
- Every `handoffs/<system-slug>.md` prompt the orchestrator wrote in Phase 4.

Outputs, both under `<run_dir>/hub/`:
- `manifest.json` - the node-to-finding bridge, one entry per handoff.
- `index.html` - a branded Atlas expedition map. Each actionable node is a
  card with severity, the finding excerpt, and the exact `atlas-launch <id>`
  command to remediate.

The script is pure stdlib, idempotent (overwrites `hub/`), and tolerates
missing fields. Safe to run repeatedly.

## Invocation

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/build_hub.py" \
  "docs/audits/atlas-audit-<date>" \
  <each per-root graphify-out/graph.json>
```

With no graph paths, the script auto-discovers `graphify-out/graph.json`
under the repo root. Passing the paths explicitly is preferred in a
monorepo where several roots each produce their own graph.

## manifest.json schema

A JSON array, one entry per `handoffs/<id>.md` file, sorted by severity
(HIGH first) then id. Each entry has exactly these keys:

| key | type | source |
|---|---|---|
| `id` | string | the handoff filename with `.md` stripped (the `<system-slug>`) |
| `kind` | string | always `"finding"` for the architecture mode handoffs |
| `file` | string or null | first `file:line` citation parsed from the handoff body |
| `line` | int or null | the line number from that citation |
| `severity` | string | `HIGH`, `MED`, or `LOW`; defaults to `LOW` if the handoff does not state one |
| `node_id` | string or null | the graphify container node matched to `file` |
| `node_match` | string | how the match was made: `"file"`, `"dir"`, or `"none"` |
| `handoff_path` | string | path to the handoff file, relative to the run dir |
| `prompt_summary` | string | a short extract of the handoff prompt body |

## Matching is file-granular, not symbol-granular

Graphify nodes are sub-file: one node per symbol or key, and they carry no
line spans. That means the bridge cannot map a handoff to the exact symbol
its `file:line` points at. `build_hub.py` matches at the file level instead:

1. Parse the first `file:line` citation in the handoff body.
2. Index every graphify node by the file its `file_path` field names.
3. Match the handoff's file to a graphify node that owns that file. If
   several nodes share the file, the container node (the parent community)
   wins. If no file match exists, fall back to a directory match, then to
   `node_match: "none"`.

So a handoff that cites `src/auth/retry.ts:14` maps to the graphify node
whose file is `src/auth/retry.ts`. The node id is what `index.html` uses to
place the card on the expedition map. A `node_match: "none"` entry still
appears in the manifest and the HTML, just unplaced.

## What the architecture mode is responsible for

the architecture mode owns the hub only for structural-duplication findings: the
handoffs in `handoffs/<system-slug>.md` target duplicated subsystems to
collapse. Quality, security, and correctness findings belong to
atlas-audit and must not appear in an the architecture mode hub. If a handoff file
mentions a quality or security concern, that concern is out of scope for
the hub; the script will still include the entry, so the orchestrator must
keep the architecture mode handoffs purely structural.

## Failure modes to watch

- `node_match: "none"` on every entry usually means the graph paths were
  not passed and auto-discover missed the roots. Re-run with explicit
  `graphify-out/graph.json` paths.
- A handoff with no `file:line` citation parses to `file: null`,
  `line: null`, and severity `LOW`. The orchestrator rejects handoffs
  without evidence before the hub run, so this should not happen; if it
  does, fix the handoff, not the script.
- An empty `hub/manifest.json` means `handoffs/` was empty or absent.
  The hub run is a no-op in that case, not an error.