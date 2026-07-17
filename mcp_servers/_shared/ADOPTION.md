# Adopting the _shared response-quality modules

Three modules in `mcp_servers/_shared/` are available to every server:

| File | What it provides |
|---|---|
| `response-shaper.ts` | Compact summaries, field selection, hard char cap for list/get tools |
| `error-envelope.ts` | Consistent `isError:true` result with machine-readable code + hint |
| `base-url.ts` | Vendor default URL resolution with optional env var override |

---

## Step 1 — Widen tsconfig to allow cross-directory imports

Every server's `tsconfig.json` has `rootDir: "./src"` and `include: ["src/**/*"]`.
Importing `../../_shared/*.ts` raises TS error 6059 ("File is not under rootDir") at
compile time. Fix this before adding any import.

### tsc servers (cipp, knowbe4, ninjaone)

In `tsconfig.json`, add the `_shared` directory to `include` and relax `rootDir` to
the common ancestor of `src/` and `_shared/`:

```json
{
  "compilerOptions": {
    "rootDir": "../..",
    "outDir": "./dist",
    ...
  },
  "include": [
    "src/**/*",
    "../_shared/*.ts"
  ]
}
```

For cipp, whose source lives one directory deeper (`src/mcp/`), the specifier is
`../../../_shared/response-shaper.js` and the include pattern should be
`"../../_shared/*.ts"` (adjust relative to the tsconfig location).

After widening `rootDir`, the compiled output for the server's own files will land in
`dist/src/` instead of `dist/` — update `package.json`'s `"main"` / `"bin"` fields
and the `pack-mcpb.js` entry reference if they point to `dist/index.js`.

Alternatively, keep `rootDir: "./src"` and use **path aliases**:

```json
{
  "compilerOptions": {
    "rootDir": "./src",
    "paths": { "@shared/*": ["../../_shared/*"] }
  },
  "include": ["src/**/*", "../../_shared/*.ts"]
}
```

Then import as `import { shapeList } from "@shared/response-shaper.js"`.
Note: path aliases require a loader at runtime (e.g. `tsconfig-paths`) for plain Node.
With tsup, add `alias: { "@shared": "../../_shared" }` in `tsup.config.ts` — no
runtime loader needed.

### tsup servers (auvik, blumira, kaseya-spanning, paylocity, threatlocker, vanta)

tsup bundles relative imports across directory boundaries without any tsconfig change to
`rootDir` for the JS output. However, if the server uses `dts: true` in `tsup.config.ts`,
the TypeScript declaration pass will still raise TS6059. Fix it the same way: add
`"../../../_shared/*.ts"` (or the correct relative path) to `include` in `tsconfig.json`.

For `kaseya-spanning-backup-mcp` (tsup, no `dts`), no tsconfig change is required — just
add the import.

---

## Step 2 — Choose the right schema flavor for your server

`response-shaper.ts` exports two ways to declare the `fields` / `full` opt-in
params on a tool.  Pick exactly one depending on how your server registers tools.

### Flavor A — `SHAPE_PROPS` (JSON-schema, plain `Tool` type)

Use this when your server builds tool definitions as plain objects conforming to
the MCP SDK's `Tool` type and sets an `inputSchema` property.  This covers every
tsup-based server in the repo: vanta, paylocity, auvik, blumira, kaseya-spanning,
threatlocker.

```typescript
import { SHAPE_PROPS } from "../../_shared/response-shaper.js";

// In getTools() / listTool() / the Tool definition:
inputSchema: {
  type: "object",
  properties: {
    ...SHAPE_PROPS,   // spreads JSON-schema objects — correct here
    status: { type: "string", description: "..." },
  },
}
```

Do NOT spread `SHAPE_PROPS` into a `z.object({...})` call.  The values are plain
objects, not Zod schemas, and TypeScript will raise TS2345.

### Flavor B — `makeShapeZodFields(z)` (Zod `ZodRawShape`)

Use this when your server registers tools via `server.tool(name, zodShape,
handler)` where `zodShape` is built from Zod (e.g. `z.object({...})`).  This
currently applies to connectwise-manage-mcp.

Because `_shared` has no zod dependency, pass your own `z` instance to the
factory.  TypeScript verifies the structural contract at the call site.

```typescript
import { z } from "zod";
import { makeShapeZodFields } from "../../_shared/response-shaper.js";

server.tool(
  "cw_companies_list",
  z.object({
    conditions: z.string().optional().describe("CW conditions query string"),
    ...makeShapeZodFields(z),   // produces Zod schemas — correct here
  }),
  async ({ conditions, fields, full }) => {
    const shapeArgs = { fields, full };
    ...
  }
);
```

The descriptions produced by `makeShapeZodFields` are identical to those in
`SHAPE_PROPS` so agent-facing documentation is consistent across both server
styles.

---

## Step 3 — Import and use response-shaper

### In a list/search tool handler

```typescript
import {
  shapeList,
  extractShapeArgs,
  type SummaryFn,
  SHAPE_PROPS,
} from "../../_shared/response-shaper.js";

// 1. Define a compact summary for this tool (omit audit fields, raw IDs, etc.)
const ticketSummary: SummaryFn = (item) => ({
  id:       item.id,
  subject:  item.subject,
  status:   item.status,
  priority: item.priority,
});

// 2. Add SHAPE_PROPS to the tool's inputSchema so agents can opt in to richer output
{
  name: "ninjaone_tickets_list",
  inputSchema: {
    type: "object",
    properties: {
      ...SHAPE_PROPS,           // adds "fields" and "full" params
      status: { type: "string", description: "..." },
    },
  },
}

// 3. In the handler, replace JSON.stringify with shapeList
case "ninjaone_tickets_list": {
  const response = await client.tickets.list({ ... });
  const shapeArgs = extractShapeArgs(args);
  return shapeList(
    response.tickets ?? [],
    ticketSummary,
    shapeArgs,
    undefined,                // charCap — omit for DEFAULT_CHAR_CAP (40 000 chars)
    `Pass cursor='${response.cursor}' to get the next page.`
  );
}
```

### In a get/detail tool handler

```typescript
import { shapeItem, extractShapeArgs } from "../../_shared/response-shaper.js";

case "ninjaone_tickets_get": {
  const ticket = await client.tickets.get(ticketId);
  return shapeItem(ticket, ticketSummary, extractShapeArgs(args));
}
```

### For opaque results (status checks, creates, updates)

```typescript
import { shapeRaw } from "../../_shared/response-shaper.js";

case "ninjaone_tickets_create": {
  const ticket = await client.tickets.create({ ... });
  return shapeRaw(ticket);   // enforces char cap; no field filtering
}
```

---

## Step 4 — Import and use error-envelope

Replace ad-hoc error strings and pattern-matched catch blocks:

```typescript
import {
  toolError,
  toolErrorFromCatch,
  missingCredsError,
} from "../../_shared/error-envelope.js";

// In a status tool (must never throw, even with missing creds):
if (!process.env.NINJAONE_CLIENT_ID) {
  return missingCredsError("NinjaOne", [
    "NINJAONE_CLIENT_ID",
    "NINJAONE_CLIENT_SECRET",
  ]);
}

// In a domain handler:
case "ninjaone_tickets_get": {
  try {
    const ticket = await client.tickets.get(ticketId);
    return shapeItem(ticket, ticketSummary, extractShapeArgs(args));
  } catch (err) {
    return toolErrorFromCatch("ninjaone_tickets_get", err, {
      hint: "Verify ticket_id with ninjaone_tickets_list first.",
    });
  }
}

// For explicit validation errors before the API call:
if (!args.ticket_id) {
  return toolError("INVALID_ARGS", "ticket_id is required.", {
    hint: "Pass the integer ticket ID returned by ninjaone_tickets_list.",
  });
}
```

---

## Step 5 — Import and use base-url

```typescript
import { resolveBaseUrl, describeBaseUrl } from "../../_shared/base-url.js";

// In client.ts / utils/client.ts:
const BASE_URL = resolveBaseUrl("ninjaone", process.env.NINJAONE_BASE_URL);
// Returns "https://app.ninjarmm.com" when env var is unset.
// Returns the env var value (trimmed, no trailing slash) when set.
// Returns undefined only for self-hosted vendors (cipp, connectwise) — treat
// undefined as a config error: the server must refuse to start or return a
// missingCredsError from the status tool.

// In the <vendor>_status tool:
const urlDescription = describeBaseUrl(
  "ninjaone",
  process.env.NINJAONE_BASE_URL,
  "NINJAONE_BASE_URL"
);
// => "https://app.ninjarmm.com (vendor default; set NINJAONE_BASE_URL to override)"
// or "https://eu.ninjarmm.com (from NINJAONE_BASE_URL env var)"
```

---

## Running the tests

No install required. Node 22's built-in test runner handles TypeScript directly:

```bash
# From the repo root:
node --experimental-strip-types --test \
  "mcp_servers/_shared/__tests__/response-quality.test.ts"

# From the _shared/ directory:
node --experimental-strip-types --test "__tests__/response-quality.test.ts"
```

Expected output: `# tests 46`, `# pass 46`, `# fail 0`.

---

## What is NOT in scope here

- Adopting these modules into individual servers (that is the next wave per the master plan).
- The `annotate-tool.ts` pattern (separate, already shared via file-copy).
- Changes to manifest.json, pack-mcpb.js, or test-mcp-tools.mjs.
- Any new runtime dependencies.
