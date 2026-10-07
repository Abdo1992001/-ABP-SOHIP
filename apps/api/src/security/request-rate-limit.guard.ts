import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
} from "@nestjs/common";
import type { Request } from "express";
import type { DatabaseClient } from "@abp/database";
import { createHash } from "node:crypto";
import { ApiProblem } from "../platform/api-exception.filter.js";
import { databaseClientToken } from "../platform/database.providers.js";

interface Limit {
  name: string;
  maximum: number;
  windowSeconds: number;
}

@Injectable()
export class RequestRateLimitGuard implements CanActivate {
  constructor(
    @Inject(databaseClientToken) private readonly database: DatabaseClient,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const limit = classify(request);
    if (limit === null) return true;
    const identity =
      request.header("x-abp-test-user-id") ?? request.ip ?? "anonymous";
    const principal = createHash("sha256")
      .update(identity)
      .digest("hex")
      .slice(0, 24);
    const bucketKey = `${limit.name}:${principal}`;
    const rows = await this.database.$queryRawUnsafe<
      { request_count: number }[]
    >(
      `INSERT INTO request_rate_limits (bucket_key, request_count, window_start, expires_at)
       VALUES ($1, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + ($2 * INTERVAL '1 second'))
       ON CONFLICT (bucket_key) DO UPDATE SET
         request_count = CASE WHEN request_rate_limits.expires_at <= CURRENT_TIMESTAMP THEN 1 ELSE request_rate_limits.request_count + 1 END,
         window_start = CASE WHEN request_rate_limits.expires_at <= CURRENT_TIMESTAMP THEN CURRENT_TIMESTAMP ELSE request_rate_limits.window_start END,
         expires_at = CASE WHEN request_rate_limits.expires_at <= CURRENT_TIMESTAMP THEN CURRENT_TIMESTAMP + ($2 * INTERVAL '1 second') ELSE request_rate_limits.expires_at END
       RETURNING request_count`,
      bucketKey,
      limit.windowSeconds,
    );
    if ((rows[0]?.request_count ?? 1) > limit.maximum) {
      throw new ApiProblem({ status: 429, code: "RATE_LIMITED" });
    }
    return true;
  }
}

function classify(request: Request): Limit | null {
  const path = request.path.toLowerCase();
  if (path.endsWith("/auth/login"))
    return { name: "login", maximum: 5, windowSeconds: 900 };
  if (path.includes("password") && path.includes("reset"))
    return { name: "reset", maximum: 3, windowSeconds: 3600 };
  if (
    request.method === "POST" &&
    (path.includes("/imports") || path.includes("/exports"))
  ) {
    return {
      name: path.includes("/imports") ? "import" : "export",
      maximum: 5,
      windowSeconds: 3600,
    };
  }
  if (
    request.method === "GET" &&
    ("search" in request.query || "q" in request.query)
  ) {
    return { name: "search", maximum: 60, windowSeconds: 60 };
  }
  return null;
}
