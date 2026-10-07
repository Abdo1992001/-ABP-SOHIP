export type ErrorParameter = string | number | boolean | null;

export interface FieldError {
  field: string;
  code: string;
  messageKey: string;
  params: Readonly<Record<string, ErrorParameter>>;
}

export interface RuleError {
  code: string;
  messageKey: string;
  params: Readonly<Record<string, ErrorParameter>>;
}

export interface ConflictMetadata {
  currentRowVersion: string;
  expectedRowVersion: string;
  resource: {
    resourceType: string;
    resourceId: string;
  };
}

export interface ErrorBody {
  code: string;
  messageKey: string;
  traceId: string;
  correlationId: string;
  params: Readonly<Record<string, ErrorParameter>>;
  fieldErrors: readonly FieldError[];
  ruleErrors: readonly RuleError[];
  conflict: ConflictMetadata | null;
}

export interface ErrorEnvelope {
  error: ErrorBody;
}
