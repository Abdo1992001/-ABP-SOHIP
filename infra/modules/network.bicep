param location string
param namePrefix string

resource vnet 'Microsoft.Network/virtualNetworks@2024-05-01' = {
  name: '${namePrefix}-vnet'
  location: location
  properties: {
    addressSpace: { addressPrefixes: ['10.40.0.0/16'] }
    subnets: [
      {
        name: 'container-apps'
        properties: { addressPrefix: '10.40.0.0/23' }
      }
      {
        name: 'postgresql'
        properties: {
          addressPrefix: '10.40.2.0/24'
          delegations: [
            {
              name: 'postgres-flexible'
              properties: { serviceName: 'Microsoft.DBforPostgreSQL/flexibleServers' }
            }
          ]
        }
      }
      {
        name: 'private-endpoints'
        properties: { addressPrefix: '10.40.3.0/24' }
      }
    ]
  }
}

output containerAppsSubnetId string = vnet.properties.subnets[0].id
output postgresSubnetId string = vnet.properties.subnets[1].id

