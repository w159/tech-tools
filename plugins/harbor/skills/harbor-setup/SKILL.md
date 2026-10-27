---
name: harbor-setup
description: 'Deploys the enterprise MCP gateway into an organization''s Azure or Google Cloud account. Picks the cloud and identity provider, generates policy.yaml from the connector catalog, registers the identity provider client, builds the image from a staged context, and deploys. Shows the plan first and creates nothing until the admin says yes.'
when_to_use: first-time deployment of the gateway, redeploying after an infra or image change, or rotating the identity provider client
allowed-tools: Read, Write, Edit, Glob, Grep, Bash
argument-hint: '[azure|gcp] [entra|google|oidc]'
---

# harbor-setup

Deploys `mcp_servers/mcp-gateway` into the admin's own cloud account.

## Hard rules

1. Show the plan first (`az deployment group what-if` or `terraform plan`) and
   wait for the admin's explicit yes before creating any cloud resource. "Looks
   fine" or silence is not a yes. A yes covers the plan shown; if anything
   changes, show it again.
2. Before asking for the yes, name every billable resource (lists below) and
   say plainly that running the gateway costs money, including while idle,
   because one replica always runs.
3. Never print, echo, log or store a secret. Never ask for one in the chat.
   Secrets go to Key Vault (Azure) or Secret Manager (Google Cloud) only, via a
   prompt or a temp file that is deleted immediately.
4. Never put a `.env` file in an image build context.
5. No hard-coded subscription, tenant, project, registry or organization names
   in anything you write into the repository. Use parameters and
   `example.com`.
6. Commands that create or change cloud state run only after the yes in rule 1:
   `az deployment group create`, `az acr build`, `az keyvault secret set`,
   `az ad app create`, `terraform apply`, `gcloud secrets ...`,
   `gcloud builds submit`.

## Step 0: tools

Check, do not install: `az version` or `gcloud version`, `terraform version`
(Google Cloud), `bicep --version` or `az bicep version` (Azure), `node -v`
(22 or later), `uuidgen`, `openssl`. Report what is missing and stop on it.
Confirm the admin is logged in: `az account show --query "{sub:id,tenant:tenantId}" -o json`
or `gcloud config get-value project`. Show the admin the subscription or
project and ask them to confirm it is the intended target.

## Step 1: choices

Ask once, in one message, for anything not given as an argument:

- Cloud: `azure` or `gcp`.
- Identity provider: `entra` (Microsoft Entra ID), `google` (Google
  Workspace), or `oidc` (any other OpenID Connect provider).
- Gateway mode: `broker` (the gateway signs users in through the provider and
  issues its own tokens; works for all three providers) or `direct` (Entra or
  a generic OIDC provider issues tokens and the gateway only validates them).
  Recommend `broker`.
- Resource group or project, region, name prefix, and an existing container
  registry (Azure: registry name; Google Cloud: Artifact Registry repository).
- Which connectors to enable (default: all catalog entries).

## Step 2: policy.yaml

Source of truth for connector ids:
`mcp_servers/mcp-gateway/catalog/catalog.json` (`connectors[].id`).

1. List the ids: `python3 -c "import json;print(*[c['id'] for c in json.load(open('mcp_servers/mcp-gateway/catalog/catalog.json'))['connectors']])"`.
2. Copy `${CLAUDE_PLUGIN_ROOT}/templates/policy.example.yaml` to the working
   directory as `policy.yaml`. Ask the admin which roles they want and which
   claim values their identity provider sends (Entra: app role values in the
   `roles` claim; Google: groups resolved at sign-in; other OIDC: the claim
   name their provider uses). Edit subjects and grants to match. Default deny:
   a connector with no grant is unreachable.
3. Validate with the gateway's own parser (read-only):
   write a throwaway script outside the repo that imports `parsePolicy` from
   the gateway source and runs it on `policy.yaml` with the catalog ids, or run
   the gateway's tests. If validation fails, fix the file; do not proceed with
   an invalid policy.
4. Show the admin the final file.

## Step 3: identity provider client

Collect the public base URL first. Before the first deploy it is the generated
host name (Azure: `https://<prefix>-gateway.<env default domain>`; Google
Cloud: `https://<prefix>-gateway-<project number>.<region>.run.app`) or the
custom domain the admin will bind. The `gatewayBaseUrl` output of the infra
templates prints the value in use.

### Entra

App roles come from the policy: every `subjects` rule with `claim: roles`
becomes one app role whose `value` is the rule's `equals`.

```bash
python3 - <<'PY' > approles.json
import json, subprocess, re
# subjects parsed from policy.yaml with a YAML loader; shown here as a list.
import yaml
doc = yaml.safe_load(open("policy.yaml"))
seen, roles = set(), []
for s in doc["subjects"]:
    if s["when"]["claim"] != "roles" or s["when"]["equals"] in seen:
        continue
    seen.add(s["when"]["equals"])
    roles.append({
        "allowedMemberTypes": ["User"],
        "description": "Gateway role " + s["role"],
        "displayName": s["role"],
        "id": subprocess.check_output(["uuidgen"], text=True).strip(),
        "isEnabled": True,
        "value": s["when"]["equals"],
    })
print(json.dumps(roles, indent=2))
PY
```

The Entra role `value` allows letters, digits and a small set of punctuation,
no spaces, at most 120 characters (Microsoft Graph appRole reference).

Show `approles.json` to the admin. After the yes in Step 7:

```bash
az ad app create --display-name "MCP Gateway" \
  --sign-in-audience AzureADMyOrg \
  --web-redirect-uris "<PUBLIC_BASE_URL>/interaction/callback" \
  --app-roles @approles.json
```

The callback is `<PUBLIC_BASE_URL>/interaction/callback`, where `PUBLIC_BASE_URL` is
the gateway's public origin with no trailing slash (for example
`https://mcp.example.com/interaction/callback`). Register exactly that value;
the gateway builds it from `PUBLIC_BASE_URL`, never from the request Host header. Then create the service principal (`az ad sp create --id <appId>`),
require assignment, and assign users or groups to the roles in the Entra
portal or with Microsoft Graph. Create a client secret in the Entra portal (App registrations > Certificates
and secrets). The admin copies it once into the hidden prompt in Step 7; it is
never pasted into the chat or written to a file in the repository.

### Google

Google Cloud console > APIs and Services > Credentials > Create credentials >
OAuth client ID > Web application. Authorized redirect URI: the gateway
callback URI. The admin does this in the console; there is no safe way to
script the consent screen. Ask for the client id (not secret) in chat. Roles
come from Google groups; set `GOOGLE_GROUPS_LOOKUP=1` through the infra
`extra_env` only if the admin wants group-based roles, and note it needs the
Admin SDK directory scope.

### Generic OIDC

Register a confidential client at the provider with the gateway callback URI.
Collect the issuer URL and client id in chat (not secret). The client secret
goes to the vault.

## Step 4: stage the build context and build the image

Never run `az acr build` or `gcloud builds submit` on the repo root. It
uploads the whole monorepo, including any `.env` file. Stage only what the
gateway Dockerfile copies:

```bash
REPO=<repo root>
GW="$REPO/mcp_servers/mcp-gateway"
STAGE=$(mktemp -d)
mkdir -p "$STAGE/mcp_servers/mcp-gateway" "$STAGE/plugins/armada"
cp "$GW/Dockerfile" "$GW/package.json" "$GW/package-lock.json" "$GW/tsconfig.json" "$STAGE/mcp_servers/mcp-gateway/"
cp -R "$GW/src" "$STAGE/mcp_servers/mcp-gateway/src"
cp -R "$REPO/plugins/armada/mcp" "$STAGE/plugins/armada/mcp"
rm -rf "$STAGE/plugins/armada/mcp/falcon/.venv" "$STAGE/plugins/armada/mcp/falcon/.venv.nosync.noindex"
find "$STAGE" \( -name ".env" -o -name ".env.*" \) -delete
find "$STAGE" \( -name ".env" -o -name ".env.*" -o -name "*.pem" -o -name "*.key" \) -print
du -sh "$STAGE"
```

The final `find` must print nothing. The Dockerfile copies the connector catalog into the image (the gateway reads
`catalog/catalog.json` at startup), so the staged context must contain
`mcp_servers/mcp-gateway/catalog/`; `scripts/acr-build.sh` stages it.

Also copy the Dockerfile to `$STAGE/Dockerfile` when the build service expects
it at the context root (Google Cloud Build with `--tag`).

The build itself runs in Step 7 after the yes:

- Azure: `az acr build --registry <registry> --image mcp-gateway:<tag> --file mcp_servers/mcp-gateway/Dockerfile "$STAGE"`
- Google Cloud: `gcloud builds submit "$STAGE" --tag <region>-docker.pkg.dev/<project>/<repo>/mcp-gateway:<tag>`

## Step 5: the plan (Azure)

Fill `${CLAUDE_PLUGIN_ROOT}/infra/azure/main.bicepparam` into a working copy
(`deployApp = false` for pass 1). Compile and lint:

```bash
bicep build main.bicep --stdout > /dev/null && bicep lint main.bicep
az deployment group what-if -g <rg> --parameters main.bicepparam
```

(With a `.bicepparam` file, pass the file once to `--parameters` and no
`--template-file`.) Show the what-if output.

Billable resources this creates (pass 1):

| Resource | Billing |
|---|---|
| Log Analytics workspace | per GB ingested, plus retention beyond the free period |
| Container Apps environment | no standalone charge on the Consumption profile; apps inside it bill |
| Key Vault (standard) | per operation, small |
| Cosmos DB account (only if `enableCosmos`) | serverless: per request unit and per GB stored |

Free: user-assigned managed identity and role assignments.

Pass 2 adds the Container App: billed per vCPU-second and GiB-second. With
`minReplicas = 1` it runs all day, so it costs money while idle. The existing
container registry is billed separately; `az acr build` adds build time
charges.

## Step 5 (Google Cloud): the plan

```bash
rm -rf /tmp/harbor-gcp && cp -R "${CLAUDE_PLUGIN_ROOT}/infra/gcp" /tmp/harbor-gcp
cd /tmp/harbor-gcp   # write terraform.tfvars from terraform.tfvars.example
terraform init
terraform plan -out=tfplan
```

Show the plan. Billable resources:

| Resource | Billing |
|---|---|
| Cloud Run v2 service (pass 2) | instance-based billing, one instance always allocated (min 1, CPU not throttled), so it costs money while idle |
| Secret Manager secrets | per active secret version and per access |
| Cloud Logging | ingestion beyond the free monthly allotment |
| Firestore database (only if `enable_firestore`) | per read, write, delete and GB stored |
| Artifact Registry | storage; Cloud Build adds build minutes |

Free: service account, IAM bindings, API enablement.

## Step 6: ask for the yes

Send one message that contains: the target (subscription or project, region),
the what-if or plan summary, the billable list above, the sentence "This
creates billable resources and will cost money, including while idle", and the
exact commands that will run, in order. Ask: "Reply yes to create these."
Stop and wait. Anything other than a clear yes means do not proceed.

## Step 7: apply, in two passes

Pass 1, infrastructure without the app:

- Azure: `az deployment group create -g <rg> --parameters main.bicepparam`
  (with `deployApp = false`).
- Google Cloud: `terraform apply tfplan` (with `deploy_service = false`).

Then secrets. The names to create are in the deployment output
(`requiredSecretNames` / `required_secret_ids`). For each secret, the admin
types the value at a hidden prompt; you never see it:

```bash
# Azure Key Vault
read -rs -p "value: " V; echo
T=$(mktemp); chmod 600 "$T"; printf '%s' "$V" > "$T"; unset V
az keyvault secret set --vault-name <vault> --name <secret-name> --file "$T" --encoding utf-8 >/dev/null
rm -f "$T"
```

```bash
# Google Secret Manager
read -rs -p "value: " V; echo
printf '%s' "$V" | gcloud secrets versions add <secret-id> --data-file=- >/dev/null; unset V
```

Generated secrets need no prompt:

- `audit-hmac-key`: `openssl rand -base64 48` piped into the same commands
  (Secret Manager: `| gcloud secrets versions add ... --data-file=-`; Key
  Vault: through a temp file as above).
- `broker-cookie-keys`: comma-separated random strings of at least 32 characters
  each, same method; two keys allow rotation.
- `broker-signing-jwks`: a private JWKS with one RS256 key (the gateway's
  `scripts/gen-jwks.mjs`). From `mcp_servers/mcp-gateway` run
  `npm run -s gen-jwks` and pipe the single JSON line directly into the store
  without printing it or writing it to a file.
- `policy-yaml`: the validated `policy.yaml`. It holds role names and claim
  values, not credentials. Store it with `--file policy.yaml` (Azure) or
  `--data-file=policy.yaml` (Google Cloud).

Verify each secret exists without reading its value:
`az keyvault secret list --vault-name <vault> --query "[].name" -o tsv` or
`gcloud secrets list --format="value(name)"`.

Build and push the image (Step 4 commands). Then pass 2: set `deployApp =
true` (Azure parameter file) or `deploy_service = true` (Terraform), rerun
what-if or plan, show the delta, and get a fresh yes if it adds anything not
already approved.

## Step 8: verify

- `curl -sS -o /dev/null -w "%{http_code}\n" <base>/mcp` returns 401.
- `curl -sS <base>/.well-known/oauth-protected-resource` returns JSON whose
  `resource` is `<base>/mcp`.
- Logs show the service started: Azure `az containerapp logs show -g <rg> -n <prefix>-gateway --tail 50`;
  Google Cloud `gcloud run services logs read <prefix>-gateway --region <region> --limit 50`.
  A startup error about `POLICY_FILE` means the policy secret did not mount or
  failed validation.

Finish by pointing the admin at harbor-connect.

## Updating policy later

Policy is a secret mounted into the container. After storing a new version,
restart so the gateway reloads it: Azure
`az containerapp revision restart -g <rg> -n <prefix>-gateway --revision <name>`,
Google Cloud deploy a new revision (for example `gcloud run services update <svc> --region <region> --update-env-vars POLICY_REV=<n>`,
where `POLICY_REV` is a counter the gateway ignores and only forces a new revision). Use harbor-policy for the review and diff.
