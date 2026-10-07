export const jobStatuses = [
  "PENDING",
  "PROCESSING",
  "SUCCEEDED",
  "FAILED",
  "DEAD",
] as const;
export type JobStatus = (typeof jobStatuses)[number];

export interface JobReference {
  type: string;
  id: string;
}

export interface JobContract {
  id: string;
  type: string;
  status: JobStatus;
  progress: number | null;
  attemptCount: number;
  maxAttempts: number;
  resultRef: JobReference | null;
  error: ErrorEnvelopeReference | null;
  sourceRef: JobReference | null;
  traceId: string;
  version: number;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface ErrorEnvelopeReference {
  code: string;
  traceId: string;
}
