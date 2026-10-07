param location string
param namePrefix string
param delegatedSubnetId string
param administratorLogin string
@secure()
param administratorPassword string
param production bool = false

resource privateDns 'Microsoft.Network/privateDnsZones@2024-06-01' = {
  name: 'private.postgres.database.azure.com'
  location: 'global'
}

resource postgres 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' = {
  name: '${namePrefix}-pg'
  location: location
  sku: { name: 'Standard_D2ds_v5', tier: 'GeneralPurpose' }
  properties: {
    version: '17'
    administratorLogin: administratorLogin
    administratorLoginPassword: administratorPassword
    availabilityZone: '1'
    backup: {
      backupRetentionDays: 14
      geoRedundantBackup: production ? 'Enabled' : 'Disabled'
    }
    network: {
      delegatedSubnetResourceId: delegatedSubnetId
      privateDnsZoneArmResourceId: privateDns.id
      publicNetworkAccess: 'Disabled'
    }
    storage: { storageSizeGB: 128 }
    highAvailability: production ? {
      mode: 'ZoneRedundant'
      standbyAvailabilityZone: '2'
    } : {
      mode: 'Disabled'
    }
  }
}

resource sslMin 'Microsoft.DBforPostgreSQL/flexibleServers/configurations@2024-08-01' = {
  parent: postgres
  name: 'ssl_min_protocol_version'
  properties: { value: 'TLSv1.2', source: 'user-override' }
}

output serverId string = postgres.id
output fqdn string = postgres.properties.fullyQualifiedDomainName
