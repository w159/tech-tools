# Connector tool disclosure

## Current behavior (do not break)

| Pattern | Connectors | Cold start tools |
|---|---|---|
| Credential-gated full register | connectwise | 2 (`status`, `test_connection`) until env complete → then full surface |
| Domain navigate router | blumira (and similar) | `navigate` + `status`; domain tools after navigate |
| Always-on full list + status | auvik, cipp, ninjaone, vanta, knowbe4, paylocity, spanning, threatlocker | full `tools/list` even when unconfigured; tools fail with MISSING_CREDENTIALS |

## Why not flip everyone to CW-style in 5.16.0

Bundled `mcp/<name>/server.mjs` files are vendored ESM builds. Changing disclosure requires source edits under `mcp_servers/*` **and** a rebuild/copy into `plugins/atlas/mcp/`. Several packages lack local `node_modules` in this workspace, so a mass rebuild was deferred rather than shipping half-rebuilt connectors.

## Recommended next implementation (dashboard-friendly)

1. Shared helper: `listTools` returns only `*_status` (+ optional `*_navigate`) when `getConfig()` is null.
2. Keep call handlers registered or return the same MISSING_CREDENTIALS envelope if a stale client calls a hidden tool.
3. Rebuild + copy bundles; extend `test_connectors_wiring.py` with an optional live stdio smoke that asserts unconfigured tool_count ≤ N for gated servers.
4. Dashboard `configured_hint` already exposes env coverage so the UI can show "configure to unlock tools" without needing list-tools gating first.

## Operational note for agents

Prefer `*_status` before domain calls. Treat MISSING_CREDENTIALS as configure-and-restart, not as endpoint sweep (enforced by `connector_credential_watch`).
