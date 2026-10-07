param location string
param namePrefix string

resource logs 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: '${namePrefix}-logs'
  location: location
  properties: { retentionInDays: 90 }
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: '${namePrefix}-appi'
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logs.id
  }
}

resource actionGroup 'Microsoft.Insights/actionGroups@2023-09-01-preview' = {
  name: '${namePrefix}-ops'
  location: 'global'
  properties: {
    groupShortName: 'abpops'
    enabled: true
    emailReceivers: []
  }
}

resource availabilityAlert 'Microsoft.Insights/scheduledQueryRules@2023-12-01' = {
  name: '${namePrefix}-availability'
  location: location
  properties: {
    displayName: 'ABP availability below engineering SLO'
    enabled: true
    severity: 1
    evaluationFrequency: 'PT5M'
    windowSize: 'PT15M'
    scopes: [appInsights.id]
    criteria: {
      allOf: [{
        query: 'requests | summarize availability=100.0 * countif(success == true) / count()'
        timeAggregation: 'Average'
        metricMeasureColumn: 'availability'
        operator: 'LessThan'
        threshold: json('99.5')
        failingPeriods: { numberOfEvaluationPeriods: 1, minFailingPeriodsToAlert: 1 }
      }]
    }
    actions: { actionGroups: [actionGroup.id] }
  }
}

resource failureAlert 'Microsoft.Insights/scheduledQueryRules@2023-12-01' = {
  name: '${namePrefix}-failed-jobs'
  location: location
  properties: {
    displayName: 'ABP failed durable jobs'
    enabled: true
    severity: 2
    evaluationFrequency: 'PT5M'
    windowSize: 'PT15M'
    scopes: [appInsights.id]
    criteria: {
      allOf: [{
        query: 'traces | where message has "job_failed" | summarize failures=count()'
        timeAggregation: 'Total'
        metricMeasureColumn: 'failures'
        operator: 'GreaterThan'
        threshold: 0
        failingPeriods: { numberOfEvaluationPeriods: 1, minFailingPeriodsToAlert: 1 }
      }]
    }
    actions: { actionGroups: [actionGroup.id] }
  }
}

output customerId string = logs.properties.customerId
@secure()
output sharedKey string = logs.listKeys().primarySharedKey
output applicationInsightsConnectionString string = appInsights.properties.ConnectionString
