# armada enterprise mode

Admin side of the enterprise MCP gateway in `mcp_servers/mcp-gateway`. It is driven by the `armada-enterprise` skill (`/armada:armada-enterprise`).

| Path | Purpose |
|---|---|
| `infra/azure/` | Bicep: Container Apps, Key Vault, Log Analytics, managed identity. Supported. |
| `infra/gcp/` | Terraform: Cloud Run v2, Secret Manager, service account. Not yet supported, Azure first. |
| `queries/azure/*.kql` | The five audit insights for Log Analytics. |
| `queries/gcp/*.txt` | The same insights as Cloud Logging filters. Not yet supported, Azure first. |
| `templates/policy.example.yaml` | Example `policy.yaml`, checked against the gateway's `parsePolicy`. |
