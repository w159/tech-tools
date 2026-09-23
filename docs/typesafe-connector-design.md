# TypeSafe (Jev) connector design

## What Jev is

TypeSafe AI's Jev System One model is a **judgment primitive**, not a chat or coding-agent LLM. It answers typed questions — `noul` (yes/no probability), `choice` (pick one of up to 255 named options), or `score` (2-10 ordered levels) — against a caller-supplied `state`, and returns typed answers with probabilities and a confidence score. It never returns free text. The intended use is routing, scoring, and verification decisions inside a larger agentic system, not conversation.

This is why `typesafe_decide` is the only substantive tool: there is no "chat with Jev" tool, and the input schema forces the caller into the noul/choice/score shape rather than accepting an open-ended prompt.

## Dual-provider design

Jev is reachable through two independent HTTP APIs:

| Provider | Endpoint | Auth |
|----------|----------|------|
| **Direct** | `POST https://api.typesafe.ai/v1/systemone` | `Authorization: Bearer <TYPESAFE_API_KEY>` |
| **OpenRouter** | `POST https://openrouter.ai/api/alpha/decisions` | `Authorization: Bearer <OPENROUTER_API_KEY>` |

Both are documented, first-class ways to reach the same underlying model (`~typesafe/jev-latest` / `typesafe/jev-1.13` on OpenRouter). This connector was built specifically to make **OpenRouter a fully supported standalone path**, not an afterthought fallback — the motivating scenario was `console.typesafe.ai` being temporarily inaccessible while an OpenRouter API key was available and needed to work on its own.

### Auto-resolution contract (`TypeSafeClient.resolveProvider`, `mcp_node/node-typesafe/src/client.ts`)

1. `TYPESAFE_PROVIDER` explicitly `typesafe` or `openrouter` wins. If that provider's key is missing, the call fails with `MISSING_CREDENTIALS` naming exactly that env var.
2. Else `TYPESAFE_API_KEY` present → `typesafe`.
3. Else `OPENROUTER_API_KEY` present → `openrouter`.
4. Else `MISSING_CREDENTIALS`, naming **both** options by name.

`typesafe_status` never throws on this: it catches the resolution failure and reports "none configured" instead, since it is the one tool meant to run with zero credentials.

### Model defaulting

`typesafe` defaults to `jev-latest`, used verbatim if overridden. `openrouter` defaults to `~typesafe/jev-latest`; a `TYPESAFE_MODEL` override with no `/` (e.g. a bare `jev-latest` copy-pasted from the direct-API docs) is auto-prefixed with `~typesafe/` as a convenience, since the pinned OpenRouter slug (`typesafe/jev-1.13`) and the always-latest alias (`~typesafe/jev-latest`) differ only by that leading `~`.

### Jev's OpenRouter capabilities, and why the connector sends max_tokens

Jev's live OpenRouter endpoint metadata (`GET /api/v1/models/typesafe/jev-1.13/endpoints`, read 2026-09-23):

| Property | Value |
|---|---|
| `context_length` | 32000 |
| `max_completion_tokens` | 28800 |
| `supported_parameters` | `[]` (no sampling parameters) |
| `pricing.completion` | `"0"` (output tokens are free; input is billed) |

`max_tokens` is not a documented `DecisionsRequest` property in OpenRouter's OpenAPI schema, but OpenRouter's credit precheck treats an omitted `max_tokens` as a request for the model's full output budget, and for the `~typesafe/jev-latest` alias - which publishes no endpoint metadata (`endpoints: []`) - that reservation is 65536 tokens. A key with a monthly limit below that reservation is rejected with HTTP 402 ("This request requires more credits, or fewer max_tokens. You requested up to 65536 tokens, but can only afford ...") **before any tokens are generated**, even though a real Jev answer is tens of tokens and output is billed at $0.

The connector therefore always sends an explicit `max_tokens` on the OpenRouter path: default 4096 (two orders of magnitude above the largest observed answer payload), clamped to `[1, 28800]`, overridable per call (`typesafe_decide`'s `max_tokens` argument) or per deployment (`OPENROUTER_MAX_TOKENS` / `typesafe_openrouter_max_tokens`). The direct typesafe path never sends `max_tokens` - that API has no such parameter.

HTTP 402 from OpenRouter maps to the dedicated `INSUFFICIENT_CREDITS` error code (not generic `INVALID_ARGS`), and the `typesafe_decide` error hint explains the precheck so an agent does not misread it as "the call was too big".

## OpenRouter response normalization: verified flat

OpenRouter's published `DecisionsResponse` OpenAPI schema and the live response examples in their tutorial are flat: `{id, model, provider, answers, usage:{cost, input_tokens, output_tokens}}`. `systemOneOpenRouter` (`mcp_node/node-typesafe/src/client.ts`) reads that flat shape first and passes `usage.cost` through; a nested `decision.answers` fallback remains as defensive cover for the OpenRouter SDK wrapper shape, to be removed once a live call confirms it never appears.

## What was not verified in this build

No `TYPESAFE_API_KEY` or `OPENROUTER_API_KEY` was available while building this connector. Everything below is grounded in code and tests that ran; everything above the line is UNVERIFIED against a live account:

- Provider auto-resolution, model defaulting, request body shape (including the OpenRouter `max_tokens` budget), and error-code mapping: covered by `mcp_node/node-typesafe/tests/client.test.ts` (mocked `fetch`, 39 tests).
- Tool list shape, read-only annotations, `MISSING_CREDENTIALS` envelopes (naming the right env var(s) in every unresolved state), and no-key-leak in `typesafe_status`: covered by `mcp_servers/typesafe-mcp/tests/boot-probe.mjs` across 8 credential states, including the CFG_ translation path the atlas plugin actually uses. No case in that probe ever contacts a real vendor endpoint — "credentialed" cases point their base URL at an unroutable local port so the network hop fails fast and locally.
- The actual JSON shape TypeSafe or OpenRouter return for a real `typesafe_decide` call: the flat Decisions envelope is verified against OpenRouter's published OpenAPI schema and live documented examples; **an end-to-end live call (which would also confirm the 402 fix holds for a credit-limited key) is still UNVERIFIED - needs live-credential retest.**

## Why no navigate/domain-gating step

Every other multi-tool connector in this repo (panos, blumira, vanta, ...) groups tools behind a `*_navigate` discovery tool because they expose dozens of tools across multiple resource domains. `typesafe-mcp` has exactly three tools and one resource concept (ask Jev a question), so all three are listed up front in every credential state — the indirection a navigate tool would add has no discovery problem to solve.
