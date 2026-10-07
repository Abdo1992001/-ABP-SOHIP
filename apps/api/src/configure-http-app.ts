import { ValidationPipe, type INestApplication } from "@nestjs/common";
import {
  json,
  raw,
  urlencoded,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import helmet from "helmet";
import {
  ApiExceptionFilter,
  ApiProblem,
} from "./platform/api-exception.filter.js";

export function configureHttpApplication(application: INestApplication): void {
  application.setGlobalPrefix("api/v1");
  // Import payloads use a dedicated binary media type so large files never
  // pass through the general JSON parser or inflate through base64 encoding.
  application.use(raw({ type: "application/octet-stream", limit: "100mb" }));
  // A quotation PDF is read, not stored, and a quotation is a few pages. The
  // smaller ceiling is deliberate: nothing about this endpoint needs the
  // import limit, and a lower one is a smaller thing to point at the parser.
  application.use(raw({ type: "application/pdf", limit: "25mb" }));
  application.use(json({ limit: "1mb", strict: true }));
  application.use(
    urlencoded({ extended: false, limit: "1mb", parameterLimit: 200 }),
  );
  application.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'none'"],
          formAction: ["'self'"],
        },
      },
      referrerPolicy: { policy: "no-referrer" },
      hsts:
        process.env.NODE_ENV === "production"
          ? { maxAge: 31_536_000, includeSubDomains: true, preload: true }
          : false,
      crossOriginResourcePolicy: { policy: "same-site" },
    }),
  );
  application.use(
    (request: Request, response: Response, next: NextFunction) => {
      response.setHeader(
        "Permissions-Policy",
        "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
      );
      response.setHeader("Cache-Control", "no-store");
      const traceId = safeRequestId(request.header("x-trace-id"));
      const correlationId = safeRequestId(request.header("x-correlation-id"));
      response.setHeader("x-trace-id", traceId);
      response.setHeader("x-correlation-id", correlationId);
      const startedAt = performance.now();
      response.on("finish", () => {
        process.stdout.write(
          `${JSON.stringify({ level: "info", event: "http.request", method: request.method, path: request.path, status: response.statusCode, durationMs: Math.round((performance.now() - startedAt) * 100) / 100, traceId, correlationId })}\n`,
        );
      });
      next();
    },
  );
  const allowedOrigins = (process.env.ABP_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
  if (allowedOrigins.length > 0) {
    application.enableCors({ credentials: true, origin: allowedOrigins });
  }
  application.useGlobalFilters(new ApiExceptionFilter());
  application.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: (errors) =>
        new ApiProblem({
          status: 400,
          code: "VALIDATION_ERROR",
          fieldErrors: errors.map((error) => ({
            field: error.property,
            code: "INVALID_VALUE",
            messageKey: "errors.validation.invalid_value",
            params: {},
          })),
        }),
    }),
  );
}

function safeRequestId(value: string | undefined): string {
  if (value !== undefined && /^[A-Za-z0-9._:-]{8,128}$/.test(value))
    return value;
  return crypto.randomUUID();
}
