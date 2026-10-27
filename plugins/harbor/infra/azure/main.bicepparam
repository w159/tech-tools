using './main.bicep'

// Example values only. Replace every value before use.
param namePrefix = 'mcpgw'
param registryName = 'exampleregistry'
param imageName = 'mcp-gateway:1'

// Pass 1 keeps this false. Set it to true after the Key Vault secrets exist.
param deployApp = false

param gatewayMode = 'broker'

// Leave empty to use the generated Container Apps hostname, or set the
// custom domain you bind later, for example https://mcp.example.com
param publicBaseUrl = ''

// Non-secret IdP settings. The BROKER_* names follow the gateway's broker
// mode plan and must be re-checked against the gateway version you deploy.
param extraEnv = [
  { name: 'BROKER_UPSTREAM_KIND', value: 'entra' }
  { name: 'BROKER_UPSTREAM_ISSUER', value: 'https://login.microsoftonline.com/00000000-0000-0000-0000-000000000000/v2.0' }
  { name: 'BROKER_UPSTREAM_CLIENT_ID', value: '00000000-0000-0000-0000-000000000000' }
]

// Connector credentials. The value of each secret is set in Key Vault by the
// admin, never here.
param connectorSecrets = [
  { envName: 'NINJAONE_CLIENT_SECRET', secretName: 'ninjaone-client-secret' }
]

param adminPrincipalId = ''
param enableCosmos = false
