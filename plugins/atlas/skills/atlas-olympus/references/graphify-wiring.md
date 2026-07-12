# Graphify Wiring

How atlas plugin skills invoke the repo-root graphify skill to render
diagrams into `.atlas/docs/wiki/` from `.atlas/docs/architecture/` and the
ariadne graph.json. atlas-olympus wires this pipeline so the wiki stays
current without manual diagramming.

## The graphify skill

graphify lives at the repo root, not inside the atlas plugin:

    /Users/jerry/MEGA/Projects/Agentic/atlas/skills/graphify/SKILL.md

It is a top-level skill that turns any folder of files into a navigable
knowledge graph with community detection and three outputs: interactive
HTML, GraphRAG-ready JSON, and a plain-language GRAPH_REPORT.md.

## The wiki pipeline

atlas-olympus wires graphify as the wiki producer for the SSOT. The
pipeline is one-directional:

    .atlas/docs/architecture/  --graphify-->  .atlas/docs/wiki/diagrams/
    .atlas/docs/architecture/ariadne-graph.json  --graphify-->  wiki/diagrams/

### Inputs

1. `.atlas/docs/architecture/` - the architecture folder atlas-olympus
   scaffolds and atlas-ariadne populates. Holds boundaries, component
   maps, and ADRs.
2. `ariadne-graph.json` - the graph atlas-ariadne produces when it maps
   the codebase. This is the structured input graphify clusters and
   renders.

### Outputs

1. `.atlas/docs/wiki/diagrams/index.html` - interactive HTML graph
2. `.atlas/docs/wiki/diagrams/graph.json` - GraphRAG-ready JSON
3. `.atlas/docs/wiki/diagrams/GRAPH_REPORT.md` - plain-language report

### Invocation

A plugin skill invokes graphify by calling the slash command with the
architecture folder as the path and the wiki diagrams folder as the
output:

    /graphify .atlas/docs/architecture --no-viz
    # then move graphify-out/ into .atlas/docs/wiki/diagrams/

Or, when graphify supports an explicit output path, point it directly at
`.atlas/docs/wiki/diagrams/`. The skill body decides; the wiring contract
is only that the inputs and outputs are the two paths above.

## Wiki freshness check (completion gate)

atlas-olympus runs this check as the last step of onboarding and on every
subsequent run. It proves the wiki is not stale relative to the
architecture input.

### Check logic

1. Find the newest mtime of any file under `.atlas/docs/architecture/`.
2. Find the newest mtime of any file under `.atlas/docs/wiki/diagrams/`.
3. If `architecture` is newer than `wiki/diagrams/`, the wiki is STALE.
4. If `wiki/diagrams/` does not exist, the wiki is MISSING.
5. If `architecture/` does not exist, the check is N/A (nothing to render
   yet; atlas-ariadne has not run).

### Check command

    arch_newest=$(find .atlas/docs/architecture -type f -newer .atlas/docs/wiki/diagrams 2>/dev/null | head -1)
    if [ -n "$arch_newest" ]; then echo "WIKI STALE"; else echo "WIKI FRESH"; fi

### Gate behavior

- FRESH: onboarding passes. Report the wiki is current.
- STALE: onboarding reports the wiki is stale and recommends invoking
  graphify to refresh it before any other work.
- MISSING: onboarding reports the wiki has not been rendered and
  recommends atlas-ariadne first (to populate architecture/), then
  graphify (to render it).
- N/A: onboarding notes the architecture has not been mapped yet and
  recommends atlas-ariadne as the next step.

## Who owns what in this pipeline

| Stage | Owner | Output |
|---|---|---|
| Scaffold architecture/ and wiki/ folders | atlas-olympus | empty folders + README seeds |
| Populate architecture/ with maps and ADRs | atlas-ariadne | boundaries.md, ariadne-graph.json, ADRs |
| Render architecture/ into wiki/diagrams/ | graphify (invoked by olympus or ariadne) | HTML, JSON, GRAPH_REPORT.md |
| Check wiki freshness | atlas-olympus | FRESH / STALE / MISSING / N/A verdict |

## Why graphify lives at the repo root

graphify is a general-purpose knowledge graph tool, not an atlas-specific
skill. It is useful outside atlas (for any /raw folder workflow), so it
lives at the repo root and the atlas plugin calls it rather than shipping
a copy. This avoids version drift: when graphify updates, atlas gets the
update without a plugin release.

## What atlas-olympus does NOT do

- olympus does not run graphify on first scaffold if architecture/ is
  empty. There is nothing to render. It records the wiki as MISSING and
  moves on.
- olympus does not edit graphify. If graphify is missing or broken, the
  freshness check reports N/A and olympus recommends installing graphify
  or running atlas-doctor if the install is the problem.