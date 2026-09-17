# Plan U4: Replace hand-written Vanta domain handlers with a single factory

Goal: introduce `mcp_servers/vanta-mcp/src/domains/_factory.ts` exporting
`makeDomainHandler({...})`, and refactor the 9 pure list/get domains to use it. The 2
deviating domains (frameworks, integrations) use `extraTools` or stay hand-written. Tool
names and count must be byte-identical before and after.

Flowchart: PATHFINDER-2026-06-02/01-flowcharts/complete-vendor-request-path.md
Evidence: PATHFINDER-2026-06-02/02-duplication-report.md section B1
Touches only vanta-mcp. Independent of U1/U2/U3 (but easier after U2 if vanta's tsconfig was
already adjusted).

## Phase 0: Documentation Discovery (findings, verified 2026-06-02)

Handler contract (`vanta-mcp/src/utils/types.ts:21-28`):
```ts
export interface DomainHandler {
  getTools(): Tool[];
  handleCall(toolName: string, args: Record<string, unknown>, extra?: unknown): Promise<CallToolResult>;
}
```
Every domain exports `const <name>Handler: DomainHandler = { getTools, handleCall }`. These
named exports are consumed by the lazy dynamic-import switch in `domains/index.ts:5-28`
(cached in a Map) and aggregated in `server.ts:21-92`. The factory MUST keep these named
exports alive (each domain file still exports `xHandler`), or all 11 cases in index.ts must
be rewritten - prefer keeping the named exports.

Shared builders in `domains/_helpers.ts` (reuse, do not redefine):
- `listTool(name, description, extraProps?)` :18-27 - injects shared pagination props
  (`pageSize`, `pageCursor`) plus `extraProps`.
- `getTool(name, description, idName='id', idDesc='Resource ID')` :29-41.
- `jsonResult(data)` :4-6 -> `{ content:[{type:'text', text: JSON.stringify(data,null,2)}] }`.
- `errorResult(msg)` :8-10.

Tool name format: `vanta_<resource>_list` / `vanta_<resource>_get`. `handleCall` is a
`switch (toolName)` that optionally logs, calls `client.<PROP>.list(args)` /
`client.<PROP>.get(args.id as string)`, wraps in `jsonResult`, else `errorResult('Unknown tool')`.

**clientProp does NOT always equal the tool-name token** - the factory needs both as inputs:

| tool token (`resource`) | client property | coincide? |
|---|---|---|
| controls, documents, frameworks, integrations, people, policies, tests, vendors, vulnerabilities | same | yes (9) |
| monitored_computers | monitoredComputers | NO |
| risk_scenarios | riskScenarios | NO |

Client methods confirmed (`mcp_node/node-vanta/src/client.ts:22-32` + resources): every
standard `list(params = {})` takes one params object; every standard `get(id: string)` takes
one id. `VantaClient` type imported at `vanta-mcp/src/utils/client.ts:1`.

### The 9 PURE domains (safe to generate via factory)

Each is list+get differing only in description text, get id-label, and list `extraProps`:

| Domain (file:export line) | list extraProps to pass as factory config |
|---|---|
| controls.ts:34 | frameworkMatchesAny (string[]) |
| documents.ts:31 | frameworkMatchesAny, statusMatchesAny (string[]) |
| monitored_computers.ts:33 | complianceStatusFilterMatchesAny (string[]) ; clientProp=monitoredComputers |
| people.ts:30 | emailAndNameFilter (string), groupIdsMatchesAny (string[]) |
| policies.ts:27 | none |
| risk_scenarios.ts:27 | none ; clientProp=riskScenarios |
| tests.ts:31 | statusFilter (string), frameworkFilter (string) |
| vendors.ts:27 | none |
| vulnerabilities.ts:30 | q (string), isFixAvailable (boolean) |

Cleanest factory-shape templates (pure, zero extras): vendors.ts:1-27, policies.ts:1-27,
risk_scenarios.ts:1-27. extraProps templates: tests.ts:9-12, people.ts:9-12.

### The 2 DEVIATIONS (do NOT force-fit)

- frameworks.ts:7-48 - standard list+get PLUS `vanta_frameworks_list_controls`
  (def :11-23, handler :40-44; required `id` + pagination; calls
  `client.frameworks.listControls(id, rest)`). Pass the third tool via `extraTools`.
- integrations.ts:7-79 - non-standard `get` keyed on `connectionId` (not `id`) plus FOUR
  custom tools (`list_resource_kinds`, `list_resources`, `get_resource`, custom `get`).
  Deviates so heavily it is the weakest factory candidate; RECOMMENDED: leave integrations
  hand-written, or model nearly everything via `extraTools`.

### Factory signature (derived from facts)

```ts
makeDomainHandler({
  resource,        // tool-name token, e.g. 'controls' (also used in vanta_<resource>_list/get)
  clientProp,      // defaults to `resource`; override for monitoredComputers / riskScenarios
  listDescription,
  listExtraProps,  // object passed straight into listTool(...) ; optional
  getDescription,
  getIdDesc,       // optional, defaults to 'Resource ID'
  extraTools,      // optional: Array<{ tool: Tool, handle: (client, args) => Promise<CallToolResult> }>
}): DomainHandler
```
`extraTools` entries need both a Tool def and a handler fn, because frameworks/integrations
call non-list/get client methods with positional args.

### Baseline (count is computed, must be confirmed live)

Total tools currently exposed: 28 = 2 navigation (`vanta_navigate`, `vanta_status`,
navigation.ts:34-56) + 26 domain (9 pure x2 = 18, frameworks 3, integrations 5).
The harness `node test-mcp-tools.mjs vanta` prints `(N tools)` but NOT names. Capture a
name-level baseline by dumping `tools/list` from the packed bundle over stdio and recording
every `tools[].name` BEFORE the refactor.

## Implementation

### Step 1: Capture the name baseline

Build + pack vanta, then dump `tools/list` from `vanta-mcp/vanta-mcp.mcpb` over stdio and
save the sorted name set to `plans/.vanta-baseline-tools.txt` (gitignored scratch). Also note
the `(N tools)` line from `node test-mcp-tools.mjs vanta`.

### Step 2: Write the factory

Create `vanta-mcp/src/domains/_factory.ts` exporting `makeDomainHandler`. It imports
`listTool`, `getTool`, `jsonResult`, `errorResult` from `./_helpers.js` and the client type.
`getTools()` returns `[listTool(`vanta_${resource}_list`, listDescription, listExtraProps),
getTool(`vanta_${resource}_get`, getDescription, 'id', getIdDesc), ...extraTools.map(e=>e.tool)]`.
`handleCall(toolName, args)` switches: `_list` -> `client[clientProp].list(args)`; `_get` ->
`client[clientProp].get(args.id as string)`; else match an extraTool by name -> its handler;
else `errorResult('Unknown tool: '+toolName)`. Preserve the optional `logger.info` call shape
if the existing handlers log, so logs do not change. One function returning an object - no
class, no base hierarchy.

### Step 3: Convert the 9 pure domains

Rewrite each pure domain file so it builds `xHandler` via `makeDomainHandler({...})` with the
config from the Phase 0 table. KEEP the `export const xHandler` name. Set `clientProp` for
monitored_computers and risk_scenarios. Preserve every description string verbatim so tool
metadata is byte-identical.

### Step 4: Handle the 2 deviations

frameworks: use the factory for list+get and pass `vanta_frameworks_list_controls` via
`extraTools` (handler calls `client.frameworks.listControls`). integrations: leave
hand-written (RECOMMENDED) or pass all non-standard tools via `extraTools`; do not force its
connectionId-keyed `get` into the factory's id-keyed `get`.

## Verification checklist

```bash
cd mcp_servers/vanta-mcp && npm run build && npm run pack:mcpb
cd /Users/jerry/Downloads/ai-tech-toolkit && node test-mcp-tools.mjs vanta
# Dump tools/list again, diff sorted names against plans/.vanta-baseline-tools.txt
```
Pass conditions:
1. `(N tools)` equals the baseline (expected 28 - confirm against the live baseline, not
   this document).
2. The sorted tool-name set is IDENTICAL before and after (zero diff).
3. Each tool's description is unchanged (annotate runs the same; confirm `annotate(allTools,
   'Vanta')` at server.ts:27 still receives the same names).
4. A spot probe of `vanta_controls_list` and `vanta_frameworks_list_controls` returns the
   same response shape as before.

Note: vanta manifest version is 0.1.0 (manifest.json:4). This refactor must NOT change any
tool name/description/count, so NO manifest bump and NO README count change are needed. If
the diff in Step 2 is non-empty, that is a regression - fix it, do not bump the version.

## Anti-pattern guards

- Domains with bespoke tools use `extraTools` and keep that logic inline. Do NOT force-fit
  frameworks or integrations into the standard list/get.
- The factory is opt-in. A domain that does not fit stays hand-written.
- One function returning a handler object. No abstract base class, no inheritance hierarchy,
  no registry.
- Keep the `export const xHandler` named exports so `domains/index.ts` needs no rewrite.
