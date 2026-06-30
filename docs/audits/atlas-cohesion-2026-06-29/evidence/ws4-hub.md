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

graphify `graph.json` nodes carry `source_file` but NO line spans (verified: `mcp_servers/auvik-mcp/
graphify-out/graph.json`, 387 nodes, zero line fields). So the manifest is **file-granular**: a
finding at `path:line` maps to the node whose `source_file` matches `path` (exact or longest-suffix),
else `node_match:"none"`. D3's "nearest-enclosing line span" is not achievable on file-level graphs,
and the hub HTML says so.

## Proof - build_hub against the real auvik graph

```
$ build_hub.py <sample-run> mcp_servers/auvik-mcp/graphify-out/graph.json
HIGH auvik-token-refresh -> auvik_mcp_package_bugs_url (exact)
MED  device-pagination   -> src_index (exact)
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
