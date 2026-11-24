# Telemetry discovery

Required read before composing the Phase 1 explorer dispatch. The explorer's job is to answer one question with repo evidence: **what telemetry is actually wired here, and what does it emit?** A dependency listed but never imported, or an SDK imported but never called, is not a working source - note it as `wired but no signals observed`, never as a source.

## Dispatch shape

```
ROLE: atlas:explorer - telemetry discovery
GOAL: inventory every product telemetry source wired in this repo, with proof, and extract every named analytics event visible in code.
CONTEXT: <repo root(s); anything Phase 0 config already claimed>
TOOLS: ToolSearch("select:...") batched line from subagent-kit.md (read-only set; add Grep/Glob)
DISCOVER FIRST: confirm the repo layout - monorepos need per-package scans.
NON-INTERACTIVE: <verbatim line from subagent-kit.md>
TOOLS FORBIDDEN: Write, Edit, git push, package installs, network calls
DELIVERABLE: the Source Inventory report below
SUCCESS CRITERIA:
  - every claimed source cites file:line evidence (manifest entry AND an import/callsite or env read)
  - every claimed event name is a literal string found at a callsite
  - zero-source conclusion is stated as such, not omitted
OUT OF SCOPE: querying any external service; reading .env values (names only); changing files
STOP CONDITIONS: repo unreadable, or >15 min without progress - report partial findings
SCHEMA: subagent-report v1 (subagent-kit.md), plus the Source Inventory below
```

## What counts as a source

A source is real when ALL of these hold: (a) the SDK/dependency appears in a manifest, (b) it is imported or initialized in code, and (c) an API key/DSN/token is read from the environment or config at runtime. (a) alone is `candidate, unwired`.

## Discovery checklist

Scan each package root in a monorepo separately. Case-insensitive matching.

1. **Dependency manifests** - `package.json` (+ lockfiles), `pyproject.toml`, `requirements*.txt`, `go.mod`, `Gemfile`, `pom.xml`/`build.gradle(.kts)`, `composer.json`, `pubspec.yaml`, `Cargo.toml`, `*.csproj`.
2. **SDK imports / init callsites**:
   - PostHog: `posthog-js`, `posthog-node`, `posthog-python`, `posthog` (Elixir) - `PostHog(`, `posthog.init`, `PostHogClient`
   - Mixpanel: `mixpanel`, `mixpanel-flutter`, `mixpanel-swift` - `Mixpanel.init`, `Mixpanel(`, `track(`
   - Amplitude: `@amplitude/analytics-node`, `amplitude-js`, `amplitude-python` - `Amplitude(`, `amplitude.init`
   - Segment: `analytics-js`, `@segment/analytics-node`, `analytics-python`, `segment-android` - `Analytics(`, `load({ writeKey`
   - Sentry: `@sentry/node`, `@sentry/react`, `@sentry/browser`, `sentry-python`, `sentry-ruby`, `sentry-go`, `raven-js` - `Sentry.init`, `sentry_sdk.init`, `dsn:`
   - Datadog: `dd-trace`, `datadog-api-client`, `ddtrace` (Python) - `tracer.init`, `DD_API_KEY` reads
   - New Relic: `newrelic`, `newrelic-telemetry-sdk-*` - `newrelic.js`, `agent_enabled`
   - Honeycomb / OpenTelemetry: `@honeycombio/opentelemetry`, `honeycomb-beeline`, `opentelemetry-*`, `OTEL_*` env reads
   - Stripe: `stripe` (all languages) - `Stripe(`, `stripe.api_key`, `webhooks` routes
   - Paddle / Polar / Chargebee / Recurly: their SDKs and webhook handlers
3. **Env var reads** (names only - never read secret VALUES into the report): `POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_KEY`, `POSTHOG_API_KEY`, `MIXPANEL_TOKEN`, `AMPLITUDE_API_KEY`, `SEGMENT_WRITE_KEY`, `SENTRY_DSN`, `SENTRY_AUTH_TOKEN`, `DD_API_KEY`, `DD_CLIENT_TOKEN`, `NEW_RELIC_LICENSE_KEY`, `HONEYCOMB_API_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `PADDLE_*`, plus a generic grep for `process.env.*KEY|TOKEN|DSN|WRITE_KEY` in telemetry-adjacent files.
4. **Event names at callsites** - literal string arguments to `track(`, `capture(`, `logEvent(`, `enqueue(`, `Sentry.captureMessage/Exception`, custom wrappers (find the wrapper first, then its callers). Record: event name, file:line, and a one-line meaning when inferable. Distinguish server-side emissions from client-side.
5. **Existing pulse config** - `.atlas/memory/product-pulse-config.md` may already name sources; verify each still matches repo evidence.

## Source Inventory report (explorer DELIVERABLE)

```markdown
### Source Inventory - <repo> - <date>

| Class | Provider | Evidence (manifest + init + env) | Access path this session | Events seen |
|---|---|---|---|---|
| analytics | posthog | package.json:L + src/telemetry.ts:L12 + POSTHOG_KEY | MCP connector present? yes/no | doc_opened (app/L30), checkout_started (...) |
| tracing | sentry | ... | ... | n/a |
| payments | stripe | ... | ... | n/a |

Wired but no signals observed: <deps listed but never imported/called>
Env vars referenced (names only): ...
Event extraction confidence: <named | partial | none - explain>
```

The orchestrator converts this into Phase-1 routing. `Access path this session` records whether a provider MCP connector is connected in the current session (check the available tools, not memory) - that decides Phase 2's query mechanism per source.