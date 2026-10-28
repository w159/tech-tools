# MCP gateway broker-mode deployment runbook

Reproduces the live cutover of `gwh-mcp-gateway` from direct mode (Entra as
the OAuth authorization server) to broker mode (the gateway is its own
OAuth 2.1 AS, federated to Entra as the upstream IdP), completed
2026-10-28. Design: `docs/architecture/enterprise-mcp-gateway.md` (D2).
Full before/after evidence and the two defects found and fixed during this
rollout: `.atlas/findings/2026-10-28_gateway-live-state.md`. This runbook
does not repeat that evidence; it is the steps to reproduce the
deployment, in order.

Scope: Azure only, this organization's existing resource group
`gwh-mcp-gateway-rg` (eastus), Container Apps environment
`gwh-mcp-gateway-env2`, registry `gwhmcpgateway`, Key Vault
`gwh-mcp-gateway-kv`. No new resource group or environment is created; this
reuses the direct-mode deployment's infrastructure in place.

## 1. Entra: plan and apply the role model

Replace the 26 flat per-vendor `<Vendor>.Read`/`<Vendor>.Write` app roles
(plus the orphaned `TypeSafe` pair) with the 6 named gateway roles (`it`,
`compliance`, `accounting`, `hr`, `planning`, `company`), and assign each
to the organization's real Entra groups rather than individuals. Do this
through the `armada-enterprise` `setup` procedure
(`plugins/armada/skills/armada-enterprise/references/setup.md`), which asks
for the group-to-role mapping one question at a time and drives Microsoft
Graph;
do not hand-edit `appRoles` with ad hoc `az rest` PATCHes (a prior
direct-mode attempt to do this disabled every role for a moment - see
"Correction on record" in `docs/architecture/mcp-gateway-design.md`).

Plan (dry run, prints the role diff and the group-to-role mapping without
writing). The admin tool is the `mcp-gateway` admin CLI, built from this
repo - there is no `armada-enterprise setup --plan` command; the
`armada-enterprise` skill (`plugins/armada/skills/armada-enterprise/references/setup.md`)
is the interactive procedure that drives exactly these commands:

```
cd mcp_servers/mcp-gateway && npm run build
node dist/admin/cli.js discover --out org-model.json --min-cell 0
node dist/admin/cli.js plan --org org-model.json --answers answers.yaml \
  --out plan.json --policy policy.yaml
```

`answers.yaml` carries the tenant id, the gateway URL, the app display name
and the role list (name, description, Entra group ids, connector grants with
effect classes); `plan` writes the desired Entra state to `plan.json` and the
gateway's own `policy.yaml`. Pin the existing registration instead of
creating a second app by putting its client id in the plan before applying:

```
jq '.appId = "<app-client-id>"' plan.json > plan.pinned.json && mv plan.pinned.json plan.json
```

Apply (writes the app roles, prunes the retired flat roles, and creates
the group assignments). The first run is a dry run - it prints every Graph
write and changes nothing:

```
node dist/admin/cli.js provision --plan plan.json --prune
node dist/admin/cli.js provision --plan plan.json --prune --apply
```

Also required on the app registration during this step, and verified live
in this cutover:

- A new client secret for the gateway's own use as an OIDC relying party
  against Entra (credential display name `mcp-gateway`), stored only in
  Key Vault (`broker-upstream-client-secret`) - never in a file in this
  repo or in `az` command history. Create it and store it in one pipe, so
  the value is never printed:

  ```
  az ad app credential reset --id <app-client-id> --append \
    --display-name mcp-gateway --years 1 --query password -o tsv \
    | az keyvault secret set --vault-name gwh-mcp-gateway-kv \
        --name broker-upstream-client-secret --file -
  ```
- Tenant-wide (`AllPrincipals`) admin consent for `openid profile
  offline_access User.Read` on Graph and the app's own `access_as_user`
  scope, so a user's first sign-in does not stall on a per-user consent
  prompt it cannot satisfy.
- Graph application permissions `Application.Read.All`,
  `GroupMember.Read.All`, and `User.Read.All` granted to the gateway's
  service principal. These back the refresh-time group-membership
  re-check (`src/broker/entra-membership.ts`); without them the token
  endpoint fails closed (this is exactly the `GW-002` defect - see the
  findings report - fixed by also falling back to the application's own
  client credentials when the managed identity's Graph token is
  unavailable, not by skipping this grant).

Verify: `GET https://graph.microsoft.com/v1.0/servicePrincipals/<sp-id>/appRoleAssignments`
lists one assignment per organization group, each `appRoleId` matching one
of the 6 roles (not any of the pruned 26); `GET .../oauth2PermissionGrants`
shows the tenant-wide consent.

## 2. Image: build and push

```
IMAGE_TAG=broker-0 \
  mcp_servers/mcp-gateway/scripts/acr-build.sh gwhmcpgateway gwh-mcp-gateway-rg <subscription-id>
```

Use this script, not a bare `az acr build <dir> .` from the repo root -
the script stages only the files the Dockerfile needs into a scratch
directory and refuses to proceed if it finds a `.env`/`.venv` path in that
staging area, which is what a prior direct-mode build without it got
wrong (see the credential-exposure incident recorded in
`docs/architecture/mcp-gateway-design.md`, Compliance notes).

Verify: `az acr repository show --name gwhmcpgateway --image mcp-gateway:broker-0 --query digest`
returns a single digest; `az acr build`'s own log shows the uploaded build
context under ~2 MiB, not hundreds of MiB.

## 3. Key Vault: secrets this mode needs

Create these in `gwh-mcp-gateway-kv` before updating the Container App.
None of them are typed by hand into a shell history entry; generate and
`az keyvault secret set --file -` each from stdin, or from the tool that
produced it.

| Secret | Source |
|---|---|
| `broker-upstream-client-secret` | The Entra app credential created in step 1 (copy once at creation time; Entra never shows it again) |
| `broker-signing-jwks` | Generated locally: `cd mcp_servers/mcp-gateway && npm run -s gen-jwks` (RS256 keypair for the gateway's own token signing) |
| `broker-cookie-keys` | Generated locally - two random keys of at least 32 characters each, comma separated, e.g. `node -e 'const c=require("crypto");console.log([c.randomBytes(36).toString("base64url"),c.randomBytes(36).toString("base64url")].join(","))'`. The gateway rejects a shorter key at startup. The repo ships no generator script for these (`package.json` has only `gen-jwks`), so generate them with any source of randomness. |
| `audit-hmac-key` | A fresh random key (e.g. `openssl rand -hex 32`) used to HMAC tool-call arguments for the audit log's `args_hmac` field, never the arguments themselves |
| `policy-yaml` | The org's `policy.yaml` (role -> connector/effect grants) written by the admin tool's `plan` step (`node dist/admin/cli.js plan ... --policy policy.yaml`); stored as a secret so it is not world-readable in the portal, mounted read-only at `/mnt/policy/policy.yaml` |

The 12 pre-existing per-vendor secrets (NinjaOne, PAN-OS, ThreatLocker,
Vanta, KnowBe4, ConnectWise, and so on) carry over unchanged from the
direct-mode deployment; this cutover does not touch them. 7 of 13
connectors (auvik, blumira, cipp, falcon, paylocity, spanning, sonicwall)
had no credentials in Key Vault at the time of this cutover and still
don't - their tools list for entitled roles but every call fails
upstream until an owner provisions and loads those secrets.

## 4. Container App: switch to broker mode

Update the revision with the broker-mode environment variables (Entra
tenant/client ID stay the same; the gateway's own issuer/audience and the
new Key Vault secret references are added), referencing the image built in
step 2 by digest, with an explicit revision suffix to force a real
rollout (`:latest`/tag-only updates are a documented no-op against a
running revision - see "Container Apps note" in
`docs/architecture/mcp-gateway-design.md`, Known limits):

```
az containerapp update \
  --name gwh-mcp-gateway --resource-group gwh-mcp-gateway-rg \
  --image gwhmcpgateway.azurecr.io/mcp-gateway@<digest-from-step-2> \
  --revision-suffix broker-0 \
  --yaml update.json
```

`update.json` is a container-app document whose `properties` carries
`configuration` and `template`. The broker-mode parts of it, as deployed:

- `properties.configuration.secrets` - one entry per secret, each with
  `name`, `keyVaultUrl`
  (`https://<vault>.vault.azure.net/secrets/<name>`) and `identity` (the
  user-assigned identity's resource id). The 12 vendor secrets stay
  exactly as they were; the 4 broker secrets from step 3 are added; the
  `policy-yaml` secret is added too, for the volume mount.
- `properties.configuration.ingress` - `external: true`, `targetPort: 8080`,
  `transport: "Auto"`, `allowInsecure: false`, and `ipSecurityRestrictions: []`.
  The direct-mode deployment carried a single `Allow` rule for Anthropic's
  egress range (`160.79.104.0/21`); emptying the list is what removes it.
  There is no `az containerapp ingress access-restriction remove` command -
  the rule list is set through the container app document.
- `properties.template.containers[0].env` - the broker-mode variables, with
  the secrets referenced by `secretRef` (not by value):

  | Variable | Value |
  |---|---|
  | `GATEWAY_MODE` | `broker` |
  | `PUBLIC_BASE_URL` | the public base URL, no trailing slash |
  | `BROKER_UPSTREAM_KIND` | `entra` |
  | `BROKER_UPSTREAM_ISSUER` | `https://login.microsoftonline.com/<tenant-id>/v2.0` |
  | `BROKER_UPSTREAM_CLIENT_ID` | the app's client id |
  | `BROKER_UPSTREAM_CLIENT_SECRET` | `secretRef: broker-upstream-client-secret` |
  | `BROKER_SIGNING_JWKS` | `secretRef: broker-signing-jwks` |
  | `BROKER_COOKIE_KEYS` | `secretRef: broker-cookie-keys` |
  | `AUDIT_HMAC_KEY` | `secretRef: audit-hmac-key` |
  | `ENTRA_MEMBERSHIP_CHECK` | `1` (fail closed) |
  | `ENTRA_TENANT_ID` | the tenant id |
  | `ENTRA_SP_OBJECT_ID` | the app's service principal object id |
  | `POLICY_FILE` | `/mnt/policy/policy.yaml` |

  The direct-mode `ENTRA_CLIENT_ID` and `MCP_RESOURCE_URL` are removed -
  in broker mode the gateway issues its own tokens and its own audience.
- `properties.template.volumes` - one secret volume named `policy` whose
  `secrets` entry is `{ secretRef: policy-yaml, path: policy.yaml }`, with
  the matching `volumeMounts` entry `policy` -> `/mnt/policy` on the
  container. `POLICY_FILE` must match that mount path.

`maxReplicas` stays pinned at `1` - broker state (authorization codes,
refresh tokens, DCR clients) lives in process memory, so more than one
replica would split that state across requests, and a restart ends every
open session. This was already true under direct mode's Blumira
workaround; broker mode makes it true for the whole app, not just one
connector.

## 5. Verify

Run each check and compare against the expected shape; do not treat a
clean `az` exit code alone as success (the direct-mode deployment's
`:latest`-tag no-op is exactly that failure mode).

```
curl -s https://gwh-mcp-gateway.delightfulpebble-1c14644e.eastus.azurecontainerapps.io/health
# expected: 200 {"status":"ok","backends":[13 connectors]}

curl -s https://gwh-mcp-gateway.delightfulpebble-1c14644e.eastus.azurecontainerapps.io/.well-known/oauth-authorization-server
# expected: issuer plus /auth, /token, /jwks, registration_endpoint (DCR),
# code_challenge_methods_supported ["S256"]

curl -s -X POST https://gwh-mcp-gateway.delightfulpebble-1c14644e.eastus.azurecontainerapps.io/mcp
# expected: 401 with
# WWW-Authenticate: Bearer resource_metadata=".../.well-known/oauth-protected-resource/mcp", scope="mcp"
```

Then a real interactive sign-in through an MCP client pointed at that base
URL: expect an Entra SSO redirect, the gateway's own consent screen, a
token issued (`Bearer`, `expires_in 900`, `scope mcp`, refresh token
present), and `tools/list` returning only the connectors the signed-in
user's role grants - zero tools from a connector not in that role's
grant list. Confirm in the audit log: `token_issued`, `tools_listed` with
the expected `tool_count`, and (for at least one read-only call)
`tool_call` with `decision: allow`. The exact counts and the two defects
found and fixed to get a clean sign-in through (consent-form CSRF origin,
token-endpoint Graph fallback) are in
`.atlas/findings/2026-10-28_gateway-live-state.md` - this runbook's job is
reproducing the deployment, not restating that evidence.

## 6. Connector credentials (2026-10-28)

This is the credential wiring for the 13 catalog connectors, loaded and
verified live after the broker-mode cutover above. It does not repeat the
4 broker secrets from step 3; those are unrelated to the per-vendor
credentials here.

### Where each value lives

`gwh-mcp-gateway-kv` (resource group `gwh-mcp-gateway-rg`, subscription
`d10ed4e7-8973-4fb6-aa90-1d31b8be10b3`) holds 29 vendor secrets, named
lowercase-hyphen after the env var they feed - `auvik-username`,
`auvik-region`, `cw-manage-company-id`, `cw-manage-public-key`,
`cw-manage-private-key`, `cw-manage-client-id`, `cw-manage-url`,
`falcon-client-id`, `falcon-client-secret`, `falcon-base-url`,
`knowbe4-api-key`, `knowbe4-region`, `ninjaone-client-id`,
`ninjaone-client-secret`, `ninjaone-region`, `panos-host`, `panos-api-key`,
`panos-verify-tls`, `paylocity-client-id`, `paylocity-client-secret`,
`paylocity-company-id`, `spanning-admin-email`, `spanning-platform`,
`spanning-api-url`, `threatlocker-api-key`, `threatlocker-organization-id`,
`threatlocker-base-url`, `vanta-client-id`, `vanta-client-secret` - plus the
pre-existing broker secrets from step 3.

Each is wired to the container as a Key Vault reference, not a copy: the
container app secret points at the vault secret by URI and reads it
through the user-assigned identity `gwh-mcp-gateway-id`, which holds
**Key Vault Secrets User** on the vault. That split matters operationally:
rotating a value in the vault needs no container app update, only a new
revision so the container re-reads the mounted secret.

The connector env vars on the container are UPPER_CASE and point at those
secrets with `secretRef`: `AUVIK_USERNAME`, `AUVIK_REGION`,
`CW_MANAGE_COMPANY_ID`, `CW_MANAGE_CLIENT_ID`, `FALCON_CLIENT_ID`,
`FALCON_CLIENT_SECRET`, `FALCON_BASE_URL`, `KNOWBE4_REGION`,
`NINJAONE_REGION`, `PAYLOCITY_CLIENT_ID`, `PAYLOCITY_CLIENT_SECRET`,
`PAYLOCITY_COMPANY_ID`, `SPANNING_ADMIN_EMAIL`, `SPANNING_PLATFORM`,
`SPANNING_API_URL`, `THREATLOCKER_ORGANIZATION_ID`,
`THREATLOCKER_BASE_URL`, plus the pre-existing `KNOWBE4_API_KEY`,
`NINJAONE_CLIENT_ID`/`NINJAONE_CLIENT_SECRET`,
`PANOS_HOST`/`PANOS_API_KEY`/`PANOS_VERIFY_TLS`, `THREATLOCKER_API_KEY`,
`VANTA_CLIENT_ID`/`VANTA_CLIENT_SECRET`,
`CW_MANAGE_URL`/`CW_MANAGE_PUBLIC_KEY`/`CW_MANAGE_PRIVATE_KEY`.

### The prefix rule, and its lowercase-name trap

The gateway forwards env to each vendor MCP server by prefix only
(`mcp_servers/mcp-gateway/src/backends.ts`: `ALLOWED_COMMON_ENV` plus each
connector's `envPrefixes` from `catalog/catalog.json`, checked at
`childEnv()` with `spec.envPrefixes.some((p) => key.startsWith(p))`). A
connector therefore never sees another vendor's secrets, and an env var
name must match the vendor's prefix **exactly**, including case. A
lowercase name such as `falcon-client-secret` passed as an env var is
silently dropped by the `FALCON_` prefix check - no error, the connector
just starts unauthenticated. This was a real defect hit during this work;
the fix is always an UPPER_CASE env var name on the container, pointing at
the (lowercase-named) Key Vault secret via `secretRef`.

### Local sources of the values before they were centralized

`~/.config/atlas/atlas.env` (the per-user file every local MCP server
reads), `plugins/atlas/.env`, `~/.claude/settings.json`
`pluginConfigs[atlas@tech-tools].options`, `~/.zshrc` (Falcon),
`~/MEGA/Projects/Development/paylocity-api/.env`, and the `agent-penny-kv`
vault (ConnectWise client id and company id).

### Adding or rotating one connector credential

Read the current value's metadata only (never print the value to a
terminal or into a file):

```
az keyvault secret show --vault-name gwh-mcp-gateway-kv --name <secret-name> \
  --query "{name:name, updated:attributes.updated, enabled:attributes.enabled}"
```

Rotate: write the new value straight from its source into the vault in one
pipe, then point the container secret at the vault (idempotent - safe to
re-run against an existing reference) and roll a new revision so the
running container re-reads it:

```
<command producing the new value> | az keyvault secret set \
  --vault-name gwh-mcp-gateway-kv --name <secret-name> --file -

az containerapp secret set -g gwh-mcp-gateway-rg -n gwh-mcp-gateway \
  --secrets "<secret-name>=keyvaultref:https://gwh-mcp-gateway-kv.vault.azure.net/secrets/<secret-name>,identityref:/subscriptions/d10ed4e7-8973-4fb6-aa90-1d31b8be10b3/resourceGroups/gwh-mcp-gateway-rg/providers/Microsoft.ManagedIdentity/userAssignedIdentities/gwh-mcp-gateway-id"

az containerapp update -g gwh-mcp-gateway-rg -n gwh-mcp-gateway \
  --revision-suffix <new-suffix>
```

Add a brand-new connector credential the same way, then add the matching
UPPER_CASE `env` entry with `secretRef: <secret-name>` to
`properties.template.containers[0].env` in the container app update
document (step 4 above) before rolling the revision - a secret with no
matching env entry is loaded but never reaches the connector.

### Live per-connector verification (2026-10-28)

A real interactive Entra sign-in against the live gateway (same shape as
step 5's verification) returned **384 tools** across the 13 connectors -
falcon 145, connectwise 49, ninjaone 45, auvik 39, threatlocker 30,
knowbe4 30, vanta 28, spanning 13, sonicwall 2, blumira 2, cipp 1,
panos 0, paylocity 0. `paylocity` is granted only to the `hr` role and
the signed-in user holds `company`/`it`, so 0 tools is the role model
working, not a fault; `panos` is 0 because its grant was removed from the
published policy (see the decision below). Per-connector authenticated
status, called through the gateway: `falcon`, `connectwise`, `ninjaone`,
`auvik` ("authCheck: OK (HTTP 200)"), `spanning` ("Auth check: OK (HTTP
200)") and `threatlocker` ("Auth check: OK (authenticated)") all
authenticated, the first three returning real data. `knowbe4` and `vanta`
are still rejected by the vendor; `blumira`, `cipp` and `sonicwall` still
report no credential configured. Full status table and audit lines:
`.atlas/evidence/2026-10-28-mcp-gateway-credentials.md`.

Two things that look like gateway faults but are not:

- **Dynamic client registrations do not survive a revision roll.** A client
  that registered before the roll is answered with `invalid_client`; it has
  to register again. Re-register after every rollout before concluding the
  sign-in is broken.
- **An authorize request without a `scope` is answered with
  `access_denied`** and an empty description. Send `scope=mcp
  offline_access`.

### Decisions taken by the user (2026-10-28)

- **PAN-OS stays local-only.** The appliance is on the corporate VPN and
  no tunnel or Azure VPN is being built, so the gateway should not offer
  it. **Done (2026-10-28, later the same day):** `panos` was removed from
  the `it` role's connector list in the **input** file for the admin
  tool's `plan` step (the role/connector mapping in the org's real
  `answers.yaml`, analogous to
  `mcp_servers/mcp-gateway/src/admin/fixtures/answers.yaml` - that
  tracked file is a Contoso test fixture, **not** the input that produced
  the live policy), `node dist/admin/cli.js plan --org org-model.json
  --answers <org-answers.yaml> --out plan.json --policy policy.yaml` was
  re-run, and the regenerated `policy.yaml` - byte-identical to the
  published one except for the single `panos` line - was stored as the
  `policy-yaml` Key Vault secret and rolled into a new revision. Do
  **not** hand-edit the `policy-yaml` secret or the mounted
  `/mnt/policy/policy.yaml` directly - it is generated output, not a
  source file. The `panos-*` secrets stay in the vault (harmless: the
  policy, not the vault, decides what a caller may reach).
- **No custom domain.** Users connect to the container app's default
  `azurecontainerapps.io` hostname. henssler.com's DNS is served by
  `dcs-001`/`dcs-002`/`dcs-azure.henssler.com`, which is not in any of the
  three Azure subscriptions reachable from here, so `mcp.henssler.com`
  cannot be created from this machine.

### Resolved blocker: the operator account was risk-blocked in Entra

For part of 2026-10-28 every Azure CLI call for
`da-jmorgan@henssler.com` failed with:

```
AADSTS530032: User blocked due to risk on home tenant.
```

Reproduce with any authenticated call, e.g. `az account show`. It blocked
publishing a new policy, rotating Key Vault secrets, and rolling the
container app - it is an Entra Identity Protection risk block on the
account, not a gateway defect. It cleared when the operator completed an
interactive device-code sign-in (`az login --use-device-code`); a cached
Graph token stays rejected with `TokenIssuedBeforeRevocationTimestamp`
until that sign-in refreshes it. Everything above was completed after the
block cleared.

### Connector credentials still unusable

Five of the 13 connectors are still unusable and were deliberately left
as-is pending a fresh credential from the vendor: `knowbe4` and `vanta`
have a stored value the vendor rejects (401), and `blumira`, `cipp` and
`sonicwall` have no value stored anywhere. Role grants for all five stay
in place, so each one starts working through the gateway the moment a
valid credential is stored - no policy or env change is needed beyond the
credential rotation steps above.

### The CIPP connector is a remote MCP server (2026-10-28)

The plugin's CIPP connector is no longer a bundled stdio server: it is the CIPP instance's own MCP
endpoint, configured with the instance URL (`cipp_mcp_url`, e.g.
`https://cipp.example.com/api/ExecMcp`) and the app registration's OAuth client id
(`cipp_client_id`, written as `oauth.clientId` so Claude Code signs in with that registration
instead of dynamic client registration; the client-id path was not exercised against a live
instance), and CIPP handles the OAuth sign-in for each user. The
gateway's CIPP backend is unchanged (the bundled `cipp-mcp` server over the CIPP REST API) and
`catalog/overrides.json` keeps the gateway's launch line for it, so the generated catalog is
unchanged.

Two things the instance's discovery metadata does not get right, for any client that talks to
`/api/ExecMcp` directly:

- Request `scope=openid profile offline_access https://<host>/user_impersonation` and send **no**
  `resource` parameter. Sending the `resource` value the protected-resource metadata advertises
  makes Entra answer `AADSTS9010010: The resource parameter provided in the request doesn't match
  with the requested scopes`.
- Register the loopback redirect as `http://localhost:<port>/callback`. Registering
  `http://127.0.0.1:<port>/callback` is rejected with `AADSTS50011: The redirect URI ... does not
  match the redirect URIs configured for the application`.

Dynamic client registration works without any client id or secret: `POST /api/PublicMcpRegister`
answers 201 with `token_endpoint_auth_method: none`.

## Not covered by this runbook

- Binding the `mcp.henssler.com` custom domain and its certificate - still
  open; see "Still open" in `.atlas/findings/2026-10-28_gateway-live-state.md`
  and the Network section of `docs/architecture/mcp-gateway-design.md`
  (historical, but the DNS/certificate prerequisites it describes have not
  changed).
- Loading credentials for the 7 connectors with none in Key Vault.
- Adding the gateway as a connector inside Claude's own admin UI.
