# Minutes Cowork Extension

This is the minimal Cowork-facing extension bundle for Minutes.

It packages the existing `crates/mcp` server in the extension format that Claude Desktop already uses locally for Cowork-compatible extensions.

## What this proves

- Minutes can be packaged in the same extension shape used by locally installed Claude Desktop extensions.
- The Cowork-facing surface does not need a separate server implementation.
- The existing Minutes MCP server is the right core runtime; Cowork packaging is a distribution and install problem, not a protocol rewrite.

## Build the bundle

From the repo root:

```bash
scripts/build_cowork_extension.sh
```

That produces a ready-to-install local bundle at:

```text
dist/claude-cowork-extension/minutes
```

## Bundle contents

- `manifest.json` — Claude Desktop / Cowork extension manifest
- `package.json` — runtime dependency manifest for the extension bundle
- `server/index.js` — built Minutes MCP server
- `node_modules/` — runtime dependencies for the server

## Local proof-of-life checklist

1. Build the bundle with `scripts/build_cowork_extension.sh`.
2. In Claude Desktop / Cowork, install or upload the local extension bundle.
3. Verify the Minutes tool surface appears:
   - `list_meetings`
   - `search_meetings`
   - `research_topic`
   - `get_person_profile`
   - `consistency_report`
   - `start_recording`
   - `stop_recording`
4. Run a safe read-only prompt first:
   - "List my recent meetings from Minutes."
5. Then verify a higher-order workflow:
   - "What did we decide about pricing across all meetings?"

## Notes

- This bundle assumes the local `minutes` CLI binary remains discoverable on the user's machine, just like the current MCP server does.
- The extension bundle intentionally does not rewrite any Minutes config. QMD search and daily-note backlinks remain opt-in through Minutes configuration.
