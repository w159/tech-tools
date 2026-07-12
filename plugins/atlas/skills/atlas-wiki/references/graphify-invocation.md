# Graphify Invocation

The exact, confirmed invocation of the repo-root graphify skill used by
atlas-wiki to render `.atlas/docs/architecture/` into
`.atlas/docs/wiki/diagrams/`. Every flag and path here is grounded in
the graphify skill file at
`/Users/jerry/MEGA/Projects/Agentic/atlas/skills/graphify/SKILL.md`.
Nothing is invented.

## The invocation

From the repo root, after confirming `.atlas/docs/architecture/` is
non-empty:

    /graphify .atlas/docs/architecture --svg

Then move the resulting `graphify-out/` into the wiki:

    mkdir -p .atlas/docs/wiki/diagrams
    rm -rf .atlas/docs/wiki/diagrams/*
    mv graphify-out/graph.html .atlas/docs/wiki/diagrams/index.html
    mv graphify-out/graph.json .atlas/docs/wiki/diagrams/graph.json
    mv graphify-out/GRAPH_REPORT.md .atlas/docs/wiki/diagrams/GRAPH_REPORT.md
    mv graphify-out/graph.svg .atlas/docs/wiki/diagrams/graph.svg
    rm -rf graphify-out

## Why there is no output-path flag

graphify does NOT accept an `--output`, `-o`, or outdir flag. It always
writes to `graphify-out/` in the current working directory. The Usage
block (graphify/SKILL.md lines 13-35) lists every flag the skill accepts;
none of them selects an output location. Step 1 of the skill body
(graphify/SKILL.md line 73) runs `mkdir -p graphify-out`, and every
output write targets `graphify-out/`:

- `graphify-out/graph.json` (line 421): `to_json(G, communities,
  'graphify-out/graph.json')`
- `graphify-out/GRAPH_REPORT.md` (line 420): `Path('graphify-out/
  GRAPH_REPORT.md').write_text(report)`
- `graphify-out/graph.html` (line 538): `to_html(G, communities,
  'graphify-out/graph.html', community_labels=labels or None)`
- `graphify-out/graph.svg` (line 599, only with `--svg`): `to_svg(G,
  communities, 'graphify-out/graph.svg', community_labels=labels or
  None)`

Because the output directory is fixed relative to CWD, the producer runs
graphify from the repo root and moves `graphify-out/` into
`.atlas/docs/wiki/diagrams/` afterward. This matches the wiring
contract's fallback ("then move graphify-out/ into
.atlas/docs/wiki/diagrams/") in
`plugins/atlas/skills/atlas-olympus/references/graphify-wiring.md`.

## Flags used and why

### `--svg` (required for the wiki)

graphify/SKILL.md line 21:

    /graphify <path> --svg                                # also export graph.svg (embeds in Notion, GitHub)

Without `--svg`, graphify writes `graph.html` and `graph.json` but skips
the SVG export (Step 7b is gated on the flag, line 584-602). The wiki
contract wants an embeddable SVG for READMEs and Notion pages, so
`--svg` is always passed.

### Path argument

graphify/SKILL.md line 14:

    /graphify <path>                                      # full pipeline on specific path

The path is `.atlas/docs/architecture/` (the folder
atlas-ariadne populates). graphify Step 2 (line 86-93) runs its
`detect()` on this path and reports the corpus summary.

## Flags NOT used and why

### `--no-viz`

graphify/SKILL.md line 18:

    /graphify <path> --no-viz                             # skip visualization, just report + JSON

Not used. The wiki's primary artifact is the interactive HTML graph;
`--no-viz` would skip it (Step 6, line 518-541). The HTML is the
navigable surface atlas-ariadne's hub links into.

### `--mode deep`

graphify/SKILL.md line 16. Not used for the wiki. Deep mode produces
richer INFERRED edges, which is useful for one-off discovery but adds
LLM cost and AMBIGUOUS edges the wiki does not need. The wiki is a
structural map, not a semantic deep-dive.

### `--update`

graphify/SKILL.md line 17. Not used. `--update` re-extracts only
new/changed files and merges into an existing `graphify-out/graph.json`
(lines 736-851). It requires a prior `graphify-out/` to exist in the CWD.
Because atlas-wiki moves `graphify-out/` away after each render, there is
no stable `graphify-out/` to update against. A full re-render is simpler
and the architecture folder is small. If the architecture folder grows
large enough that full re-render is too slow, a future revision can keep
a shadow `graphify-out/` in place and switch to `--update`.

### `--exclude <glob>`

graphify/SKILL.md line 19. Not used by default. graphify's `detect()`
already prunes `node_modules`, `.venv`, `dist`, `build`, `__pycache__`,
`.ruff_cache`, `graphify-out`, and similar generated/vendor dirs
(graphify/SKILL.md lines 127-143). The architecture folder should not
contain any of these. If a future architecture folder does pick up
generated content that graphify does not auto-skip, pass
`--exclude <glob>` for those paths.

### `--html`

graphify/SKILL.md line 20 notes this flag is a no-op: "HTML is generated
by default - this flag is a no-op". Omitted; the default already
produces `graph.html`.

### `--graphml`, `--neo4j`, `--neo4j-push`, `--mcp`, `--watch`

graphify/SKILL.md lines 22-26. None of these serve the wiki contract.
They export to Gephi, Neo4j, an MCP server, or a file watcher. The wiki
wants HTML, JSON, and SVG only.

## How ariadne's graph.json fits in

atlas-ariadne Phase 4 consumes `graphify-out/graph.json` files via
`scripts/build_hub.py` (atlas-ariadne/SKILL.md, Phase 4):

    python3 "${CLAUDE_PLUGIN_ROOT}/scripts/build_hub.py" \
      ".atlas/docs/audits/atlas-ariadne-<date>" \
      <each per-root graphify-out/graph.json>

This skill produces the long-lived `graph.json` at
`.atlas/docs/wiki/diagrams/graph.json` - the same JSON shape graphify's
`to_json` emits (graphify/SKILL.md line 421). ariadne's own per-root
`graphify-out/graph.json` files are produced during ariadne's discovery
pass and are ephemeral; this skill's wiki `graph.json` is the stable
copy that survives across ariadne runs. ariadne can point
`build_hub.py` at the wiki `graph.json` when it wants the stable graph
rather than its own ephemeral per-root copies.

## Pre-flight and post-flight

Before invoking graphify, atlas-wiki runs
`scripts/check_wiki_freshness.sh`. If architecture/ is empty, it reports
FRESH (nothing to render) and the skill stops without invoking
graphify. If the wiki is already FRESH, the skill stops. After the move,
the script is re-run to confirm FRESH; a non-FRESH verdict after the
move is a failure to report, not a silent state.

## Limitation

graphify is a slash-command skill the agent executes as a multi-step
pipeline (graphify/SKILL.md lines 52-731). It is not a standalone CLI
binary the skill can call with a single `graphify --svg` shell command.
The invocation above is a slash command the agent invokes in the
session, not a subprocess. The move step runs after the slash command's
pipeline completes and writes `graphify-out/`. This is the closest
achievable invocation given graphify's design; there is no subprocess
form.