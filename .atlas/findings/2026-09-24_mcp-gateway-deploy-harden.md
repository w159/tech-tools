# mcp-gateway-deploy-harden: mcp-gateway deploy/harden verified round 2 2026-09-24: corrected exposure paragraph in docs/architecture/mcp-gateway-design.md confirmed accurate (MI AcrPull, 3 human Owners, 2 inherited-Reader SPs, adminUserEnabled=false, ABAC disabled)

- id: mcp-gateway-deploy-harden
- status: verified
- verified_by: atlas:verifier (fresh, independent, round 2)
- verified_at: 2026-09-24T16:31:54+00:00

## Evidence
- CONFIRMED 2026-09-24 fresh: az containerapp ingress show -g gwh-mcp-gateway-rg -n gwh-mcp-gateway --query ipSecurityRestrictions -> exactly ONE rule: {name: anthropic-outbound, action: Allow, ipAddressRange: 160.79.104.0/21}; no other rules, so all other sources are denied.
- CONFIRMED fresh: az containerapp revision list --all -> 5 revisions; ONLY active: gwh-mcp-gateway--cleanctx1790266640, image gwhmcpgateway.azurecr.io/mcp-gateway@sha256:b8eca63de78871639a5efe84e4d551d9e21904c3a76879154ed8e15c07fbaf75, created 2026-09-24T16:17:29Z; inactive: k4w1x3o (:latest), fix1790265356 (@ed6e70cf...), fix1790265725 (@ed6e70cf...), verify1790265793 (@e8794b4e...).
- CONFIRMED fresh: revision show cleanctx1790266640 -> {runningState: Running, healthState: Healthy, trafficWeight: 100}; az containerapp logs show --tail 40 at 16:17:51Z shows 'F [mcp-gateway] backends: auvik, blumira, cipp, connectwise, falcon, knowbe4, ninjaone, panos, paylocity, spanning, threatlocker, vanta' - all 12 vendor backends, plus 'listening on http://0.0.0.0:8080/mcp'; no errors in log tail.
- CONFIRMED fresh: az acr manifest list-metadata --name mcp-gateway --registry gwhmcpgateway -> exactly one digest sha256:b8eca63de78871639a5efe84e4d551d9e21904c3a76879154ed8e15c07fbaf75 (== active revision). Cross-ref via az acr task logs ca1-ca5 final pushed manifests: ca1 15:15 sha256:636d0663bd4dc380..., ca2 15:54 sha256:ed6e70cf15435762d580d32857582ee1e16f8003eb8e6241a4a2fe89ed1ad977, ca3 16:02 sha256:e8794b4e23e9b211094659291036b7c4e188288bd0b87e8f4352951e03e3fba2, ca4 16:14 sha256:fdd35065af700c98a0fcce4a9bfb1773329db6cbfbfd4d3bfd558e7ecde36d5f, ca5 16:16 sha256:b8eca63de78871639a5efe84e4d551d9e21904c3a76879154ed8e15c07fbaf75. All 4 pre-fix digests gone from ACR; 3 of 4 map to revisions (k4w1x3o<-ca1 :latest, fix1790265356/5725<-ca2, verify1790265793<-ca3); fdd35065 (ca4) matches no revision - never deployed.
- CONFIRMED fresh: read mcp_servers/mcp-gateway/Dockerfile directly - NO COPY/ADD references plugins/atlas/.env or any repo-root .env path; no wholesale repo-root COPY. COPY sources: mcp_servers/mcp-gateway/{package,package-lock,tsconfig}, src, dist+node_modules from build stage, plugins/atlas/mcp/, ghcr.io/astral-sh/uv. Substantive claim (.env never copied into any image layer) holds. Minor wording imprecision: doc says Dockerfile COPY 'only take plugins/atlas/mcp/' but it also COPYs mcp_servers/mcp-gateway/* - immaterial to the .env claim.
- PARTIALLY REFUTED (completeness): az acr show gwhmcpgateway -> adminUserEnabled=false (matches claim). Registry-scope: only AcrPull for MI gwh-mcp-gateway-id (clientId 27080ee0-e240-4400-bac3-b3fada17fa7d). RG scope: []. Subscription scope: Owners da-jmorgan@henssler.com, da-smendoza@Henssler.com, da-evelarde@Henssler.com (+ da-jmorgan Foundry User). HOWEVER az role assignment list --include-inherited at the registry scope shows TWO additional pull-capable principals the three-scope check missed: ServicePrincipal 'Maester DevOps Account' (fa012b8f-8af1-425e-8bfa-f169caf56a0a) Reader at tenant root '/', created 2025-11-18; ServicePrincipal 'Vanta' (f103e7b9-61d2-4aac-a761-5690093cb056) Reader at root management group f00db7e5, created 2023-12-01. Registry has ABAC disabled (abacRepositorySecurity null) so built-in Reader includes image pull [INFERENCE per Microsoft docs; assignment facts observed]. Doc's 'only the gateway's managed identity (AcrPull) and three human subscription Owners could have pulled' is therefore over-stated: two automated service principals also inherited pull.
- STILL UNVERIFIED (unchanged, matches doc): ACR Tasks transient build-service storage retention of the uploaded .env-containing tarball - no tooling exposes post-run build storage state; not checkable.
- CONFIRMED fresh: mcp_servers/mcp-gateway/scripts/acr-build.sh exists, mode 0755; staging deletes .env files and plugins/atlas/mcp/falcon/.venv(.nosync.noindex) then REFUSES to build: 'if find "$STAGE" -iname "*.env" -o -iname "*.venv*" | grep -q .' -> error + exit 1. Guard is real, read from file.
- CONFIRMED fresh (key NAMES only, values never printed): plugins/atlas/.env currently defines CW_MANAGE_PUBLIC_KEY, CW_MANAGE_PRIVATE_KEY, KNOWBE4_API_KEY, THREATLOCKER_API_KEY, VANTA_CLIENT_ID, VANTA_CLIENT_SECRET, NINJAONE_CLIENT_ID, NINJAONE_CLIENT_SECRET, PANOS_API_KEY, OPENROUTER_API_KEY - every claimed exposed name present (plus unrelated CW_MANAGE_URL, PANOS_HOST, PANOS_VERIFY_TLS, TYPESAFE_PROVIDER). Rotation still NOT done - remains blocked on vendor admin consoles.

## Reproduction
az containerapp revision list -g gwh-mcp-gateway-rg -n gwh-mcp-gateway --subscription d10ed4e7-8973-4fb6-aa90-1d31b8be10b3 --all && az role assignment list --scope /subscriptions/d10ed4e7-8973-4fb6-aa90-1d31b8be10b3/resourceGroups/gwh-mcp-gateway-rg/providers/Microsoft.ContainerRegistry/registries/gwhmcpgateway --include-inherited

## Proposed fix
none recorded

## Doc refs
- docs/architecture/mcp-gateway-design.md

## History
- no earlier verdicts
