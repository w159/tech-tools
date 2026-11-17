# Disabling plugins and MCP servers for one project
Date: 2026-11-17
Area: Claude Code project config (not atlas product code)

## What happened
A fresh session in this repo loaded 24 plugins and 66 active MCP servers. `.claude/settings.local.json` (not committed) now disables 13 org-synced plugins and `ui-ux-pro-max` for this project. Measured in a fresh session: plugins 24 to 10, active MCP servers 66 to 26.

## Why it happened
The `disabledMcpServers` key in a settings file does not disable claude.ai connectors. The project entry in `~/.claude.json`, which `/mcp` writes, does.

## What to do next time
1. Disable plugins per project in `.claude/settings.local.json`.
2. Disable claude.ai connectors with `/mcp`, not with a settings key.
3. Open a fresh session and count plugins and active MCP servers to confirm.

## What to avoid
Trusting `disabledMcpServers` in a settings file to remove connectors.
