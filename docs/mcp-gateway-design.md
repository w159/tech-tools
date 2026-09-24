# MCP gateway: Entra ID authentication and role-based access

Status: deployed and live-verified at the infrastructure/code layer as of
2026-09-24. `https://gwh-mcp-gateway.delightfulpebble-1c14644e.eastus.azurecontainerapps.io/mcp`
answers unauthenticated requests with `401` + a correct RFC 9728
`WWW-Authenticate: Bearer resource_metadata="https://.../.well-known/oauth-protected-resource/mcp"`,
and `/.well-known/oauth-protected-resource/mcp` correctly names Entra as the
authorization server. `/health` reports all 12 vendor backends discovered.
The Anthropic-range IP allowlist (Network section below) is applied and
verified live: a request from outside `160.79.104.0/21` gets a `403` from
the platform before it ever reaches the gateway process. Sections marked
UNVERIFIED still have not been exercised end to end (they need inputs -
credentials, DNS access, org role decisions - this doc's editor does not have).

## Why a gateway

Users get one connector in Claude and one Entra sign-in for every vendor tool
they are entitled to. Access is decided by Entra app roles in the token and
enforced on the server, so it holds for any MCP client, not only for Claude's
own per-role connector settings. Claude's role grants (Organization settings >
Roles > Connectors) still apply on top and can narrow further; they cannot
widen past what the gateway allows.

## Flow

1. The Claude org Owner adds a custom connector: URL `https://mcp.henssler.com/mcp`,
   Advanced settings: OAuth Client ID `c6e1bf1e-2520-4f1d-b329-8f0f05de34a6`,
   Client Secret from Key Vault secret `claude-connector-client-secret`
   (vault `gwh-mcp-gateway-kv`). Supplying the client ID skips dynamic client
   registration, which Entra does not support.
2. Claude calls `/mcp` unauthenticated, gets `401` with
   `WWW-Authenticate: Bearer resource_metadata=...`.
3. Claude reads `/.well-known/oauth-protected-resource/mcp`, which names
   `https://login.microsoftonline.com/<tenant>/v2.0` as the authorization server,
   and uses Entra's OpenID discovery.
4. The user signs in to Entra (SSO; silent if already signed in). Entra issues a
   v2 access token with `aud` = the app ID and `roles` = the user's app roles.
   Users with no role assignment are refused at sign-in (assignment required).
5. The gateway validates issuer, audience, tenant, signature (Entra JWKS), and
   expiry, then filters tools by role.

The gateway has no `/authorize`, `/token`, or `/register` endpoints. The user's
browser talks to Entra directly, so ingress can be restricted to Anthropic's
egress range.

## Roles

Assign Entra groups (not individuals) to the enterprise application
"Henssler MCP Gateway" with one of these roles per vendor:

| Vendor | Read role | Write role |
|---|---|---|
| Auvik | Auvik.Read | Auvik.Write |
| Blumira | Blumira.Read | Blumira.Write |
| CIPP | CIPP.Read | CIPP.Write |
| ConnectWise | ConnectWise.Read | ConnectWise.Write |
| CrowdStrike Falcon | Falcon.Read | Falcon.Write |
| KnowBe4 | KnowBe4.Read | KnowBe4.Write |
| NinjaOne | NinjaOne.Read | NinjaOne.Write |
| PAN-OS | PanOS.Read | PanOS.Write |
| Paylocity | Paylocity.Read | Paylocity.Write |
| Spanning | Spanning.Read | Spanning.Write |
| ThreatLocker | ThreatLocker.Read | ThreatLocker.Write |
| Vanta | Vanta.Read | Vanta.Write |

Read exposes only tools the vendor server annotates `readOnlyHint: true`.
Write exposes every tool on that vendor. A tool with no annotation needs Write
(fails closed, same rule as `mcp_servers/_shared/annotate-tool.ts`).

## Vendor credentials

Upstream vendor APIs (ConnectWise, NinjaOne, and so on) authenticate with
service credentials, not per-user delegation, so the gateway holds one set per
vendor in Key Vault and the Entra role decides who may use them. Each vendor
child process receives only its own env prefix (for example `NINJAONE_*`), never
another vendor's secrets. The audit log records which Entra user invoked which
tool, which is the per-user accountability the upstream API cannot provide.

## Network

- Ingress: Container Apps, custom domain `mcp.henssler.com` (not yet bound -
  see Remaining setup), IP allowlist `160.79.104.0/21` (Anthropic outbound,
  from https://platform.claude.com/docs/en/api/ip-addresses, checked
  2026-09-23) **applied and verified live** on 2026-09-24 as ingress rule
  `anthropic-outbound` - a request from any other source IP now gets a
  platform-level `403` before reaching the gateway. Recheck the Anthropic
  page periodically; they list phased-out ranges there, and a range change
  needs a rule update here too.
- Entra's identifier URI must equal the connector URL, and must be on a verified
  domain. `henssler.com` is verified in the tenant.

## Compliance notes (FTC Safeguards Rule, Reg S-P, GLBA)

- Access control: least privilege by vendor and by read/write, assignment required.
- Authentication: Entra (MFA and Conditional Access apply to the sign-in).
- Audit: one JSON line per tool call to Log Analytics (365 day retention), with
  Entra object ID and UPN. Arguments and results are not logged because they can
  carry nonpublic personal information.
- Secrets: Key Vault with RBAC and purge protection; accessed by managed identity.

## Known limits

- Blumira keeps navigation state per MCP session. Through the stateless gateway
  all users share one child, so one user's `blumira_navigate` changes what
  others see. The Container App is currently configured `minReplicas: 1,
  maxReplicas: 3` (checked live 2026-09-24), so this is worse than "shared
  between users" - which replica a given request lands on is undefined, so
  navigation state is inconsistent across replicas too, not just shared.
  Fix: expose Blumira's tools flat, keep a child per user, or pin
  `maxReplicas: 1` until one of those fixes ships (cuts availability
  during restarts/deploys as a tradeoff).
- Enterprise Managed Auth (Claude's "Managed authorization", silent connection
  via an identity assertion) needs an authorization server that accepts the
  RFC 7523 jwt-bearer grant. Entra does not accept that grant for this purpose,
  so members use "Individually" (one interactive Entra sign-in per connector).

- **Container Apps environment note:** the original `gwh-mcp-gateway-env`
  got stuck in a `Failed`/`Updating` provisioning loop
  (`ManagedEnvironmentOperationTimeout`) that a `containerapp env create`
  retry did not clear even after 15+ minutes; a delete-and-recreate under a
  new name (`gwh-mcp-gateway-env2`) resolved it in the normal ~3-5 minutes.
  The old environment name is retired; the Container App now lives in
  `gwh-mcp-gateway-env2`. If this recurs, delete/recreate rather than
  waiting on the stuck one.
- **`:latest` tag updates do not roll a new Container App revision** on
  their own - `az containerapp update --image ...:latest` was a no-op
  against the running revision twice in testing. Deploy by exact image
  digest (`az acr repository show --image mcp-gateway:latest --query digest`)
  with an explicit `--revision-suffix` to force a real rollout, then verify
  live rather than trusting the CLI's success exit code alone.
- **`az acr build <local-dir>` uploads the entire given directory to the
  registry's build service before Docker sees it; a repo-root
  `.dockerignore` does NOT reduce that upload** (it only ever filters a real
  `docker build`'s own `COPY` step). Building straight from the repo root
  uploaded 726 MiB and shipped the real secret file `plugins/atlas/.env` and
  a 47 MB stale macOS-only Python venv into the build context. Fix: build
  from a scratch-staged directory containing only what the Dockerfile
  needs - use `mcp_servers/mcp-gateway/scripts/acr-build.sh`, which stages,
  refuses to proceed if it finds any `.env`/`.venv` path, and then runs
  `az acr build` against the clean staging directory (1.88 MiB, verified
  2026-09-24). Never invoke `az acr build` directly against the repo root.
  **Exposure consequence of the pre-fix builds (verified 2026-09-24):**
  before the fix, 4 pushed image digests (built 15:15-16:14 UTC) came from
  a build context that included the real secret file `plugins/atlas/.env`
  (which holds `CW_MANAGE_PUBLIC_KEY`/`CW_MANAGE_PRIVATE_KEY`,
  `KNOWBE4_API_KEY`, `THREATLOCKER_API_KEY`,
  `VANTA_CLIENT_ID`/`VANTA_CLIENT_SECRET`,
  `NINJAONE_CLIENT_ID`/`NINJAONE_CLIENT_SECRET`, `PANOS_API_KEY`,
  `OPENROUTER_API_KEY`). The Dockerfile's own `COPY` instructions only take
  `plugins/atlas/mcp/`, not the repo-root-relative `.env` path, so `.env`
  was not copied into any image layer by the Dockerfile itself; what is
  confirmed is that the file left this machine inside the build-context
  tarball uploaded to the ACR Tasks build service
  (`az acr build`'s own log named the tar.gz it sent). Whether ACR Tasks'
  transient build-service storage retained a copy after the run, and for
  how long, was not checked and is UNVERIFIED.
  Three of the four pre-fix digests **were** pulled into running Container
  App revisions during this session (verified via
  `az containerapp revision list --all`, which is not limited to the
  current revision): `gwh-mcp-gateway--k4w1x3o` (via the `:latest` tag),
  `gwh-mcp-gateway--fix1790265356`/`--fix1790265725`, and
  `gwh-mcp-gateway--verify1790265793`. The fourth digest
  (`fdd35065...`, pushed 16:13:59) has no matching revision in that list
  and appears to have never been deployed. All 4 manifests were deleted
  from ACR (`az acr repository delete --image mcp-gateway@<digest>`) on
  2026-09-24, so the pushed images no longer exist in the registry;
  underlying layer blobs may persist until ACR garbage-collects them
  (not checked). Verified registry access scope at time of exposure via
  `az role assignment list --include-inherited` at the registry, its
  resource group, and the subscription: `gwhmcpgateway` has
  `adminUserEnabled: false` (checked live); non-inherited assignments show
  only the gateway's managed identity (`AcrPull`, scoped directly to the
  registry) and three human subscription Owners (`da-jmorgan`,
  `da-smendoza`, `da-evelarde`@henssler.com). `--include-inherited` also
  surfaces two automated service principals with tenant-root/root-management-group
  `Reader` (registry has ABAC disabled, so built-in `Reader` includes
  `acrPull` on ACR data-plane [INFERENCE, not independently confirmed by
  pulling as them]): `Maester DevOps Account` and `Vanta`, both predating
  this exposure. Not public, but the real pull-capable population is wider
  than "managed identity plus three named Owners" - it also includes these
  two inherited-Reader service principals. Whether either is expected to
  have registry access, and whether that inheritance should be scoped down,
  is a decision for whoever owns the tenant-root/root-management-group
  role assignments, not something this doc's editor can resolve.
  **Recommended, blocked on you:** rotate the listed vendor secrets. The
  file left this machine and entered a build pipeline outside Key Vault's
  control regardless of what ended up in the final image layers, which on
  its own is reason enough to rotate under a least-exposure standard; this
  doc's editor cannot rotate them (only the affected vendors' admin
  consoles can).

## Remaining setup

Everything below needs an input or an action this doc's editor does not have
access to. The infrastructure and code are otherwise complete and verified live.

- **Vendor credentials (blocked on you).** Key Vault (`gwh-mcp-gateway-kv`) is
  currently empty of vendor secrets. Each backend reads its own vendor's real
  env var names directly (no `CFG_` prefix, unlike the atlas plugin's stdio
  path) - see `plugins/atlas/.mcp.json` for the exact per-vendor names (e.g.
  `VANTA_CLIENT_ID`/`VANTA_CLIENT_SECRET`, `PANOS_HOST`/`PANOS_API_KEY`, etc).
  Provide values and they can be loaded as Key Vault secrets and wired as
  Container App secret-backed env vars per vendor.
- **Entra group role assignments (blocked on you - an org-structure
  decision).** The app registration exists with `appRoleAssignmentRequired`
  on (verified live), and 26 app roles total - 13 Read/Write pairs, one per
  row in the Roles table above (12 rows) plus one **orphaned** `TypeSafe.Read`
  / `TypeSafe.Write` pair left over from a since-removed `typesafe` connector
  that no longer exists in `mcp_servers/mcp-gateway/src/backends.ts`'s
  12-entry catalog. The orphaned pair is harmless (no client can ever obtain
  a session through this gateway using it, since no such backend is
  registered) but should be deleted from the app registration the next
  time someone is in there, so the role list matches the 12-vendor table
  above exactly. **Zero** functional vendor roles are assigned to anyone
  yet - only the requesting user holds the bare default-access role.
  Decide which Entra groups (not individuals, per the design above) get
  which vendor Read/Write roles, then assign them on the "Henssler MCP
  Gateway" enterprise application.
- **DNS at the henssler.com registrar (blocked on you - external to Azure).**
  CNAME `mcp` -> `gwh-mcp-gateway.delightfulpebble-1c14644e.eastus.azurecontainerapps.io`,
  and TXT `asuid.mcp` -> `6C95DA3E1BC6F1E9D58EFAEB153F7F939B200E5D9724A72FF6EDE0B651B6CB62`.
- **Custom domain + managed certificate binding** on the Container App -
  only possible once the DNS records above are live and resolving.
- **In Claude (blocked on you - needs org Owner access to the Claude admin
  UI).** Add the connector (see Flow step 1 above) once the custom domain is
  bound, then set per-role connector permissions under Organization
  settings > Roles.
