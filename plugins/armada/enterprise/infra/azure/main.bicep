// Enterprise MCP gateway on Azure Container Apps.
//
// Deploy in two passes because the Container App reads its secrets from Key
// Vault and the secrets must exist first:
//   pass 1: deployApp = false   (workspace, environment, identity, Key Vault, roles)
//   pass 2: store the secrets in Key Vault, then deployApp = true
// No secret value appears in this file or in the parameter file.
targetScope = 'resourceGroup'

@description('Short prefix for resource names, 3 to 12 lowercase letters or digits.')
@minLength(3)
@maxLength(12)
param namePrefix string

param location string = resourceGroup().location

@description('Name of an existing Azure Container Registry that holds the gateway image.')
param registryName string

@description('Resource group of the registry. Defaults to this resource group.')
param registryResourceGroup string = resourceGroup().name

@description('Image repository and tag inside the registry, for example mcp-gateway:1.')
param imageName string

@description('Pass 1 creates everything except the Container App. Pass 2 sets this to true after the Key Vault secrets exist.')
param deployApp bool = false

@description('Gateway mode. Broker mode needs the BROKER_* secrets listed below.')
@allowed([
  'broker'
  'direct'
])
param gatewayMode string = 'broker'

@description('Public https origin of the gateway, no path. Leave empty to use the generated Container Apps hostname.')
param publicBaseUrl string = ''

@description('Non-secret environment variables for the IdP and gateway, for example the gatewayEnv block of plan.json. Each item has name and value. An item overrides a built-in variable of the same name (GATEWAY_MODE, PUBLIC_BASE_URL, POLICY_FILE, PORT).')
param extraEnv array = []

@description('Connector credentials kept in Key Vault. Each item has envName (for example NINJAONE_CLIENT_SECRET) and secretName (the Key Vault secret holding it).')
param connectorSecrets array = []

@description('Optional Entra object id of the admin who stores secrets. Gets Key Vault Secrets Officer on the vault. Empty skips the assignment.')
param adminPrincipalId string = ''

@description('Log Analytics retention in days.')
@minValue(30)
@maxValue(730)
param logRetentionDays int = 90

@description('Create a Cosmos DB serverless account for the future persistent state adapter. Not wired to the gateway yet.')
param enableCosmos bool = false

param tags object = {}

var suffix = take(uniqueString(resourceGroup().id), 6)
var appName = '${namePrefix}-gateway'
var vaultName = take('kv-${namePrefix}-${suffix}', 24)

// Key Vault secret names the gateway expects. Create these before pass 2.
var gatewaySecrets = concat(
  [
    { envName: 'AUDIT_HMAC_KEY', secretName: 'audit-hmac-key' }
  ],
  gatewayMode == 'broker'
    ? [
        { envName: 'BROKER_UPSTREAM_CLIENT_SECRET', secretName: 'broker-upstream-client-secret' }
        { envName: 'BROKER_SIGNING_JWKS', secretName: 'broker-signing-jwks' }
        { envName: 'BROKER_COOKIE_KEYS', secretName: 'broker-cookie-keys' }
      ]
    : [],
  connectorSecrets
)
var policySecretName = 'policy-yaml'

resource workspace 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: '${namePrefix}-logs'
  location: location
  tags: tags
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: logRetentionDays
  }
}

resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: '${namePrefix}-id'
  location: location
  tags: tags
}

resource vault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: vaultName
  location: location
  tags: tags
  properties: {
    tenantId: tenant().tenantId
    sku: {
      family: 'A'
      name: 'standard'
    }
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 90
    enablePurgeProtection: true
  }
}

// Key Vault Secrets User built-in role.
var kvSecretsUserRoleId = '4633458b-17de-408a-b874-0f8bd2b30c99'
// Key Vault Secrets Officer built-in role.
var kvSecretsOfficerRoleId = 'b86a8fe4-44ce-4948-aee5-eccb2d58c5c7'

resource identityReadsSecrets 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: vault
  name: guid(vault.id, identity.id, kvSecretsUserRoleId)
  properties: {
    principalId: identity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', kvSecretsUserRoleId)
  }
}

resource adminWritesSecrets 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (!empty(adminPrincipalId)) {
  scope: vault
  name: guid(vault.id, adminPrincipalId, kvSecretsOfficerRoleId)
  properties: {
    principalId: adminPrincipalId
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', kvSecretsOfficerRoleId)
  }
}

module acrPull 'modules/acr-pull.bicep' = {
  name: 'acr-pull'
  scope: resourceGroup(registryResourceGroup)
  params: {
    registryName: registryName
    principalId: identity.properties.principalId
  }
}

resource registry 'Microsoft.ContainerRegistry/registries@2023-07-01' existing = {
  name: registryName
  scope: resourceGroup(registryResourceGroup)
}

resource environment 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: '${namePrefix}-env'
  location: location
  tags: tags
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: workspace.properties.customerId
        sharedKey: workspace.listKeys().primarySharedKey
      }
    }
  }
}

var baseUrl = !empty(publicBaseUrl) ? publicBaseUrl : 'https://${appName}.${environment.properties.defaultDomain}'

var secretDefs = concat(
  map(gatewaySecrets, s => {
    name: s.secretName
    keyVaultUrl: '${vault.properties.vaultUri}secrets/${s.secretName}'
    identity: identity.id
  }),
  [
    {
      name: policySecretName
      keyVaultUrl: '${vault.properties.vaultUri}secrets/${policySecretName}'
      identity: identity.id
    }
  ]
)

var extraEnvNames = map(extraEnv, e => e.name)
var builtinEnv = [
  { name: 'GATEWAY_MODE', value: gatewayMode }
  { name: 'PUBLIC_BASE_URL', value: baseUrl }
  { name: 'POLICY_FILE', value: '/mnt/policy/policy.yaml' }
  { name: 'PORT', value: '8080' }
]
// Container Apps rejects duplicate env names, so extraEnv replaces a built-in of the same name.
var plainEnv = concat(filter(builtinEnv, e => !contains(extraEnvNames, e.name)), extraEnv)

var secretEnv = map(gatewaySecrets, s => {
  name: s.envName
  secretRef: s.secretName
})

resource app 'Microsoft.App/containerApps@2024-03-01' = if (deployApp) {
  name: appName
  location: location
  tags: tags
  // The user-assigned identity pulls the image and reads Key Vault. The
  // system-assigned identity is the one that gets the Graph application
  // permissions for the refresh-time membership check (see the
  // gatewayPrincipalId output and `provision --managed-identity-principal-id`).
  identity: {
    type: 'SystemAssigned, UserAssigned'
    userAssignedIdentities: {
      '${identity.id}': {}
    }
  }
  dependsOn: [
    identityReadsSecrets
    acrPull
  ]
  properties: {
    managedEnvironmentId: environment.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: 8080
        transport: 'auto'
        allowInsecure: false
      }
      registries: [
        {
          server: registry.properties.loginServer
          identity: identity.id
        }
      ]
      secrets: secretDefs
    }
    template: {
      containers: [
        {
          name: 'gateway'
          image: '${registry.properties.loginServer}/${imageName}'
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
          env: concat(plainEnv, secretEnv)
          volumeMounts: [
            {
              volumeName: 'policy'
              mountPath: '/mnt/policy'
            }
          ]
        }
      ]
      volumes: [
        {
          name: 'policy'
          storageType: 'Secret'
          secrets: [
            {
              secretRef: policySecretName
              path: 'policy.yaml'
            }
          ]
        }
      ]
      scale: {
        // Stays at 1 until a persistent authorization-server state adapter
        // ships. The broker keeps sessions, codes and refresh tokens in
        // process memory, so a second replica would reject tokens the first
        // one issued.
        minReplicas: 1
        maxReplicas: 1
      }
    }
  }
}

// Optional state store for the future persistent adapter.
resource cosmos 'Microsoft.DocumentDB/databaseAccounts@2024-05-15' = if (enableCosmos) {
  name: take('cosmos-${namePrefix}-${suffix}', 44)
  location: location
  tags: tags
  kind: 'GlobalDocumentDB'
  properties: {
    databaseAccountOfferType: 'Standard'
    capabilities: [
      {
        name: 'EnableServerless'
      }
    ]
    locations: [
      {
        locationName: location
        failoverPriority: 0
      }
    ]
    consistencyPolicy: {
      defaultConsistencyLevel: 'Session'
    }
    disableLocalAuth: true
  }
}

resource cosmosDb 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases@2024-05-15' = if (enableCosmos) {
  parent: cosmos
  name: 'gateway'
  properties: {
    resource: {
      id: 'gateway'
    }
  }
}

// Cosmos DB Built-in Data Contributor, scoped to the account.
resource cosmosData 'Microsoft.DocumentDB/databaseAccounts/sqlRoleAssignments@2024-05-15' = if (enableCosmos) {
  parent: cosmos
  name: guid(cosmos.id, identity.id, 'data-contributor')
  properties: {
    roleDefinitionId: '${cosmos.id}/sqlRoleDefinitions/00000000-0000-0000-0000-000000000002'
    principalId: identity.properties.principalId
    scope: cosmos.id
  }
}

output keyVaultName string = vault.name
@description('Object id of the Container App system-assigned identity. Empty until pass 2. Pass it to provision --managed-identity-principal-id.')
output gatewayPrincipalId string = deployApp ? app!.identity.principalId : ''
output identityClientId string = identity.properties.clientId
output logAnalyticsCustomerId string = workspace.properties.customerId
output gatewayBaseUrl string = baseUrl
output requiredSecretNames array = concat(map(gatewaySecrets, s => s.secretName), [policySecretName])
output cosmosEndpoint string = enableCosmos ? cosmos!.properties.documentEndpoint : ''
