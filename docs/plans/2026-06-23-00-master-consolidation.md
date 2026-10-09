# Master Plan: MCP Monorepo Duplication Consolidation

Source: PATHFINDER-2026-06-02 duplication report + handoff prompts (U1-U5).
Authored by `/make-plan` after Phase 0 fact-gathering against live source on 2026-06-02.

Each slice below is a self-contained plan file executable in its own chat context.
Execute in the order given. U1 and U2 prove the `_shared` boundary packs cleanly;
U3 depends on both. U4 and U5 are independent of each other and of U3.

## Dependency order

```
01 packer (U1)        --.
02 annotate-tool (U2) --+--> 03 bootstrap-kit (U3)
04 vanta-factory (U4)     (independent)
05 auvik-helpers (U5)     (independent)
```

- **01-packer-consolidation.md** (U1) - do first. Smallest blast radius, and it
  validates the build+pack loop the other slices rely on for verification.
- **02-annotate-tool-consolidation.md** (U2) - second. Proves a cross-`_shared`
  TypeScript import resolves and bundles for both tsup and tsc servers.
- **03-bootstrap-kit.md** (U3) - third. Depends on the proven import path from U2.
- **04-vanta-domain-factory.md** (U4) - any time. Touches only vanta-mcp.
- **05-auvik-node-helpers.md** (U5) - any time. Touches only node-auvik.

## Cross-cutting Phase 0 findings (apply to every slice)

These were verified by reading source, not assumed. Where a handoff prompt's premise
was wrong, the corrected fact is marked CORRECTION.

1. **CORRECTION (U1):** `mcp_servers/_shared/pack-mcpb.js:43` computes
   `ROOT = resolve(__dirname, '..')` where `__dirname` is the script's own location
   (`import.meta.url`, line 40), NOT `process.cwd()`. The handoff prompt's claim that
   "the packer reads from process.cwd() so cwd-relative behavior is preserved" is false.
   Repointing `package.json` to `node ../_shared/pack-mcpb.js` without changing the
   packer makes `ROOT` resolve to `mcp_servers/` and the pack aborts at line 57
   (`manifest.json missing at mcp_servers/manifest.json`). U1 fixes this with a single
   line: `ROOT = process.cwd()`.

2. **CORRECTION (U2):** Crossing the `_shared` boundary is not free for every server.
   - tsc servers (cipp, knowbe4, ninjaone) enforce `rootDir: ./src` + `include: ["src/**/*"]`;
     importing `../../_shared/...` raises TS6059 ("not under rootDir") at emit.
   - tsup servers with `dts: true` (auvik, blumira, paylocity, threatlocker, vanta)
     may raise TS6059 only during the declaration pass (JS bundling is fine).
   - Only kaseya-spanning-backup (tsup, no dts) is clean as-is.
   - cipp's importer is one directory deeper (`src/mcp/server.ts`), so its specifier is
     `../../../_shared/...`, not `../../_shared/...`.

3. **CORRECTION (U3):** Not all servers share one bootstrap shape.
   - connectwise-manage uses the high-level `McpServer` + `server.tool(...)` API with NO
     `ListToolsRequestSchema`/`CallToolRequestSchema` wiring. Exclude it from `createServer`.
   - cipp is class-based with two `Server` constructions (stdio + per-request HTTP).
   - knowbe4 constructs `Server` at module top-level, not inside a factory.
   - Status tools come in two shapes: auvik returns structured JSON and runs a live verify;
     the rest return a plain-text summary with no network call.

4. **CORRECTION (U5):** The two "new" files already exist under different names.
   `mcp_node/node-auvik/src/pagination.ts` is the cursor iterator (name collision), and
   `mcp_node/node-auvik/src/json-api-mapper.ts` already exports the flattening helpers.
   The list-mapping output shape is already inconsistent: six files emit
   `{ id, type, ...attributes }`, two already use the helper that emits `{ id, ...attributes }`
   (no `type`). Byte-equivalence requires picking one canonical shape first.

## Repo invariants every slice must honor (project CLAUDE.md)

- Any change to a vendor's user-visible surface (tool name/description/count) must
  propagate: domain handler -> manifest.json (version bump) -> rebuild `.mcpb` -> README
  counts -> test-mcp-tools.mjs probes. Pure dedupe with zero surface change (U1, U2, U5)
  does not bump versions but still requires a rebuild + pack + test per touched server.
- The `<vendor>_status` tool must always run with missing credentials and never throw.
- `node test-mcp-tools.mjs <server>` must PASS and tool counts must not regress after each slice.

## Global verification gate (run after every slice)

```bash
# Per touched server:
cd mcp_servers/<svc>-mcp && npm run build && npm run pack:mcpb
cd /Users/jerry/Downloads/ai-tech-toolkit && node test-mcp-tools.mjs <svc>
# Capture the "(N tools)" line; it must equal the pre-change baseline.
```

The harness prints `PASS (N tools)` but does NOT dump tool names. For U4 (and any slice
that could rename a tool), capture a name-level baseline by dumping `tools/list` from the
packed bundle over stdio BEFORE the change and diffing the sorted name set after.
