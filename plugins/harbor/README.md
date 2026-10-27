# harbor

Admin side of the enterprise MCP gateway in `mcp_servers/mcp-gateway`. Harbor
deploys the gateway into your own Azure or Google Cloud account, manages the
access policy that decides who can call which tools, and reads the audit log.

The gateway sits between Claude and the vendor MCP connectors in the catalog
(`mcp_servers/mcp-gateway/catalog/catalog.json`). Users sign in through your
identity provider. Every tool call is checked against `policy.yaml` and written
to an audit log.

## What is in the plugin

| Path | Purpose |
|---|---|
| `skills/harbor-setup` | Choose cloud and identity provider, generate `policy.yaml`, register the IdP client, build the image from a staged context, deploy |
| `skills/harbor-policy` | Edit grants, validate, print the who-can-call-what matrix, diff, roll out on yes |
| `skills/harbor-audit` | Run the saved queries and summarize five insights |
| `skills/harbor-connect` | Gateway URL, custom connector steps, Enterprise Managed Auth |
| `agents/harbor-admin.md` | Runs the skills; read-only by default |
| `templates/policy.example.yaml` | Example policy, checked against the gateway's `parsePolicy` |
| `infra/azure/` | Bicep: Container Apps, Key Vault, Log Analytics, managed identity |
| `infra/gcp/` | Terraform: Cloud Run v2, Secret Manager, service account |
| `queries/azure/*.kql`, `queries/gcp/*.txt` | The five audit insights |

## Prerequisites

- An Azure subscription or a Google Cloud project where you can create
  resources and role assignments, and an existing container registry
  (Azure Container Registry or Artifact Registry).
- An identity provider: Microsoft Entra ID, Google Workspace, or another OpenID
  Connect provider, and permission to register an application or OAuth client.
- Tools: Azure CLI and Bicep, or Google Cloud CLI and Terraform 1.5 or later;
  Node.js 22 or later, `openssl`, `uuidgen`, `jq`.
- Credentials for each vendor connector you enable. They are stored in Key
  Vault or Secret Manager, never in files.

## Run order

1. `harbor-setup` - plan, billable resources listed, your yes, then two passes
   (infrastructure, then secrets and image, then the app).
2. `harbor-connect` - add the gateway as a Claude custom connector.
3. `harbor-policy` - adjust access as roles change.
4. `harbor-audit` - review on a schedule, for example weekly.

Nothing is created in your cloud account until you answer yes to a plan that
names every billable resource.

## Cost notes

The gateway runs one replica at all times, so it costs money while idle.

- Azure: Container App (vCPU and memory seconds, always on), Log Analytics
  (per GB ingested), Key Vault (per operation), optional Cosmos DB serverless
  (per request unit and storage). The container registry is existing and billed
  separately; image builds add build time.
- Google Cloud: Cloud Run with instance-based billing and one instance
  allocated, Secret Manager (per version and access), Cloud Logging (ingestion
  past the free allotment), optional Firestore (operations and storage),
  Artifact Registry storage and Cloud Build minutes.

Check current prices for your region before approving a plan.

## Security model

- Sign-in: users authenticate with your identity provider. The gateway never
  sees passwords.
- Default deny: with no matching grant a tool call is refused. A tool with no
  annotations is treated as destructive. A `deny_tools` match beats every allow.
- Policy: `policy.yaml` maps identity claims to roles and roles to connectors
  and effect classes (read, write, destructive). It is validated strictly at
  startup; an unknown key or connector stops the gateway.
- Secrets: kept in Key Vault or Secret Manager and injected at runtime through
  the workload identity. No secret value is in the templates, parameter files,
  images or this plugin. Build contexts are staged so `.env` files never reach
  the build service.
- Audit: one JSON line per event with schema `mcp-gw.audit/1`: `ts`,
  `request_id`, `event`, `actor.sub`, `actor.email`, `actor.idp`,
  `actor.tenant`, `client_id`, `roles`, `connector`, `tool`, `effect`,
  `decision`, `reason`, `outcome`, `duration_ms`, `args_hmac`. Tool arguments,
  tool results and tokens are never logged. `args_hmac` is a keyed hash of the
  arguments, keyed with a secret from the vault.

## Limits

- Single replica. The authorization server keeps sessions, codes and refresh
  tokens in memory, so scaling above one replica breaks sign-in. The templates
  pin min and max to 1 until a persistent state adapter ships. The optional
  Cosmos DB and Firestore resources are created for that adapter but nothing
  uses them yet.
- Client ID Metadata Documents (CIMD) support in the `oidc-provider` library is
  experimental.
- Which identity providers can issue the assertions Enterprise Managed Auth
  needs is not verified. Check before promising it.
- Broker mode ships in gateway 0.2.0. The `BROKER_*` names in the templates
  match `mcp_servers/mcp-gateway/src/config.ts`; re-check them when you move to
  a newer gateway version.
- Policy changes need a restart of the service to load.
- Logs: `harbor-audit` reads the cloud log store. The gateway's
  `gateway_audit_search` tool only covers recent events of one process.

## Gateway facts used by the skills

- OIDC callback registered with the identity provider:
  `<PUBLIC_BASE_URL>/interaction/callback`.
- `BROKER_SIGNING_JWKS` holds RS256 keys; generate with
  `npm run -s gen-jwks` in `mcp_servers/mcp-gateway`.
- The image contains `catalog/catalog.json`.
