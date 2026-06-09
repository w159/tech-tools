# AI Tech Toolkit

<!-- markdownlint-disable MD032 MD033 MD040 MD051 MD060 -->

Monorepo of MCP servers, plugins, and supporting Node.js client libraries for common MSP/IT vendor APIs. A production-grade toolkit of **Model Context Protocol (MCP) servers, vendor SDKs, and Claude Code plugins** that turn an LLM agent into an autonomous **MSP (Managed Service Provider) operator**. One toolkit gives an AI agent first-class access to the security, RMM, PSA, M365, HR, backup, and compliance platforms an MSP runs every day.

> Built and maintained by **w159**. The toolkit currently ships **10 MCP servers**, **7 typed Node SDKs**, **27 Claude Code plugins** (across a plugin marketplace), and a curated **vendor + framework documentation set** that an AI agent can read directly while it works.

---

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Repository Layout](#repository-layout)
- [Environment Setup](#environment-setup)
- [Environment Variables](#environment-variables)
- [Authentication & Authorization](#authentication--authorization)
- [MCP Servers](#mcp-servers)
- [Claude Code Plugins](#claude-code-plugins)
- [Skills](#skills)
- [Node SDK Libraries](#node-sdk-libraries)
- [API Integrations](#api-integrations)
- [Testing & Validation](#testing--validation)
- [Scripts & Automation](#scripts--automation)
- [Security Considerations](#security-considerations)
- [Performance Considerations](#performance-considerations)
- [Contributing Guide](#contributing-guide)
- [Extending the Project](#extending-the-project)
- [Troubleshooting](#troubleshooting)
- [FAQ](#faq)
- [License](#license)

---

## Overview

### Business Purpose

MSPs run a stack of vendor portals — Auvik, NinjaOne, ConnectWise, CIPP/M365, ThreatLocker, KnowBe4, Blumira, Vanta, Paylocity. Each has a REST API, its own auth, its own pagination, and its own quirks. This repo gives an AI agent (Claude Desktop, Claude Code, or any MCP-compatible client) **one consistent way to read and act across all of them**.

### Target Users

- **MSP technicians & analysts** wanting an LLM copilot that can actually pull tickets, devices, alerts, users, and approvals.
- **MSP engineering / automation teams** building agentic workflows across multiple vendors.
- **Independent operators** who want a private, locally-runnable Claude integration for their own M365/RMM/PSA stack.

### Core Capabilities

- **10 MCP servers** wrapping the most common MSP vendor APIs.
- **Cross-platform + bridge Claude Code plugins** that orchestrate parallel fan-out across vendors and hand work cleanly between tools (e.g. *morning briefing*, *client 360*, *unified incident response*, *ConnectWise ticket -> NinjaOne triage*).
- **Plugin marketplace** -- 27 plugins installable via `claude plugin marketplace add W159/aikit` once published, or locally via the path.
- **Compact-by-default responses** -- all list/get tools return concise summaries by default; pass `fields=[...]` to select specific fields or `full=true` to get the raw vendor payload. Errors are structured `{error:{code, message, detail, hint}}` so agents can act on them.
- **Pre-built `.mcpb` bundles** -- drop into Claude Desktop and go.
- **End-to-end test harness** (`test-mcp-tools.mjs`) that exercises every server against real credentials.
- **Curated vendor + framework documentation** (`docs/`) so the agent never has to leave the repo to find an API shape.

### Key Differentiators

- **Real SDKs, not just MCP wrappers.** The `mcp_node/` folder ships fully typed Node.js clients (`node-auvik`, `node-ninjaone`, `node-vanta`, etc.) that the MCP layer sits on top of — usable from any non-MCP project too.
- **Cross-vendor super-skills.** The `msp-command-center` plugin fans out across 6 vendor MCPs in parallel for a single user query, while `msp-tool-bridge-ops` pivots directly between PSA and RMM workflows when one platform needs evidence from another.
- **Production-grade packaging.** A hardened `pack-mcpb.js` script guards against broken bundles before they ever ship to Claude Desktop.

---

## Architecture

```text
+----------------------------------------------------------------+
|                      Claude Desktop / Claude Code              |
|                                                                |
|  +------------------+    +------------------+                  |
|  | cross-platform + |    | vendor-specific  |   plugins/       |
|  | bridge plugins   |    | plugins (9)      |                  |
|  | (2)              |    |                  |                  |
|  +---------+--------+    +---------+--------+                  |
|            |                       |                           |
|            v                       v                           |
|  +-------------------- MCP (stdio JSON-RPC) ----------------+  |
+----|----------------------------------------------------|------+
     v                                                    v
+-----------------+   +--------------+   +-----------+   +-----------+
| auvik-mcp       |   | cipp-mcp     |   | ...       |   | vanta-mcp |
| (TypeScript)    |   | (TypeScript) |   |           |   |           |
+--------+--------+   +------+-------+   +-----+-----+   +-----+-----+
         |                   |                 |               |
         v                   v                 v               v
+-----------------+   +--------------+   +-----------+   +-----------+
| node-auvik SDK  |   | fetch + zod  |   | node-*    |   | node-vanta|
+--------+--------+   +------+-------+   +-----+-----+   +-----+-----+
         |                   |                 |               |
         v                   v                 v               v
   Auvik REST API     CIPP /api          Vendor REST       Vanta REST
   (us1/eu1/anz1)    (Azure Function)    APIs              api.vanta.com
```

### Data Flow

1. **User prompt → Claude.** User asks Claude something like *"Show me every BEC-suspicious sign-in across all my tenants this morning."*
2. **Skill activates.** A Claude Code plugin (e.g. `cipp-m365-ops/skills/suspicious-signin-hunt`) tells Claude how to decompose the task.
3. **MCP tool calls.** Claude calls one or more MCP tools over stdio JSON-RPC (e.g. `cipp_list_tenants`, then `cipp_get_signin_logs` per tenant).
4. **Server → SDK → REST.** The MCP server validates input with `zod`, delegates to the typed Node SDK in `mcp_node/`, and hits the vendor REST API.
5. **Normalized response.** The server returns a structured JSON payload — the LLM summarizes, clusters, and ranks.

### Authentication Flow

Every MCP server reads credentials from environment variables at boot (Claude Desktop passes them in via the bundle manifest, or `test-mcp-tools.mjs` reads them from `.env`). Three auth flavors are used across the stack:

| Flavor | Used by | Notes |
| --- | --- | --- || **Static API key / JWT** | Auvik, Blumira, KnowBe4, ThreatLocker, CIPP (legacy) | Sent as `Authorization: Bearer` or vendor-specific header. |
| **OAuth2 client_credentials** | NinjaOne, Vanta, Paylocity, CIPP (modern) | Token minted on demand, cached ~1h. Vanta token endpoint is **rate-limited to 5 req/min** — reuse is critical. |
| **Public/Private key + Client ID** | ConnectWise Manage | Basic-auth-style with `companyId+publicKey:privateKey` and a `clientId` header. |

### Permission Model

- Permission scoping happens **at the vendor**, not in the MCP layer. The MCP server is only as powerful as the API user it's given.
- For shared/managed orgs (ThreatLocker child orgs, CIPP customer tenants, Auvik multi-tenants), the MCP servers expose per-call tenant/org parameters.

---

## Tech Stack

| Layer | Technology | Purpose | Docs |
| --- | --- | --- | --- || Protocol | **Model Context Protocol** (2024-11-05 → 2025-11-25) | Tool / resource interface between Claude and servers | <https://modelcontextprotocol.io> |
| MCP SDK | **`@modelcontextprotocol/sdk`** (TypeScript) | Server framework | <https://github.com/modelcontextprotocol/typescript-sdk> |
| Runtime | **Node.js ≥ 18** (ESM) | All MCP servers + SDKs | <https://nodejs.org> |
| Build | **`tsup`** + **`tsc`** | Bundle to `dist/` + emit types | <https://tsup.egoist.dev/> |
| Validation | **`zod`** | Tool input schemas | <https://zod.dev> |
| Test | **`vitest`** | Unit tests for SDKs | <https://vitest.dev> |
| Packaging | **`mcpb`** (Anthropic) + custom `pack-mcpb.js` | `.mcpb` bundles for Claude Desktop | <https://github.com/anthropics/mcpb> |
| Client surface | **Claude Code plugins** + skills + slash commands | Orchestration layer | <https://docs.claude.com/en/docs/claude-code> |

---

## Repository Layout

```text
ai-tech-toolkit/
├── mcp_servers/         10 MCP servers (one per vendor) + _shared tooling
├── mcp_node/            7 typed Node.js SDK libraries the servers depend on
├── plugins/             27 Claude Code plugins (skills + slash commands)
├── skills/              13 standalone skills installable into any Claude Code workspace
├── .claude-plugin/      Marketplace manifest (marketplace.json) + root plugin.json
├── docs/                Vendor API docs + framework references (read by AI agents)
├── .env.template        Credential template for the test harness
├── test-mcp-tools.mjs   End-to-end MCP server tester
└── README.md
```

<details>
<summary><strong>Click to expand detailed file breakdown</strong></summary>

### `mcp_servers/`

Each `mcp_servers/<vendor>-mcp/` package is a standalone TypeScript MCP server:

```text
<vendor>-mcp/
├── src/                  TypeScript source (entry typically src/index.ts or src/entry.ts)
├── dist/                 Build output (committed for bundle reproducibility)
├── tests/                Vitest unit tests
├── scripts/              pack-mcpb.js (uses _shared/pack-mcpb.js)
├── manifest.json         MCPB bundle manifest (entry_point, env vars, metadata)
├── server.json           MCP server metadata (some vendors only)
├── package.json          Declares deps + scripts (build, pack, test)
├── tsconfig.json
├── <vendor>-mcp.mcpb     Pre-packed bundle ready for Claude Desktop
├── README.md             Vendor-specific setup
├── LICENSE
├── CHANGELOG.md
├── SECURITY.md
└── CODE_OF_CONDUCT.md
```

**Important files:**

- `manifest.json` — Declares `entry_point`, required env vars, display name. Consumed by Claude Desktop when you install the `.mcpb`.
- `<vendor>-mcp.mcpb` — A zip archive containing the staged `dist/` + production `node_modules/`. Drag-and-drop into Claude Desktop to install.

### `mcp_servers/_shared/pack-mcpb.js`

Canonical hardened packer. Drop a thin `scripts/pack-mcpb.js` into any server that re-exports it. It enforces seven invariants (npm install, build script presence, dist entry existence, staged-tree integrity, every prod dep staged, ignored-file overrides for `mcpb pack`, and a final tarball assertion) so a broken bundle cannot reach Claude Desktop.

### `mcp_node/`

Each `mcp_node/node-<vendor>/` is a fully typed REST client library — independent of MCP. The corresponding MCP server depends on it via `dependencies` in its `package.json`.

```text
node-<vendor>/
├── src/                  TypeScript source
├── dist/                 tsup output (cjs + esm + d.ts)
├── tests/                vitest
├── package.json
├── tsconfig.json
├── tsup.config.ts
├── vitest.config.ts
├── README.md
└── LICENSE
```

### `plugins/`

Each `plugins/<name>/` is a Claude Code plugin. The repo ships 27 plugins organized under a marketplace manifest at `.claude-plugin/marketplace.json`.

```text
<plugin-name>/
├── .claude-plugin/
│   └── plugin.json       Manifest (name, version, mcp_dependencies)
├── commands/             *.md slash commands (e.g. /briefing, /cipp-morning)
└── skills/               Folder per skill (each contains SKILL.md + assets)
```

The `mcp_dependencies` array names the MCP servers that **must be installed** for the plugin's skills to function. The plugin layer never makes HTTP calls itself -- it instructs Claude how to compose MCP tool calls.

### `.claude-plugin/marketplace.json`

The root marketplace manifest lists all 27 plugins with name, source path, description, category, and keywords. It enables bulk discovery and future registry publication.

```bash
# Install all plugins from a local clone
claude plugin marketplace add ./path/to/aikit

# Install a single plugin by name (once published to the registry as W159/aikit)
claude plugin install <plugin-name>@aikit

# Browse available plugins in the Claude Code /plugin Discover tab
# (shows plugins declared in marketplace.json)
```

### `docs/`

Read-only documentation tree the agent can grep / read while it works:

- `docs/vendors/<vendor>/` — README + OpenAPI specs + sample payloads + (where licensable) shallow clones of the vendor's upstream repo.
- `docs/frameworks/` — Anthropic SDK source, MCP TypeScript & Python SDKs, MCP spec (every revision), Claude Code docs mirror.

</details>

---

## Environment Setup

### Prerequisites

| Tool | Min Version | Install |
| --- | --- | --- || Node.js | 18 LTS | <https://nodejs.org/en/download> |
| npm | 9+ | bundled with Node |
| `mcpb` CLI (optional, for re-packing) | latest | `npm install -g @anthropic-ai/mcpb` — <https://github.com/anthropics/mcpb> |
| Claude Desktop **or** Claude Code | latest | <https://claude.ai/download> / <https://docs.claude.com/en/docs/claude-code> |

You also need API credentials for whichever vendors you want to connect to (see [Environment Variables](#environment-variables)).

### Installation

```bash
# 1. Clone
git clone <this-repo-url> ai-tech-toolkit
cd ai-tech-toolkit

# 2. Configure credentials
cp .env.template .env
$EDITOR .env          # fill in the vendors you have access to

# 3. (Optional) install workspace deps for any server you want to rebuild
cd mcp_servers/auvik-mcp && npm install && npm run build && cd ../..

# 4. Verify everything boots and can call its API
node test-mcp-tools.mjs               # all servers with creds present
node test-mcp-tools.mjs auvik vanta   # subset
```text

### Installing an MCP server into Claude Desktop

1. Open Claude Desktop → **Settings → Developer → Install MCP Bundle**.
2. Choose `mcp_servers/<vendor>-mcp/<vendor>-mcp.mcpb`.
3. Fill in the env vars Claude Desktop prompts for (mirrors of the values in `.env`).

### Installing a plugin into Claude Code

```bash
# from your Claude Code workspace
claude code plugin install /absolute/path/to/ai-tech-toolkit/plugins/msp-command-center
```

The plugin will refuse to activate skills whose `mcp_dependencies` are not installed.

---

## Environment Variables

The canonical list lives in [`.env.template`](.env.template). Empty values are treated as **"skip this server"** by `test-mcp-tools.mjs`.

| Variable | Required | Server | Description |
| --- | --- | --- | --- || `AUVIK_USERNAME` | ✅ | auvik-mcp | Auvik portal username (email). |
| `AUVIK_API_KEY` | ✅ | auvik-mcp | Auvik portal API key. |
| `AUVIK_REGION` | ⬜ | auvik-mcp | `us1` (default), `eu1`, `anz1`, … |
| `BLUMIRA_JWT_TOKEN` | ✅ | blumira-mcp | Long-lived JWT from Blumira → Integrations → API. |
| `CIPP_BASE_URL` | ✅ | cipp-mcp | URL of the deployed CIPP Azure Function. |
| `CIPP_API_KEY` | one-of | cipp-mcp | Legacy static bearer. |
| `CIPP_TENANT_ID` / `CIPP_CLIENT_ID` / `CIPP_CLIENT_SECRET` | one-of | cipp-mcp | Modern OAuth2 trio. |
| `CW_MANAGE_COMPANY_ID` | ✅ | connectwise-manage-mcp | ConnectWise company ID. |
| `CW_MANAGE_PUBLIC_KEY` / `CW_MANAGE_PRIVATE_KEY` | ✅ | connectwise-manage-mcp | API key pair. |
| `CW_MANAGE_CLIENT_ID` | ✅ | connectwise-manage-mcp | Registered integrator client ID. |
| `CW_MANAGE_BASE_URL` | ✅ | connectwise-manage-mcp | e.g. `na.myconnectwise.net`. |
| `KNOWBE4_API_KEY` | ✅ | knowbe4-mcp | KnowBe4 → Account Settings → API. |
| `KNOWBE4_REGION` | ⬜ | knowbe4-mcp | `us` (default), `eu`, `ca`, `uk`, `de`. |
| `NINJAONE_CLIENT_ID` / `NINJAONE_CLIENT_SECRET` | ✅ | ninjaone-mcp | OAuth client credentials. |
| `NINJAONE_REGION` | ⬜ | ninjaone-mcp | `us` (default), `eu`, `ca`, `oc`. |
| `THREATLOCKER_API_KEY` | ✅ | threatlocker-mcp | Portal → Administrators → API Users. |
| `THREATLOCKER_ORGANIZATION_ID` | ⬜ | threatlocker-mcp | Only when acting on a managed child org. |
| `THREATLOCKER_BASE_URL` | ⬜ | threatlocker-mcp | Override for non-default shard. |
| `VANTA_CLIENT_ID` / `VANTA_CLIENT_SECRET` | ✅ | vanta-mcp | OAuth2 client_credentials. |
| `VANTA_BASE_URL` | ⬜ | vanta-mcp | Default `https://api.vanta.com/v1`. |
| `PAYLOCITY_CLIENT_ID` / `PAYLOCITY_CLIENT_SECRET` | ✅ | paylocity-mcp | OAuth2 client_credentials. |
| `PAYLOCITY_COMPANY_ID` | ✅ | paylocity-mcp | Scopes all Paylocity calls. |
| `PAYLOCITY_BASE_URL` | ⬜ | paylocity-mcp | Defaults to `https://api.paylocity.com`. |
| `PAYLOCITY_SANDBOX` | ⬜ | paylocity-mcp | `true` → sandbox URL (overridden by `BASE_URL`). |

**Security:** `.env` is gitignored by the strict allowlist in `.gitignore`. Never commit. Use a secret manager in production (Doppler, 1Password CLI, Azure Key Vault). Rotate keys after sharing the file with anyone.

---

## Authentication & Authorization

| Vendor | Flow | Token caching | Required scopes / roles |
| --- | --- | --- | --- || Auvik | Static API key | n/a | API access enabled on the portal user. |
| Blumira | Long-lived JWT | n/a | Generated under Integrations → API. |
| CIPP (legacy) | Static bearer | n/a | Granted by CIPP admin. |
| CIPP (modern) | OAuth2 client_credentials against Entra ID | ~1h | App registration with delegated access to CIPP-API. See `mcp_servers/connectwise-manage-mcp/entra-app-registration.md`. |
| ConnectWise Manage | Public/Private key + `clientId` header | n/a | Member with API access; client ID registered at <https://developer.connectwise.com>. |
| KnowBe4 | Static API key | n/a | Account-level API toggle. |
| NinjaOne | OAuth2 client_credentials | ~1h | Scopes: `monitoring`, `management`, `control` as needed. |
| ThreatLocker | Static API key | n/a | Portal API User with org permissions. |
| Vanta | OAuth2 client_credentials | ~1h, **token endpoint capped at 5 req/min** | Scopes vary by API surface; default trial scope covers reads. |
| Paylocity | OAuth2 client_credentials | ~1h | Approved API consumer; `COMPANY_ID` must match approved company. |

### Common failure modes

| Symptom | Likely cause | Fix |
| --- | --- | --- || `401 Unauthorized` | Wrong key / expired token | Re-mint, double-check env var spelling. |
| `403 Forbidden` on a specific tool | API user lacks role for that endpoint | Add the missing role in the vendor portal (e.g. CIPP `ListTenants` needs tenant-read). |
| `406 Not Acceptable` | Wrong `Accept` header (seen on Paylocity token endpoint) | Verify content-type negotiation; check vendor changelog. |
| `429` from Vanta during boot | Hammering the 5 req/min token endpoint | Reuse a single MCP server instance; do not restart in a loop. |

### Official auth docs

- Microsoft Graph (CIPP backend): <https://learn.microsoft.com/en-us/graph/auth/auth-concepts>
- OAuth 2.0 client_credentials: <https://datatracker.ietf.org/doc/html/rfc6749#section-4.4>
- ConnectWise Manage auth: <https://developer.connectwise.com/Products/ConnectWise_PSA/REST>
- NinjaOne API auth: <https://app.ninjarmm.com/apidocs/>
- Vanta auth: <https://developer.vanta.com/reference/authentication>
- Paylocity auth: <https://developer.paylocity.com/integrations/reference/authentication>

---

## MCP Servers

| Package | Version | Vendor | Bundle |
| --- | --- | --- | --- || [`auvik-mcp`](https://github.com/w159/ai-tech-toolkit/tree/main/mcp_servers/auvik-mcp) | 0.4.0 | Auvik network monitoring | `auvik-mcp.mcpb` |
| [`blumira-mcp`](https://github.com/w159/ai-tech-toolkit/tree/main/mcp_servers/blumira-mcp) | 1.1.0 | Blumira SIEM/XDR | `blumira-mcp.mcpb` |
| [`cipp-mcp`](https://github.com/w159/ai-tech-toolkit/tree/main/mcp_servers/cipp-mcp) | 0.2.0 | CIPP -- M365 MSP control plane | `cipp-mcp.mcpb` |
| [`connectwise-manage-mcp`](https://github.com/w159/ai-tech-toolkit/tree/main/mcp_servers/connectwise-manage-mcp) | 0.1.0 | ConnectWise Manage PSA | `connectwise-manage-mcp.mcpb` |
| [`kaseya-spanning-backup-mcp`](https://github.com/w159/ai-tech-toolkit/tree/main/mcp_servers/kaseya-spanning-backup-mcp) | 1.1.0 | Kaseya Spanning -- SaaS backup for M365/GWS/Salesforce | `kaseya-spanning-backup-mcp.mcpb` |
| [`knowbe4-mcp`](https://github.com/w159/ai-tech-toolkit/tree/main/mcp_servers/knowbe4-mcp) | 1.1.0 | KnowBe4 security awareness | `knowbe4-mcp.mcpb` |
| [`ninjaone-mcp`](https://github.com/w159/ai-tech-toolkit/tree/main/mcp_servers/ninjaone-mcp) | 1.6.0 | NinjaOne RMM | `ninjaone-mcp.mcpb` |
| [`paylocity-mcp`](https://github.com/w159/ai-tech-toolkit/tree/main/mcp_servers/paylocity-mcp) | 0.1.1 | Paylocity HR/payroll | `paylocity-mcp.mcpb` |
| [`threatlocker-mcp`](https://github.com/w159/ai-tech-toolkit/tree/main/mcp_servers/threatlocker-mcp) | 1.2.0 | ThreatLocker zero-trust EDR | `threatlocker-mcp.mcpb` |
| [`vanta-mcp`](https://github.com/w159/ai-tech-toolkit/tree/main/mcp_servers/vanta-mcp) | 0.2.0 | Vanta GRC / compliance | `vanta-mcp.mcpb` |

Every server speaks MCP over **stdio JSON-RPC** and registers its tools/resources via `@modelcontextprotocol/sdk`.

<details>
<summary><strong>Last verified tool counts and status (2026-06-09)</strong></summary>

| Server | Status | Tools | Notes |
| --- | --- | --- | --- || auvik | PASS | 39 | |
| blumira | SKIP | 30 | missing `BLUMIRA_JWT_TOKEN`; count from source, mcpb bundle pending rebuild |
| cipp | FAIL | 43 | HTTP 401 -- CIPP tenant permission issue (pre-existing); `tools/list` confirmed 43 tools boot correctly [1] |
| connectwise | PASS | 52 | |
| kaseya-spanning-backup | SKIP | 14 | missing `SPANNING_ADMIN_EMAIL` + `SPANNING_API_TOKEN`; count verified via `tools/list` |
| knowbe4 | PASS | 30 | `knowbe4_status` OK; `knowbe4_account_get` returns 500 (vendor-side API key scope issue, not a creds-absent skip) |
| ninjaone | PASS | 26 | |
| paylocity | PASS | 16 | |
| threatlocker | PASS | 17 | |
| vanta | PASS | 28 | |

[1] CIPP 401 is a pre-existing tenant permission issue: the API caller lacks the `ListTenants` permission inside CIPP. Fix: CIPP -> Settings -> Application Settings -> API -> grant `ListTenants`. The server itself boots and registers all 43 tools correctly.

Re-run any time with `node test-mcp-tools.mjs`.

</details>

---

## Claude Code Plugins

All 27 plugins live under `plugins/` and are listed in the marketplace manifest at `.claude-plugin/marketplace.json`. Each declares its required MCP servers in its own `.claude-plugin/plugin.json` and ships **skills** (Claude follows them like a runbook) and **slash commands** (one-shot entry points).

**MSP vendor plugins** (10) -- each wraps one vendor's MCP server:

| Plugin | MCP Deps | Skills | Slash Commands |
| --- | --- | --- | --- || [`msp-command-center`](plugins/msp-command-center) | auvik, cipp, connectwise, knowbe4, ninjaone, threatlocker | `client-360`, `cross-platform-incident`, `morning-briefing` | `/briefing`, `/client`, `/incident` |
| [`msp-tool-bridge-ops`](plugins/msp-tool-bridge-ops) | connectwise-manage, ninjaone | `cw-ticket-device-troubleshoot`, `ninja-device-ticket-sync` | `/cw-device-triage`, `/ninja-ticket-sync` |
| [`auvik-network-ops`](plugins/auvik-network-ops) | auvik | `bandwidth-hog-hunt`, `config-drift-watch`, `network-triage` | `/auvik-triage` |
| [`cipp-m365-ops`](plugins/cipp-m365-ops) | cipp | `bec-rapid-response`, `full-offboard`, `suspicious-signin-hunt`, `tenant-health-sweep` | `/cipp-morning` |
| [`connectwise-psa-ops`](plugins/connectwise-psa-ops) | connectwise-manage | `project-burndown`, `sla-breach-radar`, `ticket-triage`, `utilization-report` | `/cw-sla-radar` |
| [`kaseya-spanning-backup-ops`](plugins/kaseya-spanning-backup-ops) | kaseya-spanning-backup | `audit-forensics`, `backup-health-sweep`, `license-utilization`, `restore-orchestrator` | `/spanning-health`, `/spanning-restore` |
| [`knowbe4-security-training`](plugins/knowbe4-security-training) | knowbe4 | `campaign-effectiveness`, `phishing-failure-cohort`, `risk-heatmap` | `/kb4-heatmap` |
| [`ninjaone-rmm-ops`](plugins/ninjaone-rmm-ops) | ninjaone | `fleet-health-sweep`, `mass-incident-response`, `offline-device-hunt` | `/ninja-sweep` |
| [`paylocity-hr-ops`](plugins/paylocity-hr-ops) | paylocity | `deduction-and-tax-overview`, `new-hire-flow`, `pay-rate-audit`, `roster-snapshot` | `/paylocity-new-hires`, `/paylocity-roster` |
| [`threatlocker-zerotrust-ops`](plugins/threatlocker-zerotrust-ops) | threatlocker | `approval-queue-triage`, `audit-forensics`, `child-org-rollup` | `/tl-approvals` |
| [`vanta-compliance-ops`](plugins/vanta-compliance-ops) | vanta | `evidence-gap-hunter`, `framework-audit-readiness`, `vendor-risk-rollup`, `vulnerability-triage` | `/vanta-audit-prep`, `/vanta-morning` |

**Knowledge-worker and platform plugins** (16) -- no MCP server dependency:

| Plugin | Purpose |
| --- | --- || `brand-voice` | Discover, enforce, and generate brand voice guidelines across content |
| `cowork-plugin-management` | Manage Claude Code plugin installations and marketplace entries |
| `customer-support` | Customer support workflow skills (ticket routing, response drafting) |
| `data` | Data analysis and transformation skills |
| `design` | Design workflow skills (Figma-adjacent, asset management) |
| `engineering` | Engineering workflow skills (code review, PR triage, runbooks) |
| `enterprise-search` | Cross-source search orchestration across vendor data |
| `finance` | Finance workflow skills (budget review, expense categorization) |
| `human-resources` | HR workflow skills (onboarding, offboarding, policy lookup) |
| `minutes` | Meeting minutes capture and action-item extraction (includes nested Rust app; excluded from marketplace auto-install) |
| `nudge` | Nudge-based reminder and follow-up workflow |
| `operations` | Operations workflow skills (runbooks, escalation trees) |
| `orchestrate` | Orchestration meta-plugin for driving multi-step agent workflows |
| `pdf-viewer` | PDF reading and summarization skills |
| `product-management` | Product management workflow skills (PRD drafting, roadmap triage) |
| `productivity` | General productivity skills (writing, summarization, task planning) |

> Plugin docs: <https://docs.claude.com/en/docs/claude-code/plugins>

### Plugin Marketplace

The repo ships a marketplace manifest at `.claude-plugin/marketplace.json`. Once the repo is published as `W159/aikit`:

```bash
# Add all plugins from the marketplace registry
claude plugin marketplace add W159/aikit

# Or install from a local clone
claude plugin marketplace add ./path/to/aikit

# Install a specific plugin by name
claude plugin install auvik-network-ops@aikit
```

The Claude Code `/plugin` Discover tab will list all marketplace entries once the manifest is registered.

---

## Skills

The `skills/` directory ships 13 curated skills installable into any Claude Code workspace. These are standalone -- they do not require any MCP server from this repo.

| Skill | Purpose |
| --- | --- || `az-cost-optimize` | Azure cost analysis and optimization recommendations |
| `azure-deployment-preflight` | Pre-flight checks before Azure resource deployments |
| `cloud-design-patterns` | Apply Azure cloud design patterns to architecture decisions |
| `codebase-brain` | Give a codebase persistent memory and a self-validation gate |
| `database-optimization` | Query analysis, index recommendations, schema review |
| `entra-agent-user` | Manage Entra ID (Azure AD) users and service principals via agent workflows |
| `graphify` | Turn any input (code, docs, data) into an interactive knowledge graph |
| `msgraph-sdk` | Guided Microsoft Graph SDK usage for common M365 operations |
| `msoffice-docs` | Read, summarize, and extract from Word/Excel/PowerPoint documents |
| `orchestrate` | Drive multi-step, multi-surface engineering work through parallel subagents |
| `scrapling-official` | Web scraping via the Scrapling library with anti-detection patterns |
| `security-audit` | Security review of code changes, dependencies, and configs |
| `webapp-testing` | End-to-end web app testing workflows (Playwright-oriented) |

The previous 25-skill set was consolidated to 13 in June 2026. Skills that were absorbed or merged: `codeql` and `pytest-coverage` merged into `security-audit`; `prompt-optimizer` and `self-improving` merged into `orchestrate` as referenced sub-patterns. The remaining retired skills had overlapping scope with the survivors.

## Node SDK Libraries

The MCP servers depend on these standalone, typed Node.js clients. You can use them directly from any Node project — they have no MCP coupling.

| Package | Version | Purpose |
| --- | --- | --- || [`node-auvik`](https://github.com/w159/ai-tech-toolkit/tree/main/mcp_node/node-auvik) | 1.0.0 | Auvik network monitoring API client. |
| [`node-blumira`](https://github.com/w159/ai-tech-toolkit/tree/main/mcp_node/node-blumira) | 1.0.1 | Blumira SIEM API client. |
| [`node-ninjaone`](https://github.com/w159/ai-tech-toolkit/tree/main/mcp_node/node-ninjaone) | 1.1.2 | NinjaOne / NinjaRMM API client — comprehensive, fully typed. |
| [`node-paylocity`](https://github.com/w159/ai-tech-toolkit/tree/main/mcp_node/node-paylocity) | 1.0.0 | Paylocity REST API client. |
| [`node-spanning`](https://github.com/w159/ai-tech-toolkit/tree/main/mcp_node/node-spanning) | 1.0.2 | Spanning Cloud Backup API client (M365 / GWS / SF). |
| [`node-threatlocker`](https://github.com/w159/ai-tech-toolkit/tree/main/mcp_node/node-threatlocker) | 1.0.3 | ThreatLocker Portal API client. |
| [`node-vanta`](https://github.com/w159/ai-tech-toolkit/tree/main/mcp_node/node-vanta) | 1.0.0 | Vanta REST API client. |

Each ships dual ESM/CJS bundles + `.d.ts` via `tsup`, and is fully unit-tested via `vitest`.

---

## API Integrations

<details>
<summary><strong>Auvik</strong></summary>

- **Purpose:** Network monitoring, topology, alerts, bandwidth.
- **Base URL:** `https://auvikapi.{region}.my.auvik.com/v1/`
- **Auth:** HTTP Basic (`username:apiKey`).
- **Docs:** <https://www.auvik.com/api/>
- **Local docs:** `docs/vendors/auvik/`

</details>

<details>
<summary><strong>Blumira</strong></summary>

- **Purpose:** SIEM/XDR — findings, detections, devices.
- **Base URL:** `https://api.blumira.com/`
- **Auth:** Long-lived JWT bearer.
- **Docs:** <https://app.blumira.com/api/v3/docs>
- **Local docs:** `docs/vendors/blumira/` (includes OpenAPI spec).

</details>

<details>
<summary><strong>CIPP (CyberDrain Improved Partner Portal)</strong></summary>

- **Purpose:** M365 multi-tenant management for MSPs (Azure Function backend wrapping Microsoft Graph).
- **Base URL:** customer-deployed Azure Function URL (set via `CIPP_BASE_URL`).
- **Auth:** Static bearer **or** OAuth2 against the CIPP-API Entra app.
- **Docs:** <https://docs.cipp.app>
- **Local docs:** `docs/vendors/cipp/` — includes full `CIPP-API` and `docs-site` clones (~192 MB). The `CIPP-API/Tools/cipp-openapispec.json` enumerates 192 endpoints.
- **Notes:** CIPP wraps Microsoft Graph — see <https://learn.microsoft.com/en-us/graph/overview>.

</details>

<details>
<summary><strong>ConnectWise Manage</strong></summary>

- **Purpose:** PSA — tickets, companies, projects, time entries, agreements.
- **Base URL:** `https://{site}.connectwise.com/v4_6_release/apis/3.0/` (e.g. `https://api-na.myconnectwise.net/...`).
- **Auth:** Basic auth with `companyId+publicKey:privateKey` plus `clientId` header.
- **Docs:** <https://developer.connectwise.com/Products/ConnectWise_PSA/REST>
- **Local docs:** `docs/vendors/connectwise-manage/`

</details>

<details>
<summary><strong>KnowBe4</strong></summary>

- **Purpose:** Security awareness training, phishing simulation, user risk.
- **Base URLs:** Reporting API + User Event API + GraphQL — region-specific (`us`/`eu`/`ca`/`uk`/`de`).
- **Auth:** Static API key.
- **Docs:** <https://developer.knowbe4.com/>
- **Local docs:** `docs/vendors/knowbe4/` (includes OpenAPI YAML for Reporting + User Event).

</details>

<details>
<summary><strong>NinjaOne (NinjaRMM)</strong></summary>

- **Purpose:** RMM — devices, alerts, organizations, patching, scripting.
- **Base URL:** `https://{region}.ninjarmm.com/v2/`
- **Auth:** OAuth2 client_credentials.
- **Docs:** <https://app.ninjarmm.com/apidocs/>
- **Local docs:** `docs/vendors/ninjaone/`

</details>

<details>
<summary><strong>Paylocity</strong></summary>

- **Purpose:** HR / payroll — employees, deductions, taxes, new hires.
- **Base URL:** `https://api.paylocity.com/api` (or `https://apisandbox.paylocity.com` if `PAYLOCITY_SANDBOX=true`).
- **Auth:** OAuth2 client_credentials (form-urlencoded token endpoint).
- **Docs:** <https://developer.paylocity.com/integrations/reference>
- **Local docs:** `docs/vendors/paylocity/`

</details>

<details>
<summary><strong>ThreatLocker</strong></summary>

- **Purpose:** Zero-trust EDR — applications, approvals, audit, policies.
- **Base URL:** Portal-shard specific (see <https://threatlocker.kb.help/locating-your-organizations-instance/>).
- **Auth:** Static API key from Portal → Administrators → API Users.
- **Docs:** vendor portal Swagger (auth-gated).
- **Local docs:** `docs/vendors/threatlocker/`

</details>

<details>
<summary><strong>Vanta</strong></summary>

- **Purpose:** GRC — frameworks, controls, evidence, vendors, vulnerabilities.
- **Base URL:** `https://api.vanta.com/v1` (override only on shard moves).
- **Auth:** OAuth2 client_credentials. **Token endpoint capped at 5 req/min — reuse is critical**.
- **Docs:** <https://developer.vanta.com/reference>
- **Local docs:** `docs/vendors/vanta/` — includes 5 official Vanta repos cloned (including Vanta's own MCP server reference + Claude Code plugin).

</details>

---

## Data Models

Each vendor has its own object model — the MCP servers expose a normalized **tool input/output shape** validated with `zod`. The general shape is:

```ts
// Tool input (validated with zod)
const ListTicketsInput = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(1000).default(50),
  filters: z.record(z.string()).optional(),
});

// Tool output
type ToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  // Most servers return text containing pretty-printed JSON
  // so the LLM can reason over it directly.
};
```text

For the **typed object models** (`Ticket`, `Device`, `Alert`, `User`, `Tenant`, etc.) see each `node-<vendor>/src/types/` directory — these are the source of truth and are emitted as `.d.ts` declarations.

---

## Testing & Validation

### `test-mcp-tools.mjs`

End-to-end harness that:

1. Reads creds from `.env`.
2. Extracts each `.mcpb` bundle to a temp dir.
3. Spawns the entry over stdio with the env injected.
4. Sends `initialize` + `tools/list` to verify boot.
5. Calls one or more **safe read tools** per server (e.g. `auvik_status`, `cw_test_connection`, `vanta_list_frameworks`).
6. Prints PASS / FAIL / SKIPPED with a short response preview.

```bash
node test-mcp-tools.mjs                # all servers
node test-mcp-tools.mjs vanta auvik    # subset
```

### Per-package tests

Inside any SDK or server directory:

```bash
npm install
npm test           # vitest
npm run build      # tsup / tsc — must succeed before pack
npm run pack       # produces <name>.mcpb (servers only)
```text

### CI

Existing GitHub Actions workflows have been **intentionally disabled** (renamed `*.disabled`) to keep CI off during early iteration — see commit history. They can be re-enabled by removing the `.disabled` suffix when the repo is opened up publicly.

---

## Scripts & Automation

| Script | Where | Purpose |
| --- | --- | --- || `npm run build` | each `mcp_servers/*` and `mcp_node/*` | tsup/tsc → `dist/` |
| `npm test` | each package | vitest |
| `npm run pack` | each `mcp_servers/*` | Calls `_shared/pack-mcpb.js` to produce `<name>.mcpb` |
| `node test-mcp-tools.mjs` | repo root | End-to-end MCP server tester |
| `node mcp_servers/_shared/pack-mcpb.js` | repo root | Hardened MCPB packer (referenced by every server's `scripts/pack-mcpb.js`) |

---

## Security Considerations

- **Secrets:** `.env` files are denied by the strict allowlist `.gitignore` (see top of file). `.env.template` is intentionally tracked. Never commit a populated `.env`. Rotate any key you suspect has been pasted into a shared chat.
- **Token storage:** OAuth tokens are kept in-memory only — they are never written to disk by the MCP servers.
- **Scope minimization:** API users should be created **per integration**, with the minimum role required. Several vendors expose granular API roles (CIPP, ConnectWise, NinjaOne).
- **Input validation:** All tool inputs go through `zod` schemas before any outbound HTTP call.
- **Logging hygiene:** Servers log to stderr (so it doesn't pollute the MCP stdio channel). Tokens and authorization headers are stripped from log lines.
- **No write-by-default:** The shipped slash commands and skills favor **read** tools. Destructive operations (offboard, ticket close, approval grant) require an explicit user confirmation step inside the skill.

---

## Performance Considerations

- **Token caching:** OAuth-based vendors mint tokens at boot and cache for ~1h. Vanta's 5 req/min ceiling on the token endpoint makes this a hard requirement, not an optimization.
- **Pagination:** Tools that return collections accept `page` + `pageSize` and pass them through to the vendor — never auto-paginate the entire dataset.
- **Parallel fan-out:** The cross-vendor plugins (`msp-command-center`) ask Claude to issue tool calls in parallel where there's no data dependency.
- **Bundle size:** `.mcpb` bundles include `node_modules`. Production deps only (`npm ci --omit=dev`) before pack.

---

## Contributing Guide

### Code style

- **Language:** TypeScript, strict mode.
- **Module system:** ESM throughout (`"type": "module"`).
- **Lint:** ESLint configs are per-package (`.eslintrc.json` / `.eslintrc.cjs`).
- **Formatting:** Prettier defaults.

### Branching & PRs

- Branch from `main`. Keep diffs scoped to one server or one plugin per PR.
- Run `node test-mcp-tools.mjs <server>` and `npm test` in the affected package before opening the PR.
- A PR adding a new vendor must include: a `node-<vendor>` SDK, the `mcp_servers/<vendor>-mcp` package, a docs folder under `docs/vendors/<vendor>/`, env-var entries in `.env.template`, and a registry entry in `test-mcp-tools.mjs`.

### Commit conventions

Short imperative subject (≤ 70 chars). The existing log uses descriptive sentences — match that style.

### Documentation standards

If you add an endpoint, also add or update the markdown page in `docs/vendors/<vendor>/`. When pulling from an upstream source, paste the source URL at the top of the page so future refreshes can verify it.

---

## Extending the Project

### Add a new MCP tool to an existing server

1. Edit `mcp_servers/<vendor>-mcp/src/tools/<area>.ts` — add a `zod` input schema and a handler that delegates to the SDK.
2. Register it in the server's tool registry (`src/index.ts` or `src/registry.ts`).
3. Add a test under `tests/`.
4. `npm run build && npm run pack`.
5. Add a probe to `test-mcp-tools.mjs` if it is safe (read-only).

### Add a new vendor integration end-to-end

1. **SDK:** scaffold `mcp_node/node-<vendor>` (copy the closest existing SDK as a template; replace transport + types).
2. **Server:** scaffold `mcp_servers/<vendor>-mcp` — `dependencies: ["node-<vendor>", "@modelcontextprotocol/sdk", "zod"]`.
3. **Manifest:** fill in `manifest.json` (entry_point, env vars, display name).
4. **Pack:** wire `scripts/pack-mcpb.js` to re-export `_shared/pack-mcpb.js`.
5. **Docs:** create `docs/vendors/<vendor>/README.md` + endpoint reference.
6. **Plugin (optional):** create `plugins/<vendor>-ops/` with one or more skills.
7. **Registry:** add to `.env.template` and to `SERVERS` in `test-mcp-tools.mjs`.

### Add a new Claude Code plugin

1. `plugins/<name>/.claude-plugin/plugin.json` — list `mcp_dependencies` precisely.
2. `plugins/<name>/skills/<skill-name>/SKILL.md` — runbook the agent will follow.
3. `plugins/<name>/commands/<command>.md` — optional slash command entry point.

---

## Troubleshooting

| Issue | Diagnosis |
| --- | --- || **`Server SKIPPED` in `test-mcp-tools.mjs`** | A required env var is blank in `.env`. Open `.env.template` for the list. |
| **`401 Unauthorized`** | Wrong key, wrong region, or revoked credentials. Re-issue and re-paste. |
| **`403 Forbidden`** on a specific tool | The API user lacks role for that endpoint. Check vendor portal role assignment. |
| **`406 Not Acceptable`** (Paylocity) | Token-endpoint negotiating wrong content-type — confirm the Paylocity app is approved for the `accounting` / `payroll` scope you expect. |
| **`429 Too Many Requests`** (Vanta) | Restarted the server in a hot loop — Vanta's token endpoint allows 5 req/min. Wait 60 s. |
| **CIPP `ListTenants` 401** | API caller missing tenant-read permission inside CIPP. Grant in CIPP → Settings → Application Settings → API. |
| **Bundle fails to launch in Claude Desktop** | Re-pack: `npm run pack`. The hardened packer aborts loudly if entry/deps are missing. |
| **`Cannot find module 'node-<vendor>'`** | The SDK was not built (`npm run build` in `mcp_node/node-<vendor>`) or not staged into the bundle (`npm install` in the server first). |
| **`Server exited before initialize`** | Run the server outside the bundle to see stderr: `node mcp_servers/<vendor>-mcp/dist/index.js`. |

---

## FAQ

**Q: Do I need *all* the MCP servers?**
No. Install only the bundles you have credentials for. Plugins refuse to activate if their declared `mcp_dependencies` are absent.

**Q: Can I use the SDKs without MCP / Claude?**
Yes. The `mcp_node/node-*` packages are plain TypeScript libraries with no Claude or MCP coupling.

**Q: Why do the `dist/` folders get committed?**
So pre-built `.mcpb` bundles are byte-reproducible and so a fresh clone can run `test-mcp-tools.mjs` without a build step.

**Q: How do I refresh the vendor docs?**
The cloned vendor repos under `docs/vendors/*` are depth-1 clones. `git -C docs/vendors/<vendor>/<repo> pull` to update.

---

## License

License files are tracked per-package — see `mcp_servers/*/LICENSE` and `mcp_node/*/LICENSE`. No repo-wide license file is currently set. Treat the toolkit as **proprietary** until a top-level `LICENSE` is added.
