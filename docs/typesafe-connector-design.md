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

## OpenRouter response normalization is inferred, not verified

OpenRouter's own SDK wraps the Decisions call as `openrouter.alpha.decisions.create({ decisionsRequest: { model, state, questions } })` and exposes the parsed result as `decision.answers`. The docs state OpenRouter "normalizes requests and responses across providers for this endpoint," but the **raw HTTP JSON response envelope** — flat `{model,answers,usage}` like the direct API, or nested one level under a `decision` key — is not spelled out verbatim anywhere in the fetched documentation.

`systemOneOpenRouter` (`mcp_node/node-typesafe/src/client.ts`) therefore normalizes defensively: it accepts `body.answers` directly, or `body.decision.answers` if nested, whichever is present, and extracts `usage`/`model` the same way. This is called out as best-effort at the call site with a code comment, and again here: **re-verify this against a live OpenRouter call** (or once `console.typesafe.ai` access is restored, cross-check the two providers' raw responses) and tighten the normalization to whichever shape actually comes back.

## What was not verified in this build

No `TYPESAFE_API_KEY` or `OPENROUTER_API_KEY` was available while building this connector. Everything below is grounded in code and tests that ran; everything above the line is UNVERIFIED against a live account:

- Provider auto-resolution, model defaulting, request body shape, and error-code mapping: covered by `mcp_node/node-typesafe/tests/client.test.ts` (mocked `fetch`, 31 tests).
- Tool list shape, read-only annotations, `MISSING_CREDENTIALS` envelopes (naming the right env var(s) in every unresolved state), and no-key-leak in `typesafe_status`: covered by `mcp_servers/typesafe-mcp/tests/boot-probe.mjs` across 8 credential states, including the CFG_ translation path the atlas plugin actually uses. No case in that probe ever contacts a real vendor endpoint — "credentialed" cases point their base URL at an unroutable local port so the network hop fails fast and locally.
- The actual JSON shape TypeSafe or OpenRouter return for a real `typesafe_decide` call, and whether the OpenRouter nested-vs-flat normalization above is correct: **UNVERIFIED - needs live-credential retest.**

## Why no navigate/domain-gating step

Every other multi-tool connector in this repo (panos, blumira, vanta, ...) groups tools behind a `*_navigate` discovery tool because they expose dozens of tools across multiple resource domains. `typesafe-mcp` has exactly three tools and one resource concept (ask Jev a question), so all three are listed up front in every credential state — the indirection a navigate tool would add has no discovery problem to solve.
