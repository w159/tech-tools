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

## Not covered by this runbook

- Binding the `mcp.henssler.com` custom domain and its certificate - still
  open; see "Still open" in `.atlas/findings/2026-10-28_gateway-live-state.md`
  and the Network section of `docs/architecture/mcp-gateway-design.md`
  (historical, but the DNS/certificate prerequisites it describes have not
  changed).
- Loading credentials for the 7 connectors with none in Key Vault.
- Adding the gateway as a connector inside Claude's own admin UI.
