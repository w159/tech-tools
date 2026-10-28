# gateway-connector-auth-truth: Gateway connector auth truth (live, container-held credentials): 7 of 13 WORKING (auvik, connectwise, falcon, ninjaone, paylocity, spanning, threatlocker); knowbe4 and vanta REJECTED by the vendor (401); blumira, cipp, sonicwall UNCONFIGURED (no env var mounted, no vault secret); panos credential valid but appliance unreachable from Azure and ungranted. All 8 Azure resources Succeeded; custom domain mcp.henssler.com NXDOMAIN (non-blocking)

- id: gateway-connector-auth-truth
- status: verified
- verified_by: main
- verified_at: 2026-10-28T19:29:52+00:00

## Evidence
- .atlas/evidence/2026-10-28-gateway-connector-auth-audit.md
- az containerapp show gwh-mcp-gateway -> 35 env secretRefs + 1 volume secretRef, 0 unresolved; no BLUMIRA_/CIPP_/SONICWALL_ env var; az keyvault secret list -> 40 names, 4 unreferenced by the gateway (the sibling dynamics app)
- per-connector <vendor>_status run with the vault value injected (never printed): auvik/connectwise/falcon/ninjaone/paylocity/spanning/threatlocker OK; knowbe4 FAILED HTTP 401 Invalid Token; vanta token mint 401; blumira/cipp/sonicwall NOT CONFIGURED; panos OK locally but in-container fetch to 10.8.254.3 UND_ERR_CONNECT_TIMEOUT and no policy grant
- curl https://gwh-mcp-gateway.delightfulpebble-1c14644e.eastus.azurecontainerapps.io/health -> status ok with 13 backends; POST /mcp without a token -> 401 invalid_token; no token can be minted without a browser (AADSTS500011 / broker client_credentials 401 invalid_client)

## Reproduction
az containerapp show --name gwh-mcp-gateway -g gwh-mcp-gateway-rg --query "{env:properties.template.containers[0].env,volumes:properties.template.volumes}" -o json; az keyvault secret list --vault-name gwh-mcp-gateway-kv --query "[].name" -o tsv; curl -s https://gwh-mcp-gateway.delightfulpebble-1c14644e.eastus.azurecontainerapps.io/health

## Proposed fix
none recorded

## Doc refs
- none

## History
- no earlier verdicts
