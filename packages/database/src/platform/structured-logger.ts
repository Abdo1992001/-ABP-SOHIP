export type PlatformLogLevel = "info" | "warn" | "error";

export interface PlatformLogEntry {
  event: string;
  traceId?: string;
  correlationId?: string;
  eventId?: string;
  jobId?: string;
  workerId?: string;
  errorCode?: string;
  errorMessage?: string;
  attempt?: number;
  leaseRecovered?: boolean;
}

export interface PlatformLogger {
  log(level: PlatformLogLevel, entry: PlatformLogEntry): void;
}

export class JsonConsolePlatformLogger implements PlatformLogger {
  log(level: PlatformLogLevel, entry: PlatformLogEntry): void {
    const line = JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      ...entry,
    });

    if (level === "error") {
      console.error(line);
    } else if (level === "warn") {
      console.warn(line);
    } else {
      console.info(line);
    }
  }
}

export const silentPlatformLogger: PlatformLogger = {
  log: () => undefined,
};
