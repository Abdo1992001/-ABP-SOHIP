import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  type ExceptionFilter,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import type { ErrorEnvelope } from "@abp/contracts";

export interface ApiProblemOptions {
  status: number;
  code: string;
  messageKey?: string;
  params?: Readonly<Record<string, string | number | boolean | null>>;
  fieldErrors?: ErrorEnvelope["error"]["fieldErrors"];
  ruleErrors?: ErrorEnvelope["error"]["ruleErrors"];
  conflict?: ErrorEnvelope["error"]["conflict"];
}

export class ApiProblem extends HttpException {
  constructor(readonly problem: ApiProblemOptions) {
    super(problem, problem.status);
  }
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;
    const traceId =
      safeIdentifier(request.header("x-trace-id")) ?? randomUUID();
    const correlationId =
      safeIdentifier(request.header("x-correlation-id")) ?? traceId;
    const problem = exception instanceof ApiProblem ? exception.problem : null;
    const code = problem?.code ?? errorCode(status);
    const envelope: ErrorEnvelope = {
      error: {
        code,
        messageKey: problem?.messageKey ?? `errors.${code.toLowerCase()}`,
        params: problem?.params ?? {},
        fieldErrors: problem?.fieldErrors ?? [],
        ruleErrors: problem?.ruleErrors ?? [],
        traceId,
        correlationId,
        conflict: problem?.conflict ?? null,
      },
    };
    response.status(status).json(envelope);
  }
}

function safeIdentifier(value: string | undefined): string | undefined {
  if (value === undefined || value.length < 8 || value.length > 128) {
    return undefined;
  }
  return /^[A-Za-z0-9._:-]+$/.test(value) ? value : undefined;
}

function errorCode(status: number): string {
  const codes: Readonly<Record<number, string>> = {
    400: "VALIDATION_ERROR",
    401: "UNAUTHENTICATED",
    403: "FORBIDDEN",
    404: "RESOURCE_NOT_FOUND",
    409: "BUSINESS_CONFLICT",
    412: "CONCURRENCY_CONFLICT",
    422: "RULE_VIOLATION",
    429: "RATE_LIMITED",
    500: "INTERNAL_ERROR",
    503: "DEPENDENCY_UNAVAILABLE",
  };
  return codes[status] ?? "INTERNAL_ERROR";
}
