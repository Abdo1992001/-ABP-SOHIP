export interface HealthCheck {
  name: string;
  status: "UP" | "DOWN";
}

export interface HealthEnvelope {
  data: {
    status: "UP" | "DOWN" | "DEGRADED";
    timestamp: string;
    checks: readonly HealthCheck[];
  };
}

export function getLivenessResponse(now = new Date()): HealthEnvelope {
  return { data: { status: "UP", timestamp: now.toISOString(), checks: [] } };
}

export function getReadinessResponse(
  databaseReady: boolean,
  now = new Date(),
): HealthEnvelope {
  return {
    data: {
      status: databaseReady ? "UP" : "DOWN",
      timestamp: now.toISOString(),
      checks: [{ name: "postgresql", status: databaseReady ? "UP" : "DOWN" }],
    },
  };
}
