# WS4 evidence - knowledge-graph hub + atlas-launch launcher

Date: 2026-06-30. Branch: atlas-ws4-hub.

## What shipped (closes the audit -> remediation loop)

- `scripts/build_hub.py` - turns an audit run dir (`handoffs/<id>.md` + graphify `graph.json`) into
  `hub/manifest.json` (node<->finding bridge) and a branded `hub/index.html` (Atlas expedition-map
  theme). Stdlib-only.
- `commands/atlas-launch.md` - `atlas-launch <id>` loads a finding's handoff, sets the orchestration
  marker, and invokes the `atlas-engine` skill with the handoff as its opening task; no-arg lists the
  actionable findings. No `/atlas-engine` command is invented.
- `atlas-survey` + `atlas-cartographer` - handoff prompts now end with `atlas-launch <id>` (not the
  phantom `/atlas-engine`), Output trees gain `hub/`, and both build the hub after writing handoffs.
- `atlas-engine` - explicit "opening task may be a handoff from atlas-launch" contract.

## Design correction (honest, verified against the engine)

graphify `graph.json` nodes are **sub-file** - one per symbol/import/JSON key, NOT one per file
(verified: `mcp_servers/auvik-mcp/graphify-out/graph.json` has 387 nodes across only 35 files; e.g.
`package.json` owns ~40 nodes), and they carry no line spans. So the manifest is **file-granular**:
a finding at `path:line` maps to that file's representative (container) node - `build_hub` keeps the
first node per `source_file` (graphify emits the file-container node first), with `node_match` =
`file` | `file-suffix` | `none`. It never claims a node-`exact` precision the graph cannot support,
and D3's "nearest-enclosing line span" is honestly out of reach.

## Proof - build_hub against the real auvik graph

```
$ build_hub.py <sample-run> mcp_servers/auvik-mcp/graphify-out/graph.json
HIGH auvik-token-refresh -> package_json (file)     # container node, not an arbitrary sub-node
MED  device-pagination   -> src_index_ts (file)
```

A finding whose file is absent from the graph resolves to `node_id=null, node_match="none"` - it is
never guessed. Sample hub rendered at `evidence/ws4-sample-run/hub/index.html`.

## Tests
`scripts/test_build_hub.py` (3 tests): one manifest entry per handoff with parsed file:line+severity;
real nodes resolve while a made-up file is marked `none`; `build_hub` writes manifest.json +
index.html with HIGH sorted before LOW. Full suites: `scripts` OK, `hooks` OK.

## Propagation
`plugin.json` launcher count 15 -> 16; README command table + counts updated (16 launchers / 17
commands); survey + cartographer Output trees list `hub/`.

## Not done (flagged)
- A full live survey -> hub -> launch round-trip needs a real survey run; the fixture proves the
  machinery deterministically. The launcher's atlas-engine invocation is exercised by reading the
  command, not by a live multi-session run.
