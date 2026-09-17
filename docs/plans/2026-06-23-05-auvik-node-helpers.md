# Plan U5: Extract repeated pagination and JSON:API mapping in node-auvik

Goal: remove the repeated page-param block and JSON:API attribute mapping from the
node-auvik resource layer by routing them through shared helpers, with byte-equivalent
output. Two small pure functions, no class, no config options.

Flowchart: PATHFINDER-2026-06-02/01-flowcharts/complete-vendor-request-path.md
Evidence: PATHFINDER-2026-06-02/02-duplication-report.md section B3
Touches only mcp_node/node-auvik (and a rebuild of auvik-mcp). Independent of U1-U4.

## Phase 0: Documentation Discovery (findings, verified 2026-06-02)

**CRITICAL CORRECTION - the two "new" files already exist.** The handoff prompt says create
`src/pagination.ts` and `src/jsonapi.ts`. But:
- `mcp_node/node-auvik/src/pagination.ts` ALREADY EXISTS and holds the `paginate()` cursor
  iterator (the `*All` generators use it). Creating a new `pagination.ts` collides. The
  param-builder needs a DIFFERENT filename.
- `mcp_node/node-auvik/src/json-api-mapper.ts` ALREADY EXISTS and exports
  `mapJsonApiResource` / `mapJsonApiResourceArray` (`:3-13`), producing `{ id, ...attributes }`
  (NO `type`). `tenants.ts` and `inventory-configuration.ts` already import and use it.
  Creating a new `jsonapi.ts` duplicates it - a CLAUDE.md anti-pattern. Reuse the existing
  helper; do not make a second one.

### Pagination param block

The 6-line block is byte-identical in 13 list methods across 7 of 8 files. Canonical (lift
from `tenants.ts:11-16` or `inventory-configuration.ts:11-16`, cleanest):
```ts
const { pageSize, pageAfter, filters = {} } = options;
const params = {
  ...filters,
  ...(pageSize && { 'page[first]': pageSize }),
  ...(pageAfter && { 'page[after]': pageAfter }),
};
```
Identical sites: inventory-device.ts 11-16,47-52,76-81 (plus 112-117,149-153 which add
`deviceId` downstream but the params block is identical); tenants.ts 11-16,39-43;
inventory-configuration.ts 11-16; inventory-network.ts 10-15,45-50; inventory-interface.ts
10-15; inventory-entity.ts 10-15,45-50; inventory-component.ts 10-15.

**Key insertion order is load-bearing**: `...filters` first, then `page[first]`, then
`page[after]`. `tests/resources/tenants.test.ts:86` asserts the exact encoded URL
`...?tenantType=client&page%5Bfirst%5D=10&page%5Bafter%5D=cursor123`. The helper MUST emit
keys in this order or that test breaks.

`PaginationOptions` (`src/types/json-api.ts:46-49`): `{ pageSize?, pageAfter?, filters? }`.

**DIVERGENCE - statistics.ts does NOT match** (`statistics.ts:18-26` and 4 more). It
destructures `fromTime, thruTime, tenantId, ...rest` and places them BEFORE `...filters`,
with `page[*]` still last. A `buildPageParams({pageSize, pageAfter, filters})` covers the 13
simple sites but must be COMPOSED into statistics (`{ ...statBase, ...buildPageParams(...) }`),
not substituted. The statistics `*All` generators build params WITHOUT `page[*]` and hand the
whole object to `paginate()` - a third shape; leave those untouched.

### JSON:API attribute mapping (output shape is ALREADY inconsistent)

- Shape A - LIST methods in 6 files emit `{ id, type, ...attributes }`. Sites:
  inventory-device.ts 20-23,56-59,85-88; inventory-network.ts 19-22,54-57;
  inventory-interface.ts 19-22; inventory-entity.ts 19-22,54-57; inventory-component.ts
  19-22; statistics.ts 30-33,71-74,115-118,153-156,197-200.
- Shape B - GET methods emit `{ id, ...attributes }` (NO `type`). Sites: inventory-device.ts
  42,107; inventory-network.ts 41,76; inventory-interface.ts 41; inventory-entity.ts 41,76;
  tenants.ts 68.
- Shape C - existing helper `mapJsonApiResource` / `mapJsonApiResourceArray` emits
  `{ id, ...attributes }` (NO `type`) - matches Shape B, NOT Shape A. tenants.ts:22 and
  inventory-configuration.ts:22 already route their LIST output through it, so their list
  output already has no `type`, while the 6 inline files' list output has `type`.

**Byte-equivalence landmine:** one `mapResourceArray` cannot reproduce both A and B. Decide
the canonical list shape FIRST. `tests/pagination.test.ts:62-68,95,118` and the existing
helper both assume NO `type`. Options:
  (a) Canonical = no `type` (align with existing helper + tests): route the 6 inline list
      methods through `mapJsonApiResourceArray`. This REMOVES `type` from their output - a
      real output change for those 6. Verify no consumer relies on `type`.
  (b) Canonical = keep each file's current shape: extract only the page-param block now
      (the unambiguous win) and leave attribute mapping per-file, OR add an optional flag to
      include `type` - but a flag violates the "no config options" guard.
RECOMMENDED: do the pagination extraction (clean, byte-safe) unconditionally; for mapping,
treat it as a separate decision and, if pursued, pick option (a) only after confirming via
grep that no caller reads `.type` off a mapped list item.

**Special cases (do NOT route through a bare helper):** inventory-device.ts warranty/lifecycle
inject `deviceId` with specific key order - list :124 `{ deviceId, id, ...attrs }`, :160 same;
get :143,:179 `{ deviceId: id, id, ...attrs }`; `*All` generators :134,:170 `{ ...warranty,
deviceId }` (attrs first). These need a wrapper/post-spread, not `mapResource(data)`.

### Return types and build

Every list returns `Promise<Page<T>>` (`Page<T> = { data: T[]; links; meta }`,
types/json-api.ts:39-43); every get returns `Promise<T>`. The helper must preserve these
exactly (byte-equivalence requirement). node-auvik builds with tsup single-entry
(`src/index.ts`), `dts:true`, esm+cjs. The resources/pagination/json-api-mapper are internal
(not re-exported from index.ts) and bundled transitively via `client.ts`, so a new internal
file needs NO index.ts export change. auvik-mcp consumes node-auvik via `file:` dep
(`auvik-mcp/package.json:20`) and imports only the built `dist/` barrel - no deep imports.

node-auvik has its own Vitest suite: `cd mcp_node/node-auvik && npm test` (`package.json:24`,
`vitest run`, coverage threshold 80/80/80/80). Byte-sensitive tests:
`tests/resources/tenants.test.ts:86` (param order) and `tests/pagination.test.ts:62-68`
(mapped shape, no `type`).

## Implementation

### Step 1: Extract buildPageParams (the unambiguous, byte-safe win)

Add `buildPageParams` to a NEW file that does not collide - e.g.
`mcp_node/node-auvik/src/page-params.ts` (NOT `pagination.ts`, which is taken):
```ts
import type { PaginationOptions } from './types/json-api.js';
export function buildPageParams(
  { pageSize, pageAfter, filters = {} }: PaginationOptions,
): Record<string, unknown> {
  return {
    ...filters,
    ...(pageSize && { 'page[first]': pageSize }),
    ...(pageAfter && { 'page[after]': pageAfter }),
  };
}
```
Replace the 13 identical inline blocks with `const params = buildPageParams(options);`.
For statistics.ts, COMPOSE: `const params = { fromTime, thruTime, ...(tenantId && {tenantId}),
...rest, ...buildPageParams({ pageSize, pageAfter, filters }) };` - preserving the original
key order (stat fields, then filters via the helper, then page[*]). Do NOT touch the
statistics `*All` generators. Leave inventory-device warranty/lifecycle param blocks alone if
their shape differs from the simple block (re-read each before substituting).

### Step 2: (Optional, gated on a decision) Consolidate attribute mapping

Only if pursuing mapping consolidation: confirm via
`grep -rn "\.type" mcp_node/node-auvik/src mcp_servers/auvik-mcp/src` that no caller reads
`.type` off a mapped list item. If clean, route the 6 Shape-A inline list maps through the
EXISTING `mapJsonApiResourceArray` (accepting the `type` removal as the canonical shape), and
route Shape-B get maps through `mapJsonApiResource`. Wrap warranty/lifecycle with a small
post-map spread to re-inject `deviceId` in the exact existing key order. Do NOT create a
second mapper file.

## Verification checklist

```bash
cd mcp_node/node-auvik && npm test          # Vitest; tenants + pagination tests must pass
npm run build
cd ../../mcp_servers/auvik-mcp && npm run build && npm run pack:mcpb
cd /Users/jerry/Downloads/ai-tech-toolkit && node test-mcp-tools.mjs auvik
```
Pass conditions:
1. node-auvik Vitest suite passes, including `tenants.test.ts:86` (param order/encoding
   unchanged) and `pagination.test.ts` (mapped shape unchanged).
2. `node test-mcp-tools.mjs auvik` PASSes; tool count unchanged.
3. Device/tenant list responses are byte-equivalent to pre-refactor. If Step 2 was done with
   option (a), the only intended change is `type` removal from the 6 previously-inline list
   methods - confirm that was the deliberate decision, not an accident.

## Anti-pattern guards

- Pure mechanical extraction. Do NOT change output shape or add config options (no
  `includeType` flag).
- Two small pure functions, no class.
- Do NOT create `pagination.ts` or `jsonapi.ts` - both names/abstractions already exist.
  Reuse `json-api-mapper.ts`; name the new param helper something non-colliding
  (`page-params.ts`).
- Do NOT "fix" the pre-existing list-shape inconsistency silently - it is a deliberate
  decision point (Step 2), not a cleanup to slip in.
