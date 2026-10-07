param location string
param namePrefix string

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: '${take(replace('${namePrefix}files', '-', ''), 21)}stg'
  location: location
  kind: 'StorageV2'
  sku: { name: 'Standard_ZRS' }
  properties: {
    allowBlobPublicAccess: false
    allowSharedKeyAccess: false
    minimumTlsVersion: 'TLS1_2'
    publicNetworkAccess: 'Disabled'
    supportsHttpsTrafficOnly: true
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storage
  name: 'default'
  properties: {
    isVersioningEnabled: true
    deleteRetentionPolicy: { enabled: true, days: 35 }
    containerDeleteRetentionPolicy: { enabled: true, days: 35 }
  }
}

resource quarantine 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: 'quarantine'
  properties: { publicAccess: 'None' }
}

resource official 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: 'official'
  properties: { publicAccess: 'None' }
}

resource exports 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: 'exports'
  properties: { publicAccess: 'None' }
}

resource lifecycle 'Microsoft.Storage/storageAccounts/managementPolicies@2023-05-01' = {
  parent: storage
  name: 'default'
  properties: {
    policy: {
      rules: [
        {
          enabled: true
          name: 'expire-working-and-export-artifacts'
          type: 'Lifecycle'
          definition: {
            filters: { blobTypes: ['blockBlob'], prefixMatch: ['exports/', 'quarantine/'] }
            actions: { baseBlob: { delete: { daysAfterModificationGreaterThan: 35 } } }
          }
        }
      ]
    }
  }
}

output storageAccountId string = storage.id
output storageAccountName string = storage.name
