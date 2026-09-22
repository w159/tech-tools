# TypeSafe (Jev) MCP Server

A Model Context Protocol (MCP) server for TypeSafe AI's Jev System One model — a judgment-primitive model that answers typed Choice/Score/Noul questions against a `state` and returns typed answers with probabilities, never free text. **Jev is not a chat/coding-agent LLM.** Use it for routing, scoring, and verification decisions.

## Architecture

This server exposes **all three tools up front, in every credential state**. There is no `*_navigate` discovery step and no progressive tool-list disclosure like the larger connectors in this repo — with only three tools total, the extra indirection would add nothing:

| Tool | Requires credentials? |
|------|------------------------|
| `typesafe_status` | No — always runs, reports what is/isn't configured |
| `typesafe_decide` | Yes — returns a `MISSING_CREDENTIALS` tool error naming both options if neither is set |
| `typesafe_list_models` | Yes — same as above |

## Two providers, one connector

Jev is reachable two ways, and `typesafe-mcp` resolves between them automatically via `node-typesafe`:

1. **Direct** (`console.typesafe.ai`) — `TYPESAFE_API_KEY`.
2. **OpenRouter** (`openrouter.ai`) — `OPENROUTER_API_KEY`, model slug `~typesafe/jev-latest` / `typesafe/jev-1.13`.

**OpenRouter is a first-class, fully supported standalone path, not a fallback.** If `console.typesafe.ai` is temporarily inaccessible and only an OpenRouter key is available, every tool still works end to end.

### Provider auto-resolution

1. `TYPESAFE_PROVIDER` set to `typesafe` or `openrouter` wins; its required key must be present or the call fails with `MISSING_CREDENTIALS` naming exactly that env var.
2. Else `TYPESAFE_API_KEY` present → `typesafe`.
3. Else `OPENROUTER_API_KEY` present → `openrouter`.
4. Else `MISSING_CREDENTIALS` naming **both** `TYPESAFE_API_KEY` and `OPENROUTER_API_KEY`.

## Installation

`typesafe-mcp` consumes `node-typesafe` as a local file dependency, so build it from inside the monorepo:

```bash
cd mcp_servers/typesafe-mcp
npm install
npm run build
```

## Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `TYPESAFE_API_KEY` | One of these two | none | Direct-provider key from console.typesafe.ai |
| `TYPESAFE_BASE_URL` | No | `https://api.typesafe.ai/v1` | Only for staging/sovereign shards |
| `OPENROUTER_API_KEY` | One of these two | none | OpenRouter key, used only for the Jev Decisions path |
| `OPENROUTER_BASE_URL` | No | `https://openrouter.ai/api` | |
| `OPENROUTER_HTTP_REFERER` | No | none | Optional attribution header, never required |
| `OPENROUTER_X_TITLE` | No | none | Optional attribution header, never required |
| `TYPESAFE_PROVIDER` | No | `auto` | `typesafe` \| `openrouter` \| `auto` |
| `TYPESAFE_MODEL` | No | per-provider default | See model defaulting below |

At least one of `TYPESAFE_API_KEY` / `OPENROUTER_API_KEY` must be set for `typesafe_decide` / `typesafe_list_models` to work; `typesafe_status` runs without either.

### Model defaulting

- `typesafe` defaults to `jev-latest`; a `TYPESAFE_MODEL` override is used verbatim.
- `openrouter` defaults to `~typesafe/jev-latest`; an override with no `/` (e.g. a bare `jev-latest` pasted in from the direct-API docs) is auto-prefixed with `~typesafe/` as a convenience.

## Usage

### Running Standalone

```bash
export TYPESAFE_API_KEY="your-api-key"      # or export OPENROUTER_API_KEY instead
node dist/index.js
```

### Claude Desktop Configuration

Build a `.mcpb` bundle with `npm run pack:mcpb` and install it, or wire the built entry point up directly:

```json
{
  "mcpServers": {
    "typesafe": {
      "command": "node",
      "args": ["/absolute/path/to/mcp_servers/typesafe-mcp/dist/index.js"],
      "env": {
        "TYPESAFE_API_KEY": "your-api-key"
      }
    }
  }
}
```

## Tools

### `typesafe_status`
Credential/provider diagnostics: which of `TYPESAFE_API_KEY` / `OPENROUTER_API_KEY` are set (booleans only, never key values), resolved provider, resolved base URL, resolved model. Runs with no credentials configured.

### `typesafe_decide`
The core tool. Ask Jev 1-20 typed questions (`noul` / `choice` / `score`) about a `state` (string, JSON object, or JSON array). Returns `{provider, model, answers, usage}` passed through verbatim via `shapeRaw` — this tool's whole point is returning Jev's typed answers as-is, not a summarized subset.

### `typesafe_list_models`
List available models for the resolved provider. `typesafe` does a live `GET /v1/models`; `openrouter` has no documented model-discovery endpoint, so it returns two statically known slugs marked `source: "static"`.

## Safety Signals

All three tools are `readOnlyHint: true` / `destructiveHint: false`: none of them mutate vendor-side state, not even `typesafe_decide` — it only asks Jev a typed question about a state the caller supplies. Checked by `node test-mcp-tools.mjs typesafe` at the repo root.

## Error Handling

Every failure surfaces through the standard `mcp_servers/_shared/error-envelope.ts` JSON envelope, with `code` sourced directly from `node-typesafe`'s `TypeSafeApiError.code`: `MISSING_CREDENTIALS`, `INVALID_ARGS`, `NOT_FOUND`, `FORBIDDEN`, `RATE_LIMITED`, `VENDOR_ERROR`, `NETWORK_ERROR`.

## OpenRouter response normalization is best-effort

`node-typesafe`'s OpenRouter client accepts either a flat `{model,answers,usage}` response body or one nested under a `decision` key — the raw HTTP JSON envelope for `POST /api/alpha/decisions` is not verbatim-documented, only the SDK's parsed-result shape is. See `docs/typesafe-connector-design.md` and `mcp_node/node-typesafe/src/client.ts`.

## Scripts

| Command | What it does |
|---------|--------------|
| `npm run build` | tsup build to `dist/` |
| `npm run pack:mcpb` | build the `.mcpb` bundle for Claude Desktop (`scripts/pack-mcpb.js`) |
| `npm run bundle:atlas` | build the deps-inlined atlas bundle at `plugins/atlas/mcp/typesafe/server.mjs` |
| `npm run test:boot` | boot probe: verifies the tool list, annotations, and MISSING_CREDENTIALS/NETWORK_ERROR behavior across 8 credential states (also `npm test`) |

## Validation status

UNVERIFIED against a live TypeSafe/OpenRouter account — no `TYPESAFE_API_KEY` or `OPENROUTER_API_KEY` was available while building this connector. The boot probe exercises every credential-resolution path with fake keys pointed at an unroutable local port, so no real vendor endpoint has ever been contacted. Re-test against real credentials before relying on `typesafe_decide` / `typesafe_list_models` output shape in production, especially the OpenRouter response-normalization path (see above).

## License

Apache-2.0
