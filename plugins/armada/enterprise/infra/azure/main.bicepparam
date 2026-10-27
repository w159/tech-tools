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

// Non-secret IdP settings: paste the gatewayEnv block that `admin plan` wrote
// to plan.json, plus BROKER_UPSTREAM_CLIENT_ID (the app registration's
// application id) and optionally TOKEN_CLOCK_TOLERANCE_SECONDS. A name set
// here replaces the built-in of the same name (GATEWAY_MODE, PUBLIC_BASE_URL).
param extraEnv = [
  { name: 'BROKER_UPSTREAM_KIND', value: 'entra' }
  { name: 'BROKER_UPSTREAM_ISSUER', value: 'https://login.microsoftonline.com/00000000-0000-0000-0000-000000000000/v2.0' }
  { name: 'BROKER_UPSTREAM_CLIENT_ID', value: '00000000-0000-0000-0000-000000000000' }
  { name: 'BROKER_REFRESH_TOKEN_TTL', value: '604800' }
  { name: 'ENTRA_MEMBERSHIP_CHECK', value: '1' }
  { name: 'TOKEN_CLOCK_TOLERANCE_SECONDS', value: '5' }
]

// Connector credentials. The value of each secret is set in Key Vault by the
// admin, never here.
param connectorSecrets = [
  { envName: 'NINJAONE_CLIENT_SECRET', secretName: 'ninjaone-client-secret' }
]

param adminPrincipalId = ''
param enableCosmos = false
