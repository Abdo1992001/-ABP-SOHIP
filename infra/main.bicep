targetScope = 'subscription'

@allowed(['dev', 'ci', 'staging', 'production'])
@description('Deployment target. Production execution remains gated by RG-01..RG-16 and Step 12.')
param environment string

param location string = 'uaenorth'
param namePrefix string = 'abp-${environment}'
param postgresAdministratorLogin string
@secure()
param postgresAdministratorPassword string
@description('Immutable API image reference (registry/repository@sha256:digest).')
param apiImage string = 'UNSET'
@description('Immutable worker image reference (registry/repository@sha256:digest).')
param workerImage string = 'UNSET'
param entraTenantId string = tenant().tenantId
param entraClientId string = 'PENDING-DEP-001'
param allowedOrigins string = 'https://PENDING-DEP-002.invalid'

resource resourceGroup 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: '${namePrefix}-rg'
  location: location
  tags: {
    system: 'abp-commercial-system'
    environment: environment
    authorizationState: 'step11-technical-readiness-step12-gated'
  }
}

module observability './modules/observability.bicep' = {
  scope: resourceGroup
  name: 'observability'
  params: {
    location: location
    namePrefix: namePrefix
  }
}

module network './modules/network.bicep' = {
  scope: resourceGroup
  name: 'network'
  params: {
    location: location
    namePrefix: namePrefix
  }
}

module keyVault './modules/key-vault.bicep' = {
  scope: resourceGroup
  name: 'key-vault'
  params: {
    location: location
    namePrefix: namePrefix
  }
}

module storage './modules/storage.bicep' = {
  scope: resourceGroup
  name: 'storage'
  params: {
    location: location
    namePrefix: namePrefix
  }
}

module postgres './modules/postgres.bicep' = {
  scope: resourceGroup
  name: 'postgresql'
  params: {
    location: location
    namePrefix: namePrefix
    delegatedSubnetId: network.outputs.postgresSubnetId
    administratorLogin: postgresAdministratorLogin
    administratorPassword: postgresAdministratorPassword
    production: environment == 'production'
  }
}

module containerApps './modules/container-apps.bicep' = {
  scope: resourceGroup
  name: 'container-apps'
  params: {
    location: location
    namePrefix: namePrefix
    infrastructureSubnetId: network.outputs.containerAppsSubnetId
    logAnalyticsCustomerId: observability.outputs.customerId
    logAnalyticsSharedKey: observability.outputs.sharedKey
    apiImage: apiImage
    workerImage: workerImage
    storageAccountName: storage.outputs.storageAccountName
    keyVaultUri: keyVault.outputs.vaultUri
    entraTenantId: entraTenantId
    entraClientId: entraClientId
    allowedOrigins: allowedOrigins
    production: environment == 'production'
  }
}

module edge './modules/front-door-waf.bicep' = {
  scope: resourceGroup
  name: 'front-door-waf'
  params: {
    namePrefix: namePrefix
    originHostName: containerApps.outputs.apiFqdn
  }
}
