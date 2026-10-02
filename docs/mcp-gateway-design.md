# MCP gateway: Entra ID authentication and role-based access

Status: infrastructure/code deployed since 2026-09-24 (see history below);
re-verified live on 2026-09-28 and partially unblocked, but **UNVERIFIED
end-to-end - no one has ever signed in through a Claude connector against
this gateway.** Credential sets for 5 of 12 vendors (NinjaOne, PAN-OS,
ThreatLocker, Vanta, KnowBe4) are loaded into Key Vault, wired to the
Container App as identity-backed secret references; the container picked
them up without a crash-loop (`restartCount: 0`, container `ready: true`,
ingress routing 100% traffic to the new revision) - **that only proves the
process didn't crash, not that any vendor API call succeeds; vendor auth
itself is UNVERIFIED for all 5** until a real tool call goes through (which
needs a role-holder and a working connector, both still pending below).
ConnectWise secrets loaded into Key Vault are **incomplete for the
gateway specifically**: the running `connectwise-mcp` server requires
`CW_MANAGE_COMPANY_ID` and `CW_MANAGE_CLIENT_ID` in addition to the
private/public key pair, and neither was copied into `plugins/atlas/.env`
or Key Vault - confirmed live via `cw_status` in a running session, which
reported both `NOT SET - required` at the time. **Correction:** both
values do exist elsewhere - in `~/.claude/settings.json`
`pluginConfigs["atlas@tech-tools"].options` (`cw_manage_company_id`,
`cw_manage_client_id`, both non-empty, checked by presence only, values
never read) - so ConnectWise is not missing credentials organization-wide,
only from the two places the gateway and this omp session actually read
(see the corrected vendor table in Remaining setup). `maxReplicas` is
pinned to `1` (was `3`, changed live 2026-09-28), which makes Blumira's
cross-replica session-bleed consistent (every request now lands on the
same shared child) - it does not close the underlying shared-state gap,
see Known limits.

**UNVERIFIED, and not to be treated as working until tested:** whether a
Claude connector can point at the raw
`https://gwh-mcp-gateway.delightfulpebble-1c14644e.eastus.azurecontainerapps.io/mcp`
URL instead of `https://mcp.henssler.com/mcp`. The JWT audience check
server-side does accept `MCP_RESOURCE_URL` regardless of connecting
hostname (read live in `mcp_servers/mcp-gateway/src/auth.ts`), but RFC 9728
resource-indicator validation is a client-side concern: `/.well-known/
oauth-protected-resource/mcp` on the raw host would advertise
`resource: https://mcp.henssler.com/mcp`, a mismatch against the URL the
client actually fetched it from. Whether Claude's MCP client enforces that
match (as a compliant client reasonably should, to prevent resource
mix-up) has not been checked against Claude's implementation and has never
been exercised - do not add the Claude connector expecting this to work
without testing it first. The safer, verified-shape path is to wait for the
custom domain so `resource` and the connection URL always match.

Still open, each for a reason listed in Remaining setup: 2 vendors
(Blumira, CIPP) have no credentials in any known location; 3 more (Auvik,
Paylocity, Spanning) have a partial set in `pluginConfigs` missing exactly
one required field each, with the missing half not found in a
vendor-identifiable macOS Keychain entry either (checked by entry name
only); ConnectWise is complete in `pluginConfigs` but not in Key Vault;
Falcon is complete only via this machine's shell exports, not in Key
Vault or `pluginConfigs` - see the corrected table in Remaining setup for
the full per-vendor, per-layer breakdown. No Entra group holds any vendor
Read/Write role. One individual smoke-test exception exists:
`NinjaOne.Read` was assigned directly to `da-jmorgan@henssler.com` on
2026-10-02 (see Remaining setup); DNS at the registrar is unstarted; no
Claude connector has been added or tested against this gateway in any form.
`/.well-known/oauth-protected-resource/mcp` correctly names Entra as the
authorization server, and the Anthropic-range IP allowlist
(`160.79.104.0/21`) is applied and verified live. Sections marked
UNVERIFIED still have not been exercised end to end.

## Relationship to the atlas plugin / Claude Code (read this first if that's why you're here)

This gateway is a **separate system** from the atlas plugin's MCP servers as
used in Claude Code (this repo's `plugins/atlas/.mcp.json`). Confirmed live
on 2026-09-28: this omp session runs each vendor server as a **local stdio
child process**. Three separate credential sources exist, and at the time
of this check only one resolved in this specific session:

1. Shell-exported vars (`~/.zshrc` on this machine has only
   `FALCON_CLIENT_ID`, `FALCON_CLIENT_SECRET`, `FALCON_BASE_URL` exported) -
   the only source that worked live: Falcon authenticated with 145 tools,
   the 11 others reported `MISSING_CREDENTIALS`/`NOT CONFIGURED`.
2. `~/.claude/settings.json` `pluginConfigs["atlas@tech-tools"].options` -
   populated with real-looking values (presence checked, values never
   read) for Auvik (partial), ConnectWise (complete), KnowBe4 (complete),
   NinjaOne (complete), Paylocity (partial), Spanning (partial),
   ThreatLocker (partial), Vanta (complete). This is the layer Claude
   Code's own dashboard/`/plugin config` writes to via `${user_config.*}`
   substitution into `CFG_*` env vars. **[INFERENCE, not directly
   observed]:** this omp session likely does not resolve that
   substitution, so `CFG_*` vars would arrive as the literal unexpanded
   string, which the loader's own guard would then correctly refuse to
   promote - this would explain the observed `MISSING_CREDENTIALS` result
   for every vendor whose only source is `pluginConfigs`. No command in
   this session actually read what env vars a spawned vendor server
   received, so an equally consistent alternative explanation (this
   harness reading its own separate config and never passing `CFG_*` at
   all) has not been ruled out.
3. `plugins/atlas/.env` in this repo checkout - has complete sets for
   NinjaOne, PAN-OS, ThreatLocker, Vanta, and KnowBe4 (all now flagged for
   rotation - see the incident note in Compliance notes). ConnectWise here
   is incomplete (same missing `COMPANY_ID`/`CLIENT_ID` as Key Vault).

None of the Key Vault/Container App work above changes any of this - a
Claude Code or omp session never talks to the gateway. If what you
actually want is these vendors working **in Claude Code/omp**, the real
fix shipped this session: `plugins/atlas/mcp/_env/load.mjs` and `load.py`
now also load `~/.config/atlas/atlas.env` (a per-user KEY=VALUE file,
`chmod 600`) as a baseline before `ATLAS_ENV_FILE`, so credentials resolve
even when a harness doesn't handle `userConfig` substitution. That file
now holds NinjaOne/PAN-OS/ThreatLocker/Vanta/KnowBe4 (rebuilt with rotated values
once you rotate them per the incident note). **This is UNVERIFIED in this
live session** - the code change is in repo source, but this session runs
the *installed cache copy* of the plugin, which does not pick up repo
edits; it takes effect only after reinstalling/updating the plugin from
this repo and restarting the session, at which point re-running each
vendor's `_status` tool is the way to confirm it.

**Correction on record (2026-09-28):** an attempt to add `"Group"` to
`appRoles[].allowedMemberTypes` (on the theory that it was required for
group assignment) was rejected by Graph (`Group` is not a legal value at
all - `"User"` already permits assigning both users and groups to an app
role). The PATCH briefly set `isEnabled: false` on all 26 roles; caught
immediately, reverted, and reverified live back to the original
`allowedMemberTypes: ["User"], isEnabled: true` on all 26. No role had any
group or user assignment at the time (only the requester's default-access
role existed), so no access was actually granted or revoked. The Roles
table below and its group-assignment instructions were already correct;
no code or config change was needed there.

## Why a gateway

Users get one connector in Claude and one Entra sign-in for every vendor tool
they are entitled to. Access is decided by Entra app roles in the token and
enforced on the server, so the role check does not depend on which client
connects. Reachability does: the IP allowlist currently admits only
Anthropic's egress range (see Network), so only Claude's hosted connectors
can reach the gateway today. Claude's own per-role connector settings
(Organization settings > Roles > Connectors) still apply on top and can
narrow access further; they cannot widen it past what the gateway allows.

## Flow

1. The Claude org Owner adds a custom connector: URL
   `https://mcp.henssler.com/mcp`. **Do not substitute the raw Container
   Apps hostname without testing it first** - see the UNVERIFIED note in
   Status above about the RFC 9728 `resource` mismatch.
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
- **Allowlist vs. non-Anthropic clients (known conflict, unresolved).**
  `160.79.104.0/21` is Anthropic's egress range, so it admits Claude's hosted
  connectors (claude.ai, Desktop). Claude Code and any other MCP client that
  connects from a user's own network get a platform `403`. That contradicts a
  "works for any MCP client" design goal. Resolving it needs Henssler's
  office/VPN egress CIDRs added as further Allow rules (not supplied yet), or
  an explicit decision that hosted connectors are the only supported client.
- **Certificate choice (checked against Microsoft Learn, read 2026-10-02):
  use a Key Vault certificate, not the free managed certificate, because the
  managed one conflicts with the allowlist.**
  - *Free managed certificate* ("Custom domain names and free managed
    certificates in Container Apps", page dated 2026-01-28): requires the app
    to be "publicly accessible from the DigiCert IP addresses" and states "all
    requirements must be met at all times when the managed certificate is
    assigned", which includes automatic renewals. The current allow-only rule
    (`160.79.104.0/21`) does not admit DigiCert, and the page states the
    requirement without exempting CNAME validation (the validation method for
    a subdomain like `mcp`), so do not assume the allowlist is safe. **Lifting
    the allowlist during binding is not a fix**: it would get the first
    certificate issued, but renewal would then fail (Container Apps retries
    silently) while the allowlist is back on. The only way to keep the managed
    certificate is permanent Allow rules for DigiCert's published validation
    IPs (https://knowledge.digicert.com/alerts/ip-address-domain-validation),
    which Henssler would have to keep tracking.
  - *Key Vault certificate* ("Import Certificates from Azure Key Vault to
    Azure Container Apps", page dated 2025-11-14): the environment's managed
    identity imports it (needs `Key Vault Secrets User` on the vault);
    "When you rotate your certificate in Key Vault, Container Apps
    automatically updates the certificate in your environment" (up to 12
    hours to apply). The page contains no DigiCert or public-reachability
    requirement, so the allowlist is untouched. Caveats: ECDSA p384/p521 are
    unsupported; the certificate itself must be issued by a CA Henssler
    chooses, and Key Vault only auto-renews it if the certificate has an
    integrated-CA issuance policy (not checked here). A plain `.pfx` upload
    (the other bring-your-own path) renews only by manual re-upload, within
    the 60-day expiry warning the page describes.
  - *Prerequisites either way* (page): the CNAME must point directly at the
    app's generated FQDN with no intermediate, and if the root domain has a
    CAA record it must allow the issuing CA. Checked live 2026-10-02 with
    `dig`: `henssler.com` has **no CAA record**, and its nameservers are
    **Cloudflare** (`theo.ns.cloudflare.com`, `ivy.ns.cloudflare.com`).
  - **The `mcp` CNAME must be DNS only (grey cloud), whichever certificate is
    used.** Two independent reasons: Learn names Cloudflare as an example of
    an intermediate that blocks managed-certificate issuance and renewal; and,
    regardless of certificate, a proxied (orange-cloud) record makes all
    traffic reach Container Apps from Cloudflare's IP addresses, so the
    `160.79.104.0/21` allowlist would return `403` to Claude itself.
- Entra's identifier URI must equal the connector URL, and must be on a verified
  domain. `henssler.com` is verified in the tenant.

## Compliance notes (FTC Safeguards Rule, Reg S-P, GLBA)

- Access control: least privilege by vendor and by read/write, assignment required.
- Authentication: Entra (MFA and Conditional Access apply to the sign-in).
- Audit: one JSON line per tool call to Log Analytics (365 day retention), with
  Entra object ID and UPN. Arguments and results are not logged because they can
  carry nonpublic personal information.
- Secrets: Key Vault with RBAC and purge protection; accessed by managed identity.

**Credential exposure incident (2026-09-28):** during this session, a
`sed | cat -A` command run against `plugins/atlas/.env` for debugging
printed six real secret values in plaintext into the session transcript and
its logs: `CW_MANAGE_PUBLIC_KEY`, `CW_MANAGE_PRIVATE_KEY`,
`THREATLOCKER_API_KEY`, `VANTA_CLIENT_ID`, `VANTA_CLIENT_SECRET`, and
`NINJAONE_CLIENT_ID`. A separate `grep -n` on the same file also printed
the `KNOWBE4_API_KEY` line; the harness happened to render that one value
as an opaque redacted token in the transcript, but treat that as luck, not
a guarantee - rotate it too. This is a live exposure, not the historical
build-context one described in Known limits below, and needs the same
response: **rotate all seven at their vendor consoles** (ConnectWise x2,
ThreatLocker, Vanta x2, NinjaOne, KnowBe4). After rotating, update the
rotated values in **every** place a pre-rotation copy landed - rotating the
vendor console alone does not update any of them:

- Key Vault (`gwh-mcp-gateway-kv`, dash-named secrets)
- `~/.config/atlas/atlas.env` on this machine
- `plugins/atlas/.env` in this repo checkout (the source these were copied from)
- `~/.claude/settings.json` `pluginConfigs["atlas@tech-tools"].options` -
  holds its own copies of `cw_manage_public_key`, `cw_manage_private_key`,
  `vanta_client_id`, `vanta_client_secret`, `ninjaone_client_id`, and
  `knowbe4_api_key` (presence confirmed, values never read); it does not
  hold ThreatLocker's API key.

## Known limits

- Blumira keeps navigation state per MCP session. Through the stateless gateway
  all users share one child, so one user's `blumira_navigate` changes what
  others see. The Container App is pinned `minReplicas: 1, maxReplicas: 1`
  (changed live 2026-09-28, was `maxReplicas: 3` as checked 2026-09-24) so
  navigation state is now shared between users but at least consistent -
  every request lands on the same replica. This trades away the 3x
  restart/deploy availability headroom; a real fix (expose Blumira's tools
  flat, or keep a child per user) still hasn't shipped.
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

- **Vendor credentials - full per-vendor, per-layer picture (2026-09-28,
  corrected).** Presence checked by boolean only; no secret value was read
  in building this table.

  | Vendor | Key Vault (gateway, auth still UNVERIFIED) | `plugins/atlas/.env` | `pluginConfigs` (Claude Code) | `~/.config/atlas/atlas.env` (needs plugin reinstall to take effect in this omp session; NOT yet live here) |
  |---|---|---|---|---|
  | NinjaOne | loaded | complete | complete | complete |
  | PAN-OS | loaded | complete | not present | complete |
  | ThreatLocker | loaded | complete | partial (missing api key) | complete |
  | Vanta | loaded | complete | complete | complete |
  | KnowBe4 | loaded | complete | **complete** | complete |
  | ConnectWise | incomplete (missing company/client id) | incomplete (same) | **complete** | not present |
  | Falcon | not present | not present | not present | n/a - resolves via this machine's `~/.zshrc` shell export instead, already live in this session |
  | Auvik | not present | not present | partial (missing api key) | not present |
  | Paylocity | not present | not present | partial (missing client secret) | not present |
  | Spanning | not present | not present | partial (missing api token) | not present |
  | Blumira | not present | not present | not present | not present |
  | CIPP | not present | not present | not present | not present |

  Checked macOS Keychain entry *names* only (`security dump-keychain`, no
  `-d`/value dump - printing a Keychain value would repeat this session's
  earlier plaintext exposure, this time with Claude account tokens, so
  that was not attempted) for the three missing fields above: no
  Auvik/Paylocity/Spanning-identifiable entry exists. Every match was a
  generic `Claude Code-credentials-<hash>` or `Claude Safe Storage` entry,
  which can't be attributed to a specific vendor by name alone. Treat the
  three missing fields as **blocked on user**, not as "check the
  Keychain" - that avenue is exhausted at the name level and not worth
  pursuing further here.

  Also checked (non-secret, printed): `knowbe4_region` and
  `ninjaone_region` in `pluginConfigs` are both `"us"`, matching each
  server's own default when the var is unset (confirmed in
  `mcp_servers/knowbe4-mcp/src/utils/client.ts` and
  `mcp_servers/ninjaone-mcp/src/utils/client.ts`), so leaving
  `KNOWBE4_REGION`/`NINJAONE_REGION` out of Key Vault and `atlas.env` does
  not misroute either vendor's requests.

  Only **2 vendors have zero credentials in any known location**: Blumira,
  CIPP. Everything else is either fully usable somewhere or missing exactly
  one field. **Blocked on you:** the missing `CW_MANAGE_COMPANY_ID`/
  `CW_MANAGE_CLIENT_ID` for the gateway specifically (already in
  `pluginConfigs` - copy from there rather than re-collecting), the missing
  API key/secret/token for Auvik/Paylocity/Spanning, and full credentials
  for Blumira and CIPP. See the credential exposure incident in Compliance
  notes before copying any of the currently-exposed values anywhere further.
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
  above exactly. **No group** holds a functional vendor role yet.
  **Smoke-test exception (temporary, individual assignment, which the
  groups-only design otherwise rules out):** `NinjaOne.Read` was assigned
  directly to `da-jmorgan@henssler.com` on 2026-10-02 (confirmed by listing
  `appRoleAssignedTo`). Remove it once a real group assignment replaces it.
  Decide which Entra groups (not individuals, per the design above) get
  which vendor Read/Write roles, then assign them on the "Henssler MCP
  Gateway" enterprise application.
- **Pre-DNS direct test path: UNVERIFIED and currently BROKEN.**
  `az account get-access-token --resource c6e1bf1e-2520-4f1d-b329-8f0f05de34a6`
  fails with `AADSTS65001` (observed 2026-10-02): the Azure CLI first-party
  client (`04b07795-8ddb-461a-bbee-02f9e1bf7b46`) is not in the app's
  `api.preAuthorizedApplications` (empty), so no token is issued. Making it
  work means pre-authorizing that client for `access_as_user`, which lets
  the Azure CLI mint gateway tokens for any user holding a role - a security
  decision not made here. The app's `requestedAccessTokenVersion` is 2 and
  the gateway accepts `aud` of the app ID, `api://<appId>`, or the resource
  URL, so token version and audience are not the obstacle.
- **DNS for henssler.com is hosted at Cloudflare (blocked on you - external
  to Azure).** Add two records in the Cloudflare dashboard (values
  re-confirmed against the live Container App on 2026-10-02):
  CNAME `mcp` -> `gwh-mcp-gateway.delightfulpebble-1c14644e.eastus.azurecontainerapps.io`
  with the proxy status set to **DNS only (grey cloud)**. Proxied (orange
  cloud) would send all traffic from Cloudflare's IPs, so the
  `160.79.104.0/21` allowlist would 403 Claude itself, and Microsoft Learn
  also names Cloudflare as a blocker for managed-certificate issuance;
  and TXT `asuid.mcp` -> `6C95DA3E1BC6F1E9D58EFAEB153F7F939B200E5D9724A72FF6EDE0B651B6CB62`.
  Do this before adding the Claude connector - see the UNVERIFIED
  resource-mismatch note in Status above for why the raw hostname is not a
  substitute.
- **Custom domain + certificate binding** on the Container App - only
  possible once the DNS records above are live and resolving, and needed
  before the Claude connector can be tested (see Status above). Use a Key
  Vault certificate, not the free managed one (see Network, "Certificate
  choice"). Open prerequisites: a certificate for `mcp.henssler.com` issued
  and stored in `gwh-mcp-gateway-kv` (not done; needs a CA decision from
  you), and `Key Vault Secrets User` granted to the Container Apps
  environment's managed identity (not done; the environment currently has
  no identity of its own, the gateway's `gwh-mcp-gateway-id` is on the app).
- **In Claude (blocked on you - needs org Owner access to the Claude admin
  UI).** Add the connector once the custom domain is bound (see Flow step 1
  above), then set per-role connector permissions under Organization
  settings > Roles. This has never been done - the entire OAuth handshake
  through Claude's actual client is UNVERIFIED until someone completes it.
