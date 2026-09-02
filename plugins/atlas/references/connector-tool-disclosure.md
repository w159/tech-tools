# Connector tool disclosure

## Current behavior (do not break) — verified 2026-09-02

| Pattern | Connectors | Cold start tools |
|---|---|---|
| Credential-gated full register | connectwise | 2 (`cw_status`, connection test) until env complete → then full surface |
| Domain navigate router | blumira | `navigate` + `blumira_status`; domain tools after navigate |
| Always-on full list + `*_status` | auvik, cipp, ninjaone, vanta, knowbe4, paylocity, spanning, threatlocker | full `tools/list` even when unconfigured; tools fail with MISSING_CREDENTIALS / NOT CONFIGURED |
| Falcon inert-then-full | falcon | **4** tools when unconfigured/auth-failed (`falcon_status`, connectivity, list modules/tools); full module catalog (**144+**) only after successful auth |

## Why not flip every Node connector to CW-style

Bundled `mcp/<name>/server.mjs` files are vendored ESM builds. Changing disclosure
requires source edits under `mcp_servers/*` **and** a rebuild/copy into
`plugins/atlas/mcp/`. Mass rebuilds are deliberate, not casual.

## Falcon behavior (atlas contract)

1. Missing `FALCON_CLIENT_ID` / `FALCON_CLIENT_SECRET` → inert boot (no crash).
2. Present but invalid credentials → inert boot with `falcon_status.state=AUTH_FAILED`.
3. Successful auth → full tool registration including `falcon_status` (`state=OK`).
4. Prefer `falcon_status` before any domain Falcon call. Do not treat
   `falcon_check_rtr_command_status` as a configuration probe.

## Recommended next implementation (Node progressive disclosure)

1. Shared helper: `listTools` returns only `*_status` (+ optional `*_navigate`) when config is null.
2. Keep call handlers registered or return the same MISSING_CREDENTIALS envelope if a stale client calls a hidden tool.
3. Rebuild + copy Node bundles; extend live stdio smoke tests for unconfigured tool_count bounds.
4. Dashboard `configured_hint` already exposes env coverage for "configure to unlock tools".

## Operational note for agents

Prefer `*_status` before domain calls. Treat MISSING_CREDENTIALS as
configure-and-restart, not as endpoint sweep (enforced by
`connector_credential_watch`).
