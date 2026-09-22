Part of [tech-tools](https://github.com/w159/tech-tools) — see repo for the matching MCP server (`mcp_servers/typesafe-mcp`) and the design contract (`docs/typesafe-connector-design.md`).

# node-typesafe

Typed Node.js/TypeScript client for TypeSafe AI's Jev System One model — a judgment-primitive model that answers typed Choice/Score/Noul questions against a `state` and returns typed answers with probabilities, never free text. It is not a chat/coding-agent LLM.

> **Vendored within the [tech-tools](https://github.com/w159/tech-tools) monorepo.**
> Consumed by `typesafe-mcp` via `"node-typesafe": "file:../../mcp_node/node-typesafe"`.
> It is not published to npm — do not `npm install node-typesafe`.

## Two providers, one client

Jev is reachable two ways, and this client resolves between them automatically:

1. **Direct** (`console.typesafe.ai`) — `POST https://api.typesafe.ai/v1/systemone`, `Authorization: Bearer <TYPESAFE_API_KEY>`.
2. **OpenRouter** (`openrouter.ai`) — `POST https://openrouter.ai/api/alpha/decisions`, `Authorization: Bearer <OPENROUTER_API_KEY>`, model slug `~typesafe/jev-latest` or `typesafe/jev-1.13`.

OpenRouter is a **first-class, fully supported standalone path**, not a fallback: if `console.typesafe.ai` is unreachable and only an OpenRouter key is available, every method still works.

### Provider auto-resolution

1. An explicit `provider: "typesafe" | "openrouter"` wins; its required key must be present or `resolveProvider()` throws `MISSING_CREDENTIALS` naming exactly that env var.
2. Else `typesafeApiKey` present → `"typesafe"`.
3. Else `openrouterApiKey` present → `"openrouter"`.
4. Else throws `MISSING_CREDENTIALS` naming **both** options.

### Model defaulting

- `"typesafe"` defaults to `jev-latest`; a configured `model` override is used verbatim.
- `"openrouter"` defaults to `~typesafe/jev-latest`; a configured override with no `/` (e.g. a bare `jev-latest` pasted in from the direct-API docs) is auto-prefixed with `~typesafe/` as a convenience.

## Installation

This library is vendored — no separate installation needed. It is consumed by `typesafe-mcp` as a local file dependency within the monorepo.

## Quick Start

```typescript
import { TypeSafeClient } from 'node-typesafe';

const client = new TypeSafeClient({
  typesafeApiKey: process.env.TYPESAFE_API_KEY,       // or leave undefined and set openrouterApiKey instead
  openrouterApiKey: process.env.OPENROUTER_API_KEY,
});

const result = await client.systemOne({
  state: { ticket: 'Customer says the invoice total is wrong.' },
  questions: {
    urgency: { type: 'score', instructions: 'How urgent is this ticket?', criteria: ['low', 'medium', 'high'] },
    needsHuman: { type: 'noul', instructions: 'Does this need a human to review it?' },
    category: {
      type: 'choice',
      instructions: 'Which team owns this?',
      criteria: { billing: 'Invoice/payment issues', support: 'General support', engineering: null },
    },
  },
});

console.log(result.provider, result.model, result.answers);
```

## Configuration

```typescript
const client = new TypeSafeClient({
  typesafeApiKey: 'ts-...',                    // direct provider key, from console.typesafe.ai
  typesafeBaseUrl: 'https://api.typesafe.ai/v1', // optional, only for staging/sovereign shards
  openrouterApiKey: 'sk-or-...',               // OpenRouter key, used only for the Jev decisions path
  openrouterBaseUrl: 'https://openrouter.ai/api', // optional
  openrouterHttpReferer: 'https://example.com', // optional attribution header
  openrouterXTitle: 'my-app',                  // optional attribution header
  provider: 'auto',                            // 'typesafe' | 'openrouter' | 'auto' (default)
  model: undefined,                            // optional model override, interpreted per-provider
  timeoutMs: 60_000,                           // optional, defaults to 60_000
});
```

## API Reference

```typescript
client.resolveProvider(override?);  // -> { provider, reason } or throws TypeSafeApiError(MISSING_CREDENTIALS)
client.resolveBaseUrl(provider);    // -> string, never throws
client.resolveModel(provider, override?); // -> string, never throws

await client.systemOne({ state, questions, model?, provider? });
// -> { provider, model, answers, usage? }

await client.listModels({ provider? });
// -> { provider, models, source: 'live' | 'static' }
```

### Question shapes

```typescript
{ type: 'noul', instructions, criteria?: { true?: string; false?: string } }
{ type: 'choice', instructions, criteria: Record<string, string | null> } // max 255 options
{ type: 'score', instructions, criteria: string[] } // 2-10 level descriptions, lowest to highest
```

`instructions` may be a string, object, or array. Context budget: 64k tokens total / 32k for `state` plus the longest single question — not enforced client-side.

## Error Handling

Every failure surfaces as `TypeSafeApiError`:

```typescript
import { TypeSafeApiError } from 'node-typesafe';

try {
  await client.systemOne({ state, questions });
} catch (error) {
  if (error instanceof TypeSafeApiError) {
    console.log(error.code);       // MISSING_CREDENTIALS | INVALID_ARGS | NOT_FOUND | FORBIDDEN | RATE_LIMITED | VENDOR_ERROR | NETWORK_ERROR
    console.log(error.status);     // transport HTTP status, or 0 for credential/network failures
    console.log(error.body);       // raw response body excerpt, if any
    console.log(error.retryAfter); // Retry-After header value on a 429, if present
  }
}
```

`error.code` values are already in the same UPPER_SNAKE_CASE vocabulary as `mcp_servers/_shared/error-envelope.ts`'s `ErrorCode`, so `typesafe-mcp` passes them straight through.

## OpenRouter response normalization is best-effort

The OpenRouter Decisions API's raw HTTP JSON envelope is not verbatim-documented — only the SDK's parsed-result shape is. `systemOneOpenRouter` therefore accepts either a flat `{model,answers,usage}` body or one nested under a `decision` key, whichever is present. This is called out at the call site in `src/client.ts` and should be re-verified against a live OpenRouter call.

## TypeScript Support

All types are exported: `TypeSafeClientConfig`, `Provider`, `ProviderSetting`, `Question`, `Questions`, `Answer`, `Answers`, `SystemOneRequest`, `SystemOneResult`, `ModelInfo`, `ListModelsResult`, `ProviderResolution`, `TypeSafeErrorCode`.

## Tests

Vitest tests in `tests/client.test.ts` covering provider auto-resolution (all four branches), model defaulting (including the bare-slug auto-prefix case), request body shape sent to each provider's endpoint, response normalization (flat and `decision`-nested), and error mapping (401/403/404/429/5xx/network).

```bash
npm test
```

## License

Apache-2.0

## Author

w159
