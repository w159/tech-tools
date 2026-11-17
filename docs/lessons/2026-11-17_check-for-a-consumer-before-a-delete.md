# Check for a consumer before a delete
Date: 2026-11-17
Area: repository cleanup (root folders, scripts, references)

## What happened
The first cleanup audit marked three things unused from a text search: `scorecard/probe_*.py`, `plugins/atlas/references/connector-config-flow.md` and the `colony/herdr-web-ui/scripts` files. A second, independent check found a consumer for each. `atlas_scorecard.py:34,41` loads the probes through a built import name. Three links point at `connector-config-flow.md`. The herdr-web-ui scripts are a vendor sync copy. The same check kept the root `mcp_servers/` and `mcp_node/`: `scripts/rebuild_armada_bundles.mjs:26-27` builds the armada bundles from them and `.github/workflows/armada-bundles.yml` runs that script. Nothing was deleted on the first audit's word. The root `skills/` folder was deleted (72 files, 12 skills) only after the second check found no manifest, script or CI job that loaded it.

## Why it happened
A text search for a file name finds literal mentions only. A name assembled at run time, a link from another doc, a vendor sync and a CI job that runs a script all escape it.

## What to do next time
1. Before a delete, list consumers by four routes: literal references, built names (string concatenation, `importlib`, globs), inbound doc links, and manifests, scripts and CI workflows that read the path.
2. Have a second check, independent of the first, try to find a consumer. Delete only when both find none.
3. For a root folder, read the build scripts and `.github/workflows/` first. A folder with no import can still be an input to a build.
4. Delete in one commit with the reference updates, then run the full suite (`python3 plugins/atlas/scripts/atlas_test.py run`).

## What to avoid
Trusting "0 hits" from one text search as proof a file is unused.
