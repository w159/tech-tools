# Plan U2: Remove 9 duplicated annotate-tool.ts copies; import the shared one

Goal: delete 9 byte-identical `src/annotate-tool.ts` copies and repoint every importer to
the canonical `mcp_servers/_shared/annotate-tool.ts`.

Flowchart: PATHFINDER-2026-06-02/01-flowcharts/server-bootstrap-and-status.md
Evidence: PATHFINDER-2026-06-02/02-duplication-report.md section A2
Prerequisite: U1 done (proves the build+pack loop). This slice proves the cross-`_shared`
TypeScript import resolves and bundles for BOTH tsup and tsc servers.

## Phase 0: Documentation Discovery (findings, verified 2026-06-02)

Canonical `mcp_servers/_shared/annotate-tool.ts` (174 lines). Exports:
- `annotate(tools: Tool[], vendorTitle?: string): Tool[]` (line 164) - the only symbol any
  server imports. Returns new objects, skips tools already annotated.
- `classifyTool(name: string): ToolClass` (line 127), `annotationsFor(name, title?)` (line 156),
  `export type ToolClass` (line 125) - not consumed by servers.
- Type dependency: `import type { Tool, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js"`
  (line 13). Every server already depends on the MCP SDK, so this resolves identically from `_shared`.

All 9 copies are byte-identical to canonical. md5 of each copy AND canonical:
`5b69d773f9775058c8e9faffb8553a81`. connectwise-manage has NO copy (skip it). Pure dedupe;
no content reconciliation.

Import sites to repoint (10 sites, 9 servers; all import only `annotate`; no `require` form):

| File:line | Current specifier | New specifier |
|---|---|---|
| auvik-mcp/src/server.ts:4 | `./annotate-tool.js` | `../../_shared/annotate-tool.js` |
| blumira-mcp/src/server.ts:9 | `./annotate-tool.js` | `../../_shared/annotate-tool.js` |
| cipp-mcp/src/mcp/server.ts:18 | `../annotate-tool.js` | `../../../_shared/annotate-tool.js` |
| kaseya-spanning-backup-mcp/src/server.ts:8 | `./annotate-tool.js` | `../../_shared/annotate-tool.js` |
| knowbe4-mcp/src/index.ts:45 | `./annotate-tool.js` | `../../_shared/annotate-tool.js` |
| ninjaone-mcp/src/index.ts:52 | `./annotate-tool.js` | `../../_shared/annotate-tool.js` |
| ninjaone-mcp/src/worker.ts:18 | `./annotate-tool.js` | `../../_shared/annotate-tool.js` |
| paylocity-mcp/src/server.ts:11 | `./annotate-tool.js` | `../../_shared/annotate-tool.js` |
| threatlocker-mcp/src/server.ts:8 | `./annotate-tool.js` | `../../_shared/annotate-tool.js` |
| vanta-mcp/src/server.ts:8 | `./annotate-tool.js` | `../../_shared/annotate-tool.js` |

Note: cipp's importer sits one directory deeper (`src/mcp/`), so its specifier needs THREE
`../`, not two.

**CRITICAL CORRECTION - the bundle/compile boundary is not free for every server.**
Build tool and resolution facts per server:

| Server | Build | tsconfig rootDir / include | dts | Boundary risk |
|---|---|---|---|---|
| kaseya-spanning-backup | tsup | src / src/**/* | no dts | NONE - bundles cleanly |
| auvik | tsup | src / src | dts:true | dts pass may emit TS6059 |
| blumira | tsup | src / src | dts:true | dts pass may emit TS6059 (2 entries) |
| paylocity | tsup | src / src | dts:true | dts pass may emit TS6059 |
| threatlocker | tsup | src / src | dts:true | dts pass may emit TS6059 (2 entries) |
| vanta | tsup | src / src | dts:true | dts pass may emit TS6059 |
| cipp | tsc | ./src / src/**/* | n/a | TS6059 at emit (hard blocker) |
| knowbe4 | tsc | ./src / src/**/* | n/a | TS6059 at emit (hard blocker) |
| ninjaone | tsc | ./src / src/**/* | n/a | TS6059 at emit (2 importers) |

tsup bundles relative imports into dist via esbuild regardless of rootDir, so JS output is
fine for the 6 tsup servers. The `dts: true` declaration pass uses the TS program and
respects `include`/`rootDir`, which can reject an out-of-root file. tsc servers reject at
JS emit because they do not bundle. No server `extends` a base config or defines `paths`.

## Implementation

Order matters: prove the hardest case (one tsc server) and one dts tsup server FIRST so the
tsconfig adjustment is settled before touching all 9.

### Step 1: Spike the two risky build modes before mass edits

Repoint and delete for ONE tsc server (knowbe4) and ONE dts tsup server (vanta) only:
1. Edit the import specifier (table above).
2. Delete that server's `src/annotate-tool.ts`.
3. `cd mcp_servers/<svc>-mcp && npm run build`.

If the build raises TS6059 ("File '.../_shared/annotate-tool.ts' is not under rootDir"),
apply the minimal tsconfig adjustment to bring `_shared` into the program:
- Add `"../_shared/annotate-tool.ts"` (or `"../_shared/**/*"`) to that server's tsconfig
  `include` array, and
- If `rootDir` is set to `./src`, widen it to a common ancestor by replacing
  `"rootDir": "./src"` with `"rootDir": ".."` AND adding `"rootDirs"` only if the emit
  layout needs it. Prefer the smallest change that compiles. Re-run `npm run build` and
  inspect `dist/` to confirm the entry file still emits at the expected path that
  `manifest.json` `server.entry_point` points to.

Document in this plan file which exact adjustment each build mode needed. If a tsc server
CANNOT be made to emit cleanly with a reasonable tsconfig change, the documented fallback is
a tiny workspace package (a `_shared` package the servers depend on via `file:`), NOT
re-copying the file and NOT a local re-export shim.

### Step 2: Apply to the remaining 7 servers

Once Step 1 establishes the working tsconfig pattern per build mode, repeat for the other
servers: edit specifier, delete local copy, adjust tsconfig if that server's build mode
required it in Step 1. Remember ninjaone has TWO importers (index.ts:52 and worker.ts:18)
and cipp needs the 3-level `../../../_shared` specifier.

### Step 3: Confirm no dangling references

```bash
grep -rn "annotate-tool" mcp_servers --include='*.ts' | grep -v _shared | grep -v dist
# expect: only the repointed import lines, no local module file references
find mcp_servers -path '*/src/annotate-tool.ts'
# expect: nothing (all 9 deleted)
```

## Verification checklist

```bash
for s in auvik blumira cipp kaseya-spanning-backup knowbe4 ninjaone paylocity threatlocker vanta; do
  ( cd mcp_servers/$s-mcp && npm run build && npm run pack:mcpb ) || { echo "BUILD/PACK FAIL $s"; break; }
done
node test-mcp-tools.mjs   # full suite
```
Pass conditions:
1. `npm run build` succeeds for all 9 touched servers (no TS6059, no unresolved import).
2. Each `.mcpb` packs (the packer asserts the entry file is present in the bundle).
3. Full `node test-mcp-tools.mjs` PASSes and NO server's tool count regresses (annotate only
   enriches descriptions; it never adds or removes tools).
4. `find mcp_servers -path '*/src/annotate-tool.ts'` returns nothing.

## Anti-pattern guards

- Do NOT create a published npm package or a DI container just to share one file UNLESS a
  tsc server's import genuinely cannot resolve with a reasonable tsconfig change (then the
  documented fallback is a minimal `file:` workspace package).
- Do NOT keep a local re-export shim "just in case."
- Do NOT modify the canonical `_shared/annotate-tool.ts` - it is the source of truth.
- connectwise-manage has no copy and no importer; do not touch it.
