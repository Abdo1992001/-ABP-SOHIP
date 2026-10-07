param location string
param namePrefix string

resource vault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: take(replace('${namePrefix}-kv', '-', ''), 24)
  location: location
  properties: {
    tenantId: subscription().tenantId
    enableRbacAuthorization: true
    enablePurgeProtection: true
    enableSoftDelete: true
    publicNetworkAccess: 'Disabled'
    sku: { family: 'A', name: 'standard' }
  }
}

output vaultId string = vault.id
output vaultUri string = vault.properties.vaultUri
