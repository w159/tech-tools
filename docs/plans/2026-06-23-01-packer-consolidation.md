# Plan U1: Consolidate the 10 duplicated MCPB packer scripts

Goal: delete 10 byte-identical `scripts/pack-mcpb.js` copies and run every server's
`pack:mcpb` from the single canonical `mcp_servers/_shared/pack-mcpb.js`.

Flowchart: PATHFINDER-2026-06-02/01-flowcharts/build-and-pack-pipeline.md
Evidence: PATHFINDER-2026-06-02/02-duplication-report.md section A1

## Phase 0: Documentation Discovery (findings, verified 2026-06-02)

Read `mcp_servers/_shared/pack-mcpb.js` end to end before editing. Confirmed facts:

- All 10 copies are byte-identical to canonical. md5 of every copy AND canonical:
  `228389d781b08499ef6ae0715c17a0c0`. Servers: auvik, blumira, cipp,
  connectwise-manage, kaseya-spanning-backup, knowbe4, ninjaone, paylocity,
  threatlocker, vanta.
- Current `package.json` script in every server: `"pack:mcpb": "node scripts/pack-mcpb.js"`.
  Exact lines: auvik:16, blumira:22, cipp:22, connectwise-manage:22,
  kaseya-spanning-backup:16, knowbe4:22, ninjaone:22, paylocity:16, threatlocker:22, vanta:18.
- **CRITICAL CORRECTION.** The packer does NOT read from `process.cwd()`. At
  `pack-mcpb.js:40-44`:
  ```js
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const ROOT = resolve(__dirname, '..');
  const STAGING = resolve(ROOT, '.mcpb-staging');
  ```
  `ROOT` is derived from the script's physical location. Today the script lives at
  `<svc>-mcp/scripts/pack-mcpb.js`, so `ROOT` = `<svc>-mcp/` (correct). If you only repoint
  `package.json` to `node ../_shared/pack-mcpb.js`, the executed script is
  `mcp_servers/_shared/pack-mcpb.js`, `__dirname` becomes `mcp_servers/_shared`, and
  `ROOT` becomes `mcp_servers/`. The packer then aborts at line 57:
  `pack-mcpb: manifest.json missing at .../mcp_servers/manifest.json`.
- `ROOT` and everything derived from it (`STAGING`, `manifest.json` at line 56,
  `package.json` at line 68, `dist` entry checks, the final `.mcpb` output path at line 230)
  all flow from this one constant.
- npm runs `pack:mcpb` with the working directory set to the package root (the server dir).
  Therefore after the fix below, `process.cwd()` equals `<svc>-mcp/` for both the current
  `node scripts/pack-mcpb.js` invocation AND the new `node ../_shared/pack-mcpb.js`
  invocation. This is what makes the migration safe and reversible.

Allowed API: Node built-ins only (`fs`, `path`, `child_process`, `url`) - already imported.
No new dependency. No `mcpb` flag changes.

## Implementation

### Step 1: Make the canonical packer cwd-relative (the enabling fix)

In `mcp_servers/_shared/pack-mcpb.js`, change line 43 from:
```js
const ROOT = resolve(__dirname, '..');
```
to:
```js
// ROOT is the server being packed: npm sets cwd to the package root for `npm run`,
// so this works whether the script is invoked as scripts/pack-mcpb.js (legacy) or
// ../_shared/pack-mcpb.js (consolidated).
const ROOT = process.cwd();
```
Lines 40-42 (`__filename`/`__dirname`) may now be unused. Leave them ONLY if still
referenced elsewhere; grep the file for `__dirname` and `__filename` and delete the two
declarations if and only if there are no other uses. Do not delete the `fileURLToPath`
import if it is still referenced.

### Step 2: Prove the fix with copies still in place (no deletion yet)

Pick one tsup server (auvik) and the tsc server (cipp). Because the 10 copies are
byte-identical, Step 1 edited only `_shared`; the copies are now stale. Temporarily make
auvik and cipp use the shared script to prove cwd resolution works, OR copy the edited
`_shared/pack-mcpb.js` over those two copies and run:
```bash
cd mcp_servers/auvik-mcp && npm run build && npm run pack:mcpb   # expect auvik-mcp.mcpb
cd ../cipp-mcp && npm run build && npm run pack:mcpb             # cipp uses tsc
```
Both must produce a `.mcpb`. If either aborts on `manifest.json missing`, the cwd
assumption is wrong for that invocation - STOP and re-check before mass edits.

### Step 3: Repoint all 10 package.json scripts

In each server's `package.json`, change the `pack:mcpb` value from
`node scripts/pack-mcpb.js` to:
```
node ../_shared/pack-mcpb.js
```
Preserve the trailing comma exactly as it currently is per file (some have a trailing
comma, some do not - see the line list in Phase 0). Edit only the script value.

### Step 4: Delete the 10 copies

Delete each `mcp_servers/<svc>-mcp/scripts/pack-mcpb.js`. If a server's `scripts/`
directory becomes empty after deletion, leave the empty directory (git ignores empty dirs;
do not add churn). Do NOT create a re-export shim in its place.

### Step 5: Update docs that reference the per-server copy

- README.md:177, 590, 654 describe "drop a thin scripts/pack-mcpb.js into any server that
  re-exports it." Update to describe the single canonical packer referenced by path
  (`node ../_shared/pack-mcpb.js`). Keep counts/tables accurate per project CLAUDE.md.
- PATHFINDER-2026-06-02 docs are an evidence snapshot; do not rewrite them.

## Verification checklist

Run for at least 3 servers - two tsup plus cipp (tsc) - per the original acceptance bar:
```bash
for s in auvik vanta cipp; do
  ( cd mcp_servers/$s-mcp && npm run build && npm run pack:mcpb ) || { echo "FAIL $s"; break; }
  ls -la mcp_servers/$s-mcp/$s-mcp.mcpb
  node test-mcp-tools.mjs $s
done
```
Pass conditions:
1. Each `.mcpb` is produced (file exists, non-trivial size; the packer's own step 7 asserts
   the bundle contains the entry file and first prod dep).
2. `node test-mcp-tools.mjs <server>` prints PASS with the same tool count as before.
3. `grep -rl 'node scripts/pack-mcpb.js' mcp_servers/*/package.json` returns nothing.
4. `find mcp_servers -name pack-mcpb.js` returns only `mcp_servers/_shared/pack-mcpb.js`.

Recommended: run the FULL suite `node test-mcp-tools.mjs` once at the end to confirm no
server regressed, since all 10 now share one packer.

## Anti-pattern guards

- Do NOT introduce a wrapper, abstraction layer, or config registry. One script,
  referenced by path.
- Do NOT add per-server packer options "for flexibility."
- Do NOT symlink the script into each server - the team's git/Windows portability is
  uncertain; the `package.json` path reference is the chosen mechanism.
- Do NOT leave a thin re-export `scripts/pack-mcpb.js` "just in case."
- Do NOT bump any manifest version - this slice changes no user-visible tool surface.
