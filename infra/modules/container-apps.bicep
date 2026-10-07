param location string
param namePrefix string
param infrastructureSubnetId string
param logAnalyticsCustomerId string
@secure()
param logAnalyticsSharedKey string
param apiImage string
param workerImage string
param storageAccountName string
param keyVaultUri string
param entraTenantId string
param entraClientId string
param allowedOrigins string
param production bool = false

resource environment 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: '${namePrefix}-cae'
  location: location
  properties: {
    zoneRedundant: true
    vnetConfiguration: { infrastructureSubnetId: infrastructureSubnetId, internal: false }
    appLogsConfiguration: { destination: 'log-analytics', logAnalyticsConfiguration: { customerId: logAnalyticsCustomerId, sharedKey: logAnalyticsSharedKey } }
  }
}

var commonEnv = [
  { name: 'NODE_ENV', value: production ? 'production' : 'staging' }
  { name: 'ABP_ALLOWED_ORIGINS', value: allowedOrigins }
  { name: 'ABP_ENTRA_TENANT_ID', value: entraTenantId }
  { name: 'ABP_ENTRA_CLIENT_ID', value: entraClientId }
  { name: 'ABP_KEY_VAULT_URI', value: keyVaultUri }
  { name: 'ABP_STORAGE_ACCOUNT', value: storageAccountName }
  { name: 'ABP_SESSION_COOKIE_SECURE', value: 'true' }
  { name: 'ABP_TEST_AUTH_ENABLED', value: 'false' }
  { name: 'ABP_DEMO_SEED_ENABLED', value: 'false' }
  { name: 'ABP_EXTERNAL_AI_ENABLED', value: 'false' }
  { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', secretRef: 'appinsights' }
  { name: 'DATABASE_URL', secretRef: 'database-url' }
  { name: 'ABP_ENTRA_CLIENT_SECRET', secretRef: 'entra-client-secret' }
]

resource api 'Microsoft.App/containerApps@2024-03-01' = {
  name: '${namePrefix}-api'
  location: location
  identity: { type: 'SystemAssigned' }
  properties: {
    managedEnvironmentId: environment.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: { external: false, targetPort: 3000, transport: 'auto', allowInsecure: false }
      secrets: [
        { name: 'database-url', keyVaultUrl: '${keyVaultUri}secrets/database-url', identity: 'system' }
        { name: 'appinsights', keyVaultUrl: '${keyVaultUri}secrets/application-insights', identity: 'system' }
        { name: 'entra-client-secret', keyVaultUrl: '${keyVaultUri}secrets/entra-client-secret', identity: 'system' }
      ]
    }
    template: {
      containers: [{
        name: 'api'
        image: apiImage
        env: commonEnv
        resources: { cpu: json('0.5'), memory: '1Gi' }
        probes: [
          { type: 'Liveness', httpGet: { path: '/api/v1/health/live', port: 3000 }, initialDelaySeconds: 10, periodSeconds: 15 }
          { type: 'Readiness', httpGet: { path: '/api/v1/health/ready', port: 3000 }, initialDelaySeconds: 10, periodSeconds: 10 }
        ]
      }]
      scale: { minReplicas: production ? 2 : 1, maxReplicas: 10, rules: [{ name: 'http', http: { metadata: { concurrentRequests: '50' } } }] }
    }
  }
}

resource worker 'Microsoft.App/containerApps@2024-03-01' = {
  name: '${namePrefix}-worker'
  location: location
  identity: { type: 'SystemAssigned' }
  properties: {
    managedEnvironmentId: environment.id
    configuration: {
      activeRevisionsMode: 'Single'
      secrets: [
        { name: 'database-url', keyVaultUrl: '${keyVaultUri}secrets/database-url', identity: 'system' }
        { name: 'appinsights', keyVaultUrl: '${keyVaultUri}secrets/application-insights', identity: 'system' }
        { name: 'entra-client-secret', keyVaultUrl: '${keyVaultUri}secrets/entra-client-secret', identity: 'system' }
      ]
    }
    template: {
      containers: [{
        name: 'worker'
        image: workerImage
        env: concat(commonEnv, [{ name: 'ABP_WORKER_HEALTH_PORT', value: '3001' }])
        resources: { cpu: json('0.5'), memory: '1Gi' }
        probes: [
          { type: 'Liveness', httpGet: { path: '/health/live', port: 3001 }, initialDelaySeconds: 10, periodSeconds: 15 }
          { type: 'Readiness', httpGet: { path: '/health/ready', port: 3001 }, initialDelaySeconds: 10, periodSeconds: 10 }
        ]
      }]
      scale: { minReplicas: production ? 2 : 1, maxReplicas: 8 }
    }
  }
}

output environmentId string = environment.id
output apiFqdn string = api.properties.configuration.ingress.fqdn
