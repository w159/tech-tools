# Blumira MCP Server

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org/)

A [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server that provides AI assistants with structured access to [Blumira](https://blumira.com) SIEM platform data and operations.

## Quick Start

**Claude Desktop** — download, open, done:

1. Download `blumira-mcp.mcpb` from the [latest release](https://github.com/w159/blumira-mcp/releases/latest)
2. Open the file (double-click or drag into Claude Desktop)
3. Enter your Blumira JWT token when prompted

No terminal, no JSON editing, no Node.js install required.

**Claude Code (CLI):**

```bash
claude mcp add blumira-mcp \
  -e BLUMIRA_JWT_TOKEN=your-jwt-token \
  -- npx -y github:w159/blumira-mcp
```

See [Installation](#installation) for from-source method.

## Features

- **🔌 MCP Protocol Compliance**: Full support for MCP resources and tools
- **🛡️ Comprehensive SIEM Coverage**: Tools spanning findings, agents/devices, users, resolutions, and MSP account management
- **🔍 Decision-Tree Navigation**: Start with `blumira_navigate` to explore domains, then dynamically load domain-specific tools
- **🏢 MSP Multi-Tenant Support**: Full MSP endpoint coverage for managing findings, agents, and users across accounts
- **🔒 Secure Authentication**: OAuth2 client credentials (auto-exchanged for a bearer token) or a pre-issued JWT bearer token
- **🌐 Dual Transport**: Supports both stdio (local) and HTTP Streamable (remote) transports
- **📦 MCPB Packaging**: One-click installation via MCP Bundle for desktop clients
- **⚡ Rate Limiting**: Built-in rate limiter respects Blumira API limits
- **🔎 Rich Filtering**: Support for `.eq`, `.in`, `.gt`, `.lt`, `.contains`, `.regex`, and negation operators

## Installation

### Option 1: MCPB Bundle (Claude Desktop)

The simplest method — no terminal, no JSON editing, no Node.js install required.

1. Download `blumira-mcp.mcpb` from the [latest release](https://github.com/w159/blumira-mcp/releases/latest)
2. Open the file (double-click or drag into Claude Desktop)
3. Enter your Blumira JWT token when prompted

For **Claude Code (CLI)**, one command:

```bash
claude mcp add blumira-mcp \
  -e BLUMIRA_JWT_TOKEN=your-jwt-token \
  -- npx -y github:w159/blumira-mcp
```

### Option 2: From Source

```bash
git clone https://github.com/w159/blumira-mcp.git
cd blumira-mcp
npm ci
npm run build
```

## Configuration

Provide EITHER OAuth client credentials OR a JWT token.

| Variable | Description | Default |
|----------|-------------|---------|
| `BLUMIRA_CLIENT_ID` | OAuth2 client_id (exchanged for a bearer token) | — |
| `BLUMIRA_CLIENT_SECRET` | OAuth2 client_secret | — |
| `BLUMIRA_JWT_TOKEN` | Pre-issued JWT bearer token (alternative to OAuth) | — |
| `BLUMIRA_BASE_URL` | API base URL override (optional) | `https://api.blumira.com/public-api/v1` |
| `MCP_TRANSPORT` | Transport mode (`stdio` or `http`) | `stdio` |
| `MCP_HTTP_PORT` | HTTP server port | `8080` |
| `AUTH_MODE` | Auth mode (`env` or `gateway`) | `env` |
| `LOG_LEVEL` | Log level (`debug`, `info`, `warn`, `error`) | `info` |

## Domains

The server uses decision-tree navigation. Start with `blumira_navigate` to pick a domain:

| Domain | Tools |
|--------|-------|
| **findings** | List findings, get finding, get finding details, get finding evidence, resolve finding, assign owners, list/add comments |
| **agents** | List devices, get device, list agent keys, get agent key |
| **users** | List users |
| **resolutions** | List available resolutions |
| **msp** | List/get accounts, list/get/resolve findings, get finding evidence, assign owners, comments, list devices/keys, list users |

## Filtering

Blumira supports rich query filtering on list endpoints:

```
status.eq=10              # Exact match
priority.in=1,2           # Multiple values
created.gt=2026-01-01     # Greater than
name.contains=malware     # Substring match
status.!eq=40             # Negation
```

Pass filters as tool input parameters — the server handles query string construction.

## Development

```bash
npm ci
npm run build       # Build the project
npm run dev         # Watch mode
npm run test        # Run tests
npm run lint        # Type-check
npm run clean       # Remove dist/
```

## License

Apache 2.0
