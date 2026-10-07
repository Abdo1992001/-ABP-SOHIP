param namePrefix string
param originHostName string

resource profile 'Microsoft.Cdn/profiles@2024-02-01' = {
  name: '${namePrefix}-afd'
  location: 'global'
  sku: { name: 'Premium_AzureFrontDoor' }
}
resource endpoint 'Microsoft.Cdn/profiles/afdEndpoints@2024-02-01' = {
  parent: profile
  name: '${namePrefix}-edge'
  location: 'global'
  properties: { enabledState: 'Enabled' }
}
resource originGroup 'Microsoft.Cdn/profiles/originGroups@2024-02-01' = {
  parent: profile
  name: 'api'
  properties: {
    loadBalancingSettings: { sampleSize: 4, successfulSamplesRequired: 3 }
    healthProbeSettings: { probePath: '/api/v1/health/ready', probeRequestType: 'GET', probeProtocol: 'Https', probeIntervalInSeconds: 60 }
  }
}
resource origin 'Microsoft.Cdn/profiles/originGroups/origins@2024-02-01' = {
  parent: originGroup
  name: 'primary'
  properties: { hostName: originHostName, httpPort: 80, httpsPort: 443, originHostHeader: originHostName, priority: 1, weight: 1000, enabledState: 'Enabled', enforceCertificateNameCheck: true }
}
resource waf 'Microsoft.Network/frontDoorWebApplicationFirewallPolicies@2024-02-01' = {
  name: '${namePrefix}-waf'
  location: 'global'
  sku: { name: 'Premium_AzureFrontDoor' }
  properties: {
    policySettings: { enabledState: 'Enabled', mode: 'Prevention', requestBodyCheck: 'Enabled' }
    managedRules: { managedRuleSets: [{ ruleSetType: 'DefaultRuleSet', ruleSetVersion: '2.1' }, { ruleSetType: 'Microsoft_BotManagerRuleSet', ruleSetVersion: '1.0' }] }
  }
}
resource securityPolicy 'Microsoft.Cdn/profiles/securityPolicies@2024-02-01' = {
  parent: profile
  name: 'waf'
  properties: { parameters: { type: 'WebApplicationFirewall', wafPolicy: { id: waf.id }, associations: [{ domains: [{ id: endpoint.id }], patternsToMatch: ['/*'] }] } }
}
resource route 'Microsoft.Cdn/profiles/afdEndpoints/routes@2024-02-01' = {
  parent: endpoint
  name: 'all'
  properties: { originGroup: { id: originGroup.id }, supportedProtocols: ['Https'], patternsToMatch: ['/*'], forwardingProtocol: 'HttpsOnly', linkToDefaultDomain: 'Enabled', httpsRedirect: 'Enabled' }
  dependsOn: [origin, securityPolicy]
}
