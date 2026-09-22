# PAN-OS MCP Server

A Model Context Protocol (MCP) server for the PAN-OS XML and REST APIs, covering both Panorama and standalone firewalls.

## Architecture

This MCP server exposes **all of its tools up front** and uses `panos_navigate` purely as a discovery aid:

1. **Every tool is callable at any time** — `panos_navigate` only *describes* a domain's tools; nothing is gated behind it
2. **Credential gating, not domain gating**: the tool list depends on which credentials are present, never on a prior navigation call
3. **Lazy loading**: domain handlers and the PAN-OS client are imported on demand, so a server with sparse credentials never pays for schemas it cannot use

The credential gate (`src/server.ts`) has three states rather than the usual on/off, because `panos_keygen` must be reachable *before* an API key exists:

| State | Exposed tools |
|-------|---------------|
| `PANOS_HOST` absent | `panos_status`, `panos_navigate` |
| host set, no API key, username + password set | `panos_status`, `panos_navigate`, `panos_keygen` |
| host + API key set | all 60 tools |

## Installation

`panos-mcp` consumes `node-panos` as a local file dependency, so build it from inside the monorepo:

```bash
cd mcp_servers/panos-mcp
npm install
npm run build
```

## Configuration

Set the following environment variables:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PANOS_HOST` | Yes | none | Panorama or firewall hostname / IP. No scheme, no path |
| `PANOS_API_KEY` | Yes* | none | API key, sent in the `X-PAN-KEY` header. *Optional if username + password are set and `panos_keygen` is used to mint one |
| `PANOS_USERNAME` | No | none | Admin user, only used by `panos_keygen` |
| `PANOS_PASSWORD` | No | none | Admin password, only used by `panos_keygen` |
| `PANOS_TARGET` | No | none | Default managed-firewall serial when talking through Panorama |
| `PANOS_VERIFY_TLS` | No | `true` | Set `false` only for an appliance serving a self-signed certificate; that disables certificate verification for this host |
| `PANOS_REST_VERSION` | No | `v11.1` | REST API version path segment |

### There is no default base URL

Every other connector in this repo ships a hardcoded vendor base URL. PAN-OS publishes none, because the base URL **is** the appliance: `https://<PANOS_HOST>/api/` for the XML API and `https://<PANOS_HOST>/restapi/<PANOS_REST_VERSION>/` for REST. `PANOS_HOST` is therefore required with no default — that is a deliberate exception, not an oversight.

### Target serials are strings

`PANOS_TARGET` is a managed-firewall serial number, and its leading zeros are significant: `023009014025` is a different appliance from `23009014025`. Any tool call may override it with its own `target` argument; omit `target` entirely to talk to the connected appliance itself.

## Usage

### Running Standalone

```bash
export PANOS_HOST="panorama.example.com"
export PANOS_API_KEY="your-api-key"
export PANOS_TARGET="023009014025"   # optional

node dist/index.js
```

### Claude Desktop Configuration

Build a `.mcpb` bundle with `npm run pack:mcpb` and install it, or wire the built entry point up directly:

```json
{
  "mcpServers": {
    "panos": {
      "command": "node",
      "args": ["/absolute/path/to/mcp_servers/panos-mcp/dist/index.js"],
      "env": {
        "PANOS_HOST": "panorama.example.com",
        "PANOS_API_KEY": "your-api-key",
        "PANOS_VERIFY_TLS": "true",
        "PANOS_REST_VERSION": "v11.1"
      }
    }
  }
}
```

## Available Domains

60 tools: 58 across ten domains, plus the two always-available navigation tools.

### config
Candidate config tree. Writes land in the candidate configuration and **never** auto-commit.

Tools: `panos_config_show`, `panos_config_get`, `panos_config_complete`, `panos_config_set`, `panos_config_edit`, `panos_config_delete`, `panos_config_rename`, `panos_config_clone`, `panos_config_move`, `panos_config_override`, `panos_config_multi_move`, `panos_config_multi_clone`

### commits
Commit the candidate config, and poll job-table job IDs.

Tools: `panos_commit`, `panos_commit_all`, `panos_job_status`, `panos_job_wait`

### operations
Operational commands, plus API key minting.

Tools: `panos_op`, `panos_version`, `panos_system_info`, `panos_devices_list`, `panos_globalprotect_users`, `panos_globalprotect_disconnect`, `panos_keygen`

### logs
Two-phase log retrieval: query enqueues a job, retrieve fetches its rows.

Tools: `panos_logs_query`, `panos_logs_retrieve`

### reports
Dynamic, predefined, and custom reports, also two-phase.

Tools: `panos_report_dynamic`, `panos_report_predefined`, `panos_report_custom`, `panos_report_get`

### files
Config / certificate / packet-capture export, tech-support bundles, file and certificate import.

Tools: `panos_export`, `panos_export_tech_support`, `panos_import_file`, `panos_import_certificate`

### objects
REST object CRUD. One tool set with a `resource` enum — `Addresses`, `AddressGroups`, `Services`, `ServiceGroups`, `Tags`, `ApplicationGroups`, `ExternalDynamicLists` — because the REST paths are uniform.

Tools: `panos_objects_list`, `panos_objects_get`, `panos_objects_create`, `panos_objects_update`, `panos_objects_delete`

### policies
REST policy-rule CRUD over a `resource` enum of `SecurityRules`, `NATRules`, `DecryptionRules`, `ApplicationOverrideRules`, `AuthenticationRules`. `panos_policies_move` is the one policy tool that goes over the XML API rather than REST, because PAN-OS publishes no REST move endpoint.

Tools: `panos_policies_list`, `panos_policies_get`, `panos_policies_create`, `panos_policies_update`, `panos_policies_delete`, `panos_policies_move`

### updates
Content and PAN-OS software update lifecycle. Download and install are separate, long-running jobs; never install a version whose download job has not reported done.

Tools: `panos_updates_check`, `panos_updates_download`, `panos_updates_install`, `panos_software_check`, `panos_software_download`, `panos_software_install`, `panos_system_reboot`

### certificates
Certificate lifecycle and SSL-decryption trust assignment. The trust tools write to the candidate config only.

Tools: `panos_cert_generate`, `panos_cert_renew`, `panos_cert_revoke`, `panos_cert_export`, `panos_cert_import`, `panos_cert_set_trusted_root`, `panos_cert_set_forward_trust`

## Navigation Tools

Always available, and they run without credentials configured:

- `panos_navigate` - describe the tools in a domain (discovery aid, not a prerequisite)
- `panos_status` - credential status, resolved host, default target, TLS verification state, domain list

## Safety Signals

By effect class, which is how a client sees them: 26 read-only, 32 destructive, 1 credential-issuing (`panos_keygen`), 1 unknown-effect (`panos_op`) — 60 exactly, with nothing unclassified. Every destructive tool's description starts with `DESTRUCTIVE:` *and* carries `readOnlyHint: false`; the two come from one wrapper so prose and annotation cannot drift apart. `panos_system_reboot` and `panos_globalprotect_disconnect` additionally carry `VISIBLE-TO-OTHERS:`, because they interrupt other people's traffic.

The enforced contract is `standards/connector-safety-signals.md`, checked by `node test-mcp-tools.mjs panos` at the repo root.

## Two PAN-OS behaviors worth knowing

1. **Log and report job IDs are a separate namespace from the job table.** `panos_job_status` / `panos_job_wait` see only commits, content and software download/install, and tech-support exports. A log ID answers PAN-OS code 7 (Object not present) there — fetch it with `panos_logs_retrieve`, and a report ID with `panos_report_get`.
2. **`panos_devices_list` is Panorama-only.** A standalone firewall answers PAN-OS code 17 (Invalid command) with perfectly valid credentials. That is a topology fact, not a credential fault. The same holds for `panos_commit_all`.

## Authentication

PAN-OS authenticates with an API key that travels in the **`X-PAN-KEY` HTTP header**, never as `?key=` in the query string — a key in a URL lands in proxy logs, access logs, and shell history.

To get one:

1. Create (or reuse) an admin account with API access on the appliance
2. Set `PANOS_HOST`, `PANOS_USERNAME`, and `PANOS_PASSWORD`
3. Call `panos_keygen`, which POSTs `type=keygen` with the credentials in the request body
4. Put the returned key in `PANOS_API_KEY` yourself — the server does not persist it

The minted key is a long-lived credential and appears in the conversation transcript, so rotate it if that transcript is shared.

PAN-OS answers authorization failures, bad xpaths, and malformed elements with **HTTP 200** and `<response status="error" code="...">`. The client reads status from the parsed body, never from the transport status.

## Scripts

| Command | What it does |
|---------|--------------|
| `npm run build` | tsup build to `dist/` |
| `npm run pack:mcpb` | build the `.mcpb` bundle for Claude Desktop (`scripts/pack-mcpb.js`) |
| `npm run bundle:atlas` | build the deps-inlined atlas bundle at `plugins/atlas/mcp/panos/server.mjs` |
| `npm run test:boot` | boot probe: verifies the tool count in each credential state and the safety-signal agreement (also `npm test`) |

## Validation status

Read-only tools were validated against a live PA-460 running PAN-OS 11.1.13-h6 on 2026-09-17. Mutating tools are unexercised against hardware.

## License

Apache-2.0
