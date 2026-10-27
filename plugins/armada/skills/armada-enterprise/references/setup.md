# Set up the gateway for an organization (Azure)

Drives the admin tool in `mcp_servers/mcp-gateway/src/admin` (built to `dist/admin/cli.js`) and the Bicep template `${CLAUDE_PLUGIN_ROOT}/enterprise/infra/azure/main.bicep`. The admin tool turns the directory into an Entra app registration with app roles and group assignments, and generates the gateway `policy.yaml`. After setup, the user experience is: Customize > Connectors > Connect, a Microsoft sign-in and MFA, no consent prompt.

This procedure is interactive. Ask the admin one question at a time and wait for each answer. Do not ask for anything you can read from the org model or the Azure CLI.

## Hard rules

1. Dry run first. `provision` without `--apply` prints the Graph writes it would make. Show that output, then ask: "Apply these changes? Reply yes." Run `--apply` only after an explicit yes in the admin's own words. A yes covers the plan shown; if `answers.yaml` or the plan changes, show it again.
2. Before asking for the infrastructure yes, name every billable resource (below) and say that the gateway costs money, including while idle.
3. Never print, echo, log or store a secret. Never ask for one in chat. Secrets go to Key Vault through a hidden prompt or a temp file deleted immediately.
4. Never put a `.env` file in an image build context.
5. No real tenant ids, hosts, group ids or organization names in tracked files. `org-model.json`, `answers.yaml` and `plan.json` stay in the admin's working directory outside the repo.

## Step 0: prerequisites

Check, do not install: `az version`, `bicep --version` or `az bicep version`, `node -v` (22 or later), `uuidgen`, `openssl`. Report what is missing and stop on it.

Role needed to apply: Privileged Role Administrator or Global Administrator. Cloud Application Administrator can create the app and assign groups but cannot grant Microsoft Graph application permissions, which `provision` does (Step 7). Discovery is read-only.

Licensing: assigning groups to app roles needs Microsoft Entra ID P1 or P2. Without it the group assignment writes fail; assign users individually in the portal instead. Nested groups are not supported for assignment, so use leaf groups. Also needed for infrastructure: rights to create resources and role assignments in the target subscription, and an existing Azure Container Registry.

Build the admin tool:

```bash
cd mcp_servers/mcp-gateway && npm run build
```

## Step 1: tenant

Ask: "Which tenant? Give the tenant id, or say current to use the signed-in Azure CLI account." For current, run `az account show --query "{sub:id,tenant:tenantId}" -o json` and show the result; ask the admin to confirm it is the intended target.

Token for Graph: the tool reads `GRAPH_TOKEN` from the environment, or falls back to `az account get-access-token --resource-type ms-graph`. Do not print the token.

## Step 2: discover

Read-only.

```bash
cd mcp_servers/mcp-gateway
node dist/admin/cli.js discover --out org-model.json
```

Read `org-model.json` and summarize it for the admin from what is actually in the file: departments, companies, and groups, with member counts where present. Do not assume field names; inspect the file. Report what the tool printed if it fails (a 403 means the signed-in account lacks directory read rights).

## Step 3: gateway URL

Ask: "What is the public gateway URL (https, no trailing slash)?" If none yet, it is the generated Container Apps host, `https://<prefix>-gateway.<environment default domain>`, or the custom domain they will bind. The app registration's redirect URI is built from it, so a later change means rerunning the plan.

## Step 4: roles

Repeat for each role until the admin says no more roles, one question at a time:

1. Role name (lowercase, no spaces, for example `it-ops`). It becomes the Entra app role value and the gateway role. Letters, digits and a small set of punctuation, at most 120 characters.
2. Which departments, companies or groups from the discovered org model map to it. Show the matching groups and their member counts. Use leaf groups only: app roles do not flow through nested groups, so if the admin names a group that contains groups, list its leaf groups and confirm those.
3. Which connectors (ids from `mcp_servers/mcp-gateway/catalog/catalog.json`) and which effects (`read`, `write`, `destructive`) it gets. Several grants per role are allowed. Recommend `read` and `write` without `destructive`. Ask whether any tools should be denied (`deny_tools` globs such as `*delete*`).
4. A short description for the role.

Then ask the sign-in interval: "How many hours before users sign in again? Default 8." Advise matching the tenant's Conditional Access sign-in frequency so the two do not fight.

Ask for the app display name (for example `MCP Gateway`).

## Step 5: answers.yaml

Write it in the working directory. Schema:

```yaml
version: 1
tenantId: <guid>
gatewayUrl: https://<host>
appName: <display name>
refreshHours: 8
roles:
  - name: it-ops            # becomes the app role value and gateway role
    description: ...
    groups: [<group object id>, ...]   # leaf groups; app roles do not flow through nested groups
    grants:
      - connectors: [ninjaone, connectwise]
        effects: [read, write]
        deny_tools: []      # optional
```

Show the file to the admin and confirm.

## Step 6: plan

```bash
node dist/admin/cli.js plan --org org-model.json --answers answers.yaml --out plan.json --policy policy.yaml
```

Show the plan: the app, each role and its groups, each connector grant. Validate the generated `policy.yaml` with the gateway's `parsePolicy` (throwaway script outside the repo). If it fails, fix `answers.yaml` and replan; do not continue with an invalid policy. Show the admin the final `policy.yaml`.

## Step 7: dry run, then apply

```bash
node dist/admin/cli.js provision --plan plan.json
```

Show the output verbatim: these are the Graph writes it would make. Besides the app, roles, group assignments and delegated consent (`openid profile offline_access User.Read`), it lists three Graph application permissions, `Application.Read.All`, `GroupMember.Read.All` and `User.Read.All`, granted to the gateway service principal. The refresh-time membership check (`ENTRA_MEMBERSHIP_CHECK=1`) needs them to re-resolve roles on every refresh, so disabling a user or removing a group stops access at the next refresh. They are read-only directory permissions across the tenant; say so when asking for the yes. Ask: "Apply these changes? Reply yes." Only after a clear yes:

```bash
node dist/admin/cli.js provision --plan plan.json --apply
```

Report what the tool printed. Rerun the same `--apply` after a few minutes if a write fails right after the service principal or app role was created (directory replication lag); it is idempotent and resumes where it stopped, and a clean rerun prints "nothing to do".

Managed identity option: the membership check can authenticate as the Container App's managed identity instead of the app's client secret. After pass 2 of Step 9 the deployment output `gatewayPrincipalId` holds its object id; grant the same three permissions to it:

```bash
node dist/admin/cli.js provision --plan plan.json --apply --managed-identity-principal-id <gatewayPrincipalId>
```

Show the dry run (same command without `--apply`) and get a yes first. Container Apps then sets `IDENTITY_ENDPOINT` and `IDENTITY_HEADER` and the gateway uses the identity. Set `ENTRA_MANAGED_IDENTITY_CLIENT_ID` only to pick a user-assigned identity. Without a managed identity the check uses the client secret.

If it needs a client secret, create it in the Entra portal (App registrations > Certificates and secrets); the admin pastes it once into the hidden prompt in Step 9, never into chat.

## Step 8: infrastructure plan (Azure)

Stage the build context. Never run `az acr build` on the repo root; it uploads the monorepo, including any `.env`.

```bash
REPO=<repo root>
GW="$REPO/mcp_servers/mcp-gateway"
STAGE=$(mktemp -d)
mkdir -p "$STAGE/mcp_servers/mcp-gateway" "$STAGE/plugins/armada"
cp "$GW/Dockerfile" "$GW/package.json" "$GW/package-lock.json" "$GW/tsconfig.json" "$STAGE/mcp_servers/mcp-gateway/"
cp -R "$GW/src" "$STAGE/mcp_servers/mcp-gateway/src"
cp -R "$GW/catalog" "$STAGE/mcp_servers/mcp-gateway/catalog"
cp -R "$REPO/plugins/armada/mcp" "$STAGE/plugins/armada/mcp"
rm -rf "$STAGE/plugins/armada/mcp/falcon/.venv" "$STAGE/plugins/armada/mcp/falcon/.venv.nosync.noindex"
find "$STAGE" \( -name ".env" -o -name ".env.*" \) -delete
find "$STAGE" \( -name ".env" -o -name ".env.*" -o -name "*.pem" -o -name "*.key" \) -print
```

The final `find` must print nothing.

Copy `${CLAUDE_PLUGIN_ROOT}/enterprise/infra/azure` to a working directory. Fill `main.bicepparam` (`deployApp = false` for pass 1). Put the non-secret `gatewayEnv` block of `plan.json` into the `extraEnv` parameter, one `{ name, value }` item per variable: `GATEWAY_MODE`, `PUBLIC_BASE_URL`, `BROKER_UPSTREAM_KIND`, `BROKER_UPSTREAM_ISSUER` (`https://login.microsoftonline.com/<tenantId>/v2.0`), `BROKER_REFRESH_TOKEN_TTL` and `ENTRA_MEMBERSHIP_CHECK`. Add `BROKER_UPSTREAM_CLIENT_ID` (the app id the provision step printed) and optionally `TOKEN_CLOCK_TOLERANCE_SECONDS` (default 5). A name in `extraEnv` replaces the template's built-in of the same name, so `GATEWAY_MODE` and `PUBLIC_BASE_URL` can be listed without a duplicate. Optional membership settings (`ENTRA_MEMBERSHIP_CACHE_SECONDS`, `ENTRA_MEMBERSHIP_FAIL_OPEN`, `ENTRA_SP_OBJECT_ID`) are listed in the gateway README. Ask the admin for the resource group, region, name prefix and registry name, one at a time. Then:

```bash
bicep build main.bicep --stdout > /dev/null && bicep lint main.bicep
az deployment group what-if -g <rg> --parameters main.bicepparam
```

Billable resources (pass 1):

| Resource | Billing |
|---|---|
| Log Analytics workspace | per GB ingested, plus retention beyond the free period |
| Container Apps environment | no standalone charge on the Consumption profile; apps inside it bill |
| Key Vault (standard) | per operation, small |
| Cosmos DB account (only if `enableCosmos`) | serverless: per request unit and per GB stored |

Free: managed identities (the user-assigned one for registry and Key Vault, the Container App's system-assigned one for Graph) and role assignments. Pass 2 adds the Container App, billed per vCPU-second and GiB-second; with one replica always running it costs money while idle. The existing registry is billed separately and `az acr build` adds build time.

Ask: "This creates billable resources and will cost money, including while idle. Reply yes to create these." and list the exact commands in order. Wait for a clear yes.

## Step 9: apply infrastructure, in two passes

Pass 1: `az deployment group create -g <rg> --parameters main.bicepparam`.

Secrets: names are in the deployment output `requiredSecretNames`. For each the admin types the value at a hidden prompt:

```bash
read -rs -p "value: " V; echo
T=$(mktemp); chmod 600 "$T"; printf '%s' "$V" > "$T"; unset V
az keyvault secret set --vault-name <vault> --name <secret-name> --file "$T" --encoding utf-8 >/dev/null
rm -f "$T"
```

Generated secrets need no prompt: `audit-hmac-key` (`openssl rand -base64 48`), `broker-cookie-keys` (comma-separated random strings of at least 32 characters, two allow rotation), `broker-signing-jwks` (`npm run -s gen-jwks` in `mcp_servers/mcp-gateway`, piped into the store without printing). `policy-yaml` is the validated `policy.yaml` (`--file policy.yaml`). Verify names without reading values: `az keyvault secret list --vault-name <vault> --query "[].name" -o tsv`.

Build and push: `az acr build --registry <registry> --image mcp-gateway:<tag> --file mcp_servers/mcp-gateway/Dockerfile "$STAGE"`. Then pass 2: set `deployApp = true`, rerun what-if, show the delta, and get a fresh yes if it adds anything not already approved. Read `gatewayPrincipalId` from the deployment outputs (`az deployment group show -g <rg> -n <deployment> --query properties.outputs.gatewayPrincipalId.value -o tsv`) if the managed identity option is used.

## Step 10: verify

- `curl -sS -o /dev/null -w "%{http_code}\n" <base>/mcp` returns 401.
- `curl -sS <base>/.well-known/oauth-protected-resource` returns JSON whose `resource` is `<base>/mcp`.
- `az containerapp logs show -g <rg> -n <prefix>-gateway --tail 50` shows the service started. A startup error about `POLICY_FILE` means the policy secret did not mount or failed validation.

Finish by pointing the admin at `connect.md`.

## Changing the group mapping later

Edit `answers.yaml`, rerun `plan` and the dry-run `provision`, show the output, apply on a yes, then roll out the regenerated `policy.yaml` as in `policy.md`. Users sign out and in again to pick up a group change.
