---
name: atlas-wiki
disable-model-invocation: true
description: 'Generates and refreshes the docs/wiki/ diagrams from docs/architecture/ by invoking the graphify skill. Keeps the wiki fresh as the codebase changes. Use when architecture docs are updated, before completion, or when wiki diagrams are stale or missing.'
when_to_use: 'wiki is stale or missing, architecture changed and diagrams need refresh, before completion gate, generate diagrams from architecture docs'
allowed-tools: Read, Glob, Grep, Bash
---

# atlas-wiki

Wiki diagram producer for the Atlas single source of truth. This skill is
the missing producer half of the graphify pipeline: it invokes the repo-root
graphify skill on `docs/architecture/` and lands the rendered
diagrams in `docs/wiki/diagrams/`. atlas-audit consumes the
resulting `graph.json` to build its navigable hub; atlas-setup checks the
wiki freshness this skill produces as part of its completion gate.

## Pipeline

The flow is one-directional. Architecture docs go in; rendered diagrams
come out.

    docs/architecture/  --/graphify-->  graphify-out/  --move-->  docs/wiki/diagrams/

### Inputs

1. `docs/architecture/` - the architecture folder atlas-setup
   scaffolds and atlas-audit populates. Holds boundaries, component
   maps, ADRs, and `architecture-graph.json`.
2. The repo-root graphify skill at
   `skills/graphify/SKILL.md` (relative to the project root).

### Outputs

1. `docs/wiki/diagrams/index.html` - interactive HTML graph
   (graphify writes `graph.html`; rename on move).
2. `docs/wiki/diagrams/graph.json` - GraphRAG-ready JSON consumed
   by atlas-audit's `build_hub.py`.
3. `docs/wiki/diagrams/GRAPH_REPORT.md` - plain-language audit
   report.
4. `docs/wiki/diagrams/graph.svg` - embeddable SVG diagram.

### What this skill does NOT own

- Populating `docs/architecture/` - that is atlas-audit's job.
- Consuming `graph.json` into a hub - that is atlas-audit's Phase 4 job.
- Editing the repo-root graphify skill - never. graphify is general
  purpose and lives at the repo root for a reason.
- Scaffolding the wiki/ folder - that is atlas-setup's scaffold step.

## Invocation

This skill invokes the repo-root graphify skill as a slash command.
graphify has no `--output` flag; it always writes to `graphify-out/` in
the current working directory. So the producer runs graphify from the
repo root, then moves `graphify-out/` into `docs/wiki/diagrams/`.

See `references/graphify-invocation.md` for the exact, confirmed command
string and the graphify SKILL.md lines it is based on.

### Step 1 - Pre-flight: check the inputs exist

Before invoking graphify, confirm the architecture folder is present and
non-empty. If it is missing or empty, there is nothing to render. Report
the wiki as MISSING and stop. Do not invoke graphify on an empty folder;
it will exit with "No supported files found" and that is noise.

```bash
# Run from the repo root.
arch_dir="docs/architecture"
wiki_dir="docs/wiki/diagrams"

if [ ! -d "$arch_dir" ] || [ -z "$(ls -A "$arch_dir" 2>/dev/null)" ]; then
  echo "MISSING: $arch_dir does not exist or is empty. Run atlas-audit first."
  exit 0
fi
```

### Step 2 - Run the freshness check

Before re-rendering, check whether a refresh is even needed. If the wiki
is already fresher than the architecture, stop. No work to do.

```bash
bash "${CLAUDE_SKILL_DIR}/scripts/check_wiki_freshness.sh" "$(pwd)"
```

Exit 0 with "FRESH" means the wiki is current; stop here. Exit 0 with
"MISSING" means the wiki has never been rendered; continue to Step 3.
Exit 1 with "STALE" means the architecture is newer; continue to Step 3.

### Step 3 - Invoke graphify

Invoke the repo-root graphify skill on the architecture folder with the
`--svg` flag so an embeddable SVG is produced alongside the HTML and
JSON. Use `--no-viz` only when the HTML is not wanted; by default the
HTML is the primary navigable artifact and should be kept.

The exact invocation and the flags' grounding in graphify/SKILL.md are
documented in `references/graphify-invocation.md`. The short form:

    /graphify docs/architecture --svg

graphify writes its outputs to `graphify-out/` in the current working
directory (the repo root). It does not accept an output path flag.

### Step 4 - Move graphify-out/ to wiki/diagrams/

After graphify finishes, move its output directory into the wiki.

```bash
mkdir -p "$wiki_dir"
# Remove stale outputs so the move does not merge old and new.
rm -rf "$wiki_dir"/*
# graphify writes graph.html; the wiki contract calls it index.html.
if [ -f graphify-out/graph.html ]; then
  mv graphify-out/graph.html "$wiki_dir/index.html"
fi
# graph.json, GRAPH_REPORT.md, and graph.svg keep their names.
mv graphify-out/graph.json "$wiki_dir/graph.json" 2>/dev/null || true
mv graphify-out/GRAPH_REPORT.md "$wiki_dir/GRAPH_REPORT.md" 2>/dev/null || true
mv graphify-out/graph.svg "$wiki_dir/graph.svg" 2>/dev/null || true
# Carry any cost.json forward so cumulative cost tracking survives.
mv graphify-out/cost.json "$wiki_dir/cost.json" 2>/dev/null || true
# Clean up the now-empty graphify-out/ directory.
rmdir graphify-out 2>/dev/null || rm -rf graphify-out
```

### Step 5 - Verify

Re-run the freshness check. It should now report FRESH.

```bash
bash "${CLAUDE_SKILL_DIR}/scripts/check_wiki_freshness.sh" "$(pwd)"
```

If it still reports STALE, the move failed or graphify produced nothing.
Report the failure with the script's output and stop. Do not silently
leave a stale wiki in place.

## When to run

This skill auto-triggers. Run it when any of the following are true:

- The freshness check reports STALE or MISSING and architecture/ is
  non-empty.
- atlas-audit has just finished populating architecture/ and the wiki
  has never been rendered.
- atlas-setup is running its completion gate and the wiki is stale.
- The user explicitly asks to refresh or regenerate the wiki diagrams.

Do not run it when:

- architecture/ is empty or missing (nothing to render; report MISSING
  and defer to atlas-audit).
- The freshness check reports FRESH (the wiki is current).
- graphify itself is broken or uninstalled; report that and defer to
  atlas-setup.

## Freshness check

`scripts/check_wiki_freshness.sh` compares the newest mtime under
`docs/architecture/` against the newest mtime under
`docs/wiki/diagrams/`. It emits one of three verdicts:

| Verdict | Exit | Meaning |
|---|---|---|
| FRESH | 0 | wiki/diagrams/ is newer than architecture/, or architecture/ is absent (nothing to render). |
| MISSING | 0 | wiki/diagrams/ does not exist or is empty, but architecture/ is non-empty. |
| STALE | 1 | Some architecture file is newer than the newest wiki diagram. |

Runnable from anywhere:

    bash "${CLAUDE_SKILL_DIR}/scripts/check_wiki_freshness.sh" <repo-root>

Defaults to the current working directory when no repo-root is given.

## Relationship to atlas-audit

atlas-audit Phase 4 consumes `graphify-out/graph.json` to build its
navigable hub via `${CLAUDE_PLUGIN_ROOT}/scripts/build_hub.py`. This skill produces the
`graph.json` that atlas-audit consumes. The two skills do not edit each
other; the contract is the file path and the JSON shape, both owned by
graphify's `to_json` export (graphify/SKILL.md Step 4).

When atlas-audit runs its own per-root graphify passes during discovery,
those `graphify-out/graph.json` files feed the hub directly. This skill
fills the gap atlas-audit does not: rendering the architecture/ folder into
the long-lived wiki/diagrams/ home that survives across atlas-audit runs.

## Relationship to atlas-setup

atlas-setup owns the completion gate and the freshness verdict this
skill's script produces. atlas-setup calls the freshness check; when the
verdict is STALE or MISSING, atlas-setup recommends invoking this skill (or
atlas-audit first, if architecture/ is empty). This skill does not
decide the gate; it only does the rendering work the gate demands.

See `${CLAUDE_SKILL_DIR}/references/graphify-wiring.md`
for the full wiring contract.