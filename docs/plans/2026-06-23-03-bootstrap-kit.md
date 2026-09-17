# Plan U3: Extract duplicated MCP server bootstrap into a shared kit

Goal: create `mcp_servers/_shared/mcp-kit.ts` exporting EXACTLY three things, then migrate
each fitting server's mechanical scaffolding to use it. Keep every vendor's credential shape,
base-URL logic, and status-report content in place. NO registry, NO DI container, NO plugin
framework.

Flowchart: PATHFINDER-2026-06-02/01-flowcharts/server-bootstrap-and-status.md
Evidence: PATHFINDER-2026-06-02/02-duplication-report.md sections A3, A4, A5
Prerequisite: U1 AND U2 done, so the `_shared` import path is proven to compile and pack for
both tsup and tsc servers. Reuse the exact tsconfig pattern U2 settled per build mode.

## Phase 0: Documentation Discovery (findings, verified 2026-06-02)

### Export 1: cleanEnv + isUnresolvedPlaceholder (SAFE - functionally identical everywhere)

All 8 sites are functionally byte-identical (only quote style varies). Canonical body to
lift verbatim from `auvik-mcp/src/credentials.ts:3-8` (then add `export`):
```ts
// Strip unresolved MCP host template placeholders (e.g. "${user_config.x}")
// and whitespace-only values so optional env vars fall through to their defaults.
export const isUnresolvedPlaceholder = (v: string | undefined): boolean =>
  !!v && /^\$\{[^}]+\}$/.test(v.trim());
export const cleanEnv = (v: string | undefined): string =>
  !v || isUnresolvedPlaceholder(v) ? '' : v.trim();
```
Semantics: `isUnresolvedPlaceholder` is true ONLY when the trimmed value is exactly one
`${...}` token. It does NOT match `<...>` and does NOT treat empty as a placeholder.
Sites to repoint (each currently a module-private `const`):
auvik-mcp/src/credentials.ts:5-8 - vanta-mcp/src/utils/client.ts:9-12 -
ninjaone-mcp/src/utils/client.ts:15-18 - paylocity-mcp/src/utils/client.ts:9-12 -
threatlocker-mcp/src/utils/client.ts:9-12 - blumira-mcp/src/utils/client.ts:6-9 -
kaseya-spanning-backup-mcp/src/utils/client.ts:6-9 - knowbe4-mcp/src/utils/client.ts:29-32.

### Export 2: makeStatusTool({ vendor, describe }) (TWO report shapes - design for both)

Shape A (auvik only): structured JSON object + a live network verify. Source for the
"never throws on missing creds" guard: `auvik-mcp/src/tools/status.ts:12-32` (early
`if (!c) return {...hasCredentials:false...}`). Report fields:
`{ ok, hasCredentials, region, note, verified?, status?, message? }`.
Shape B (the 5 navigation servers + ninjaone): plain-text summary, no network call, no
`isError`. Descriptor lives in `domains/navigation.ts`; the handler body lives in the
server's CallTool branch. Cleanest mechanical template:
`kaseya-spanning-backup-mcp/src/server.ts:44-57`.
Shape C (cipp): descriptor only at `cipp-mcp/src/mcp/tool.definitions.ts:874-881`, handled
via its ToolHandler map.

Design: `makeStatusTool({ vendor, describe })` returns the tool descriptor (name
`<vendor>_status`, `inputSchema: { type: 'object', properties: {} }`) and a handler that
calls the caller-supplied `describe: () => StatusReport`, serializes it, wraps it in
`content:[{type:'text', text}]`, and NEVER throws. Define `StatusReport` so it carries
either structured fields (auvik) or a pre-formatted text body (the rest). Keep auvik's live
verify INSIDE its `describe` callback; keep each navigation server's credStatus string
(which env vars, default base URL, extra fields) INSIDE its `describe` callback. The kit owns
only the mechanical wrapper and the never-throw contract.

Mechanical (identical everywhere): name pattern `<vendor>_status`, empty-object inputSchema,
the missing-creds-never-throws contract, the text-content wrapper.
Vendor CONTENT (stays in callbacks): credStatus string, vendor title, domains list, auvik's
verify call.

### Export 3: createServer({ name, version, tools, dispatch })

SDK imports (identical across all low-level servers; SDK >=1.12 everywhere):
```ts
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
```
`createServer` builds `new Server({name, version}, {capabilities:{tools:{}}})`, registers
`ListToolsRequestSchema` returning `annotate(tools, vendorTitle)` (import `annotate` from
`./annotate-tool.js` within `_shared`), and registers `CallToolRequestSchema` with a
try/catch that returns `{ content:[{type:'text', text}], isError:true }` on throw.
`dispatch` is a plain `(name: string, args, extra?) => Promise<CallToolResult>` function.

Cleanest template: `auvik-mcp/src/server.ts:195-218` - the only server that already uses a
`name -> handler` MAP dispatch (`HANDLERS[name]`) with a minimal try/catch CallTool body.
Second cleanest: `cipp-mcp/src/mcp/server.ts:110-129` (also map-based).

Wiring locations per server (Server / ListTools / CallTool):
- auvik server.ts 196 / 198-200 / 202-215 (MAP dispatch) - FITS BEST
- vanta server.ts 11-19 / 21-28 / 30-92 (if-chain + domain loop)
- ninjaone index.ts 163-174 / 181-188 / 193-378 (if-chain + domain loop)
- blumira server.ts 12 / 23-34 / 36-130
- paylocity server.ts 14 / 24-31 / 33-114
- threatlocker server.ts 12 / 26-33 / 36-113
- kaseya-spanning-backup server.ts 11 / 16-23 / 25-85
- knowbe4 index.ts 50 (module-level Server, not a factory) / 229-236 / 239-516

**CRITICAL CORRECTION - servers that do NOT fit createServer:**
- connectwise-manage (`src/index.ts:76`) uses the high-level `McpServer` + `server.tool(...)`
  API with NO ListTools/CallTool wiring. EXCLUDE from createServer. It may still adopt the
  shared `cleanEnv`.
- cipp is class-based (`CippMcpServer`) with TWO Server constructions (stdio at
  `src/mcp/server.ts:45`, per-request HTTP at :228). Treat as a follow-up, not first pass.
- knowbe4 constructs Server at module top-level; adopting createServer means refactoring
  module scope into a factory call (mechanical, slightly higher touch).
- The 6 navigation servers use an if-chain + per-domain loop with bespoke 401/403/429 hint
  strings in their catch. Decide explicitly: either the kit's CallTool catch emits a generic
  message (auvik style, loses tailored hints) OR `dispatch` throws typed errors the kit
  formats (preserves hints). RECOMMENDED: have `dispatch` throw a typed error and the kit
  format it, so no vendor loses its remediation hints. This keeps hint CONTENT in the vendor
  while the kit owns only the mechanical try/catch.

## Implementation (incremental, one export and one server at a time)

### Step 1: Create the kit with Export 1 only; migrate cleanEnv

Create `mcp_servers/_shared/mcp-kit.ts` exporting `cleanEnv` + `isUnresolvedPlaceholder`
(verbatim from auvik/credentials.ts:3-8). In each of the 8 sites, delete the local `const`
pair and import from `../../_shared/mcp-kit.js` (cipp: `../../../_shared/...` if a cipp site
is touched). Apply the U2 tsconfig pattern per build mode. Build + pack + test each touched
server. This is the lowest-risk export; land it fully before adding Export 2.

### Step 2: Add Export 2 (makeStatusTool); migrate status tools

Add `makeStatusTool` + the `StatusReport` type to the kit. Migrate one navigation server
first (kaseya - shortest), confirming `<vendor>_status` still returns a report with creds
removed and never throws. Then migrate the other navigation servers and auvik (auvik keeps
its structured report + live verify inside `describe`). Leave cipp's status as-is for now
(handled via its ToolHandler map; revisit only if cipp adopts createServer).

### Step 3: Add Export 3 (createServer); migrate the 8 fitting servers

Add `createServer`. Migrate auvik first (already map-based - smallest diff). For the 6
navigation servers, collapse the if-chain + domain loop into a single `dispatch(name, args)`
that looks up the right domain handler and throws a typed error on failure; pass that
`dispatch` to `createServer`. Migrate knowbe4 by wrapping its module-level boot in the
factory call. Migrate each server FULLY - do NOT keep old and new boot paths side by side
behind a flag. EXCLUDE connectwise-manage. Defer cipp.

Build + pack + test after EACH server migration, not in a batch.

## Verification checklist

```bash
node test-mcp-tools.mjs   # full suite after each export lands
```
Pass conditions:
1. Every server still boots with missing creds: `<vendor>_status` returns a report,
   no crash. Spot-check: temporarily unset one vendor's creds and confirm the status tool
   returns `hasCredentials:false` (or the text equivalent) without throwing.
2. Tool counts do not regress for any server.
3. `grep -rn "isUnresolvedPlaceholder" mcp_servers --include='*.ts' | grep -v _shared`
   returns only import lines, no local definitions.
4. connectwise-manage untouched except (optionally) its cleanEnv import.

## Anti-pattern guards

- `dispatch` is a plain `(name, args) => handler` function. Do NOT convert if-chains or
  switches into a registry/factory/DI container.
- Do NOT add a feature flag to keep old + new boot paths side by side - migrate each server
  fully or not at all.
- Do NOT centralize per-vendor credential SHAPE or base-URL defaults; those are legitimately
  specialized (duplication report section C). The kit owns env CLEANING, not credential
  STRUCTURE.
- Do NOT force connectwise-manage (high-level McpServer) into createServer.
- The kit exports exactly three things. Resist adding a fourth "while we are here."
