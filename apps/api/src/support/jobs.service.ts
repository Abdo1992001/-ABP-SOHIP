import { Inject, Injectable } from "@nestjs/common";
import { permissions } from "@abp/contracts";
import type { DatabaseClient } from "@abp/database";
import {
  hasWorkspace,
  type CustomerIdentity,
} from "../customer/customer-auth.js";
import { ApiProblem } from "../platform/api-exception.filter.js";
import { databaseClientToken } from "../platform/database.providers.js";

@Injectable()
export class JobsService {
  constructor(
    @Inject(databaseClientToken) private readonly db: DatabaseClient,
  ) {}

  async get(identity: CustomerIdentity, id: string) {
    const row = await this.db.durableJob.findUnique({ where: { id } });
    if (!row || !(await this.canView(identity, row.sourceType, row.sourceId))) {
      throw new ApiProblem({ status: 404, code: "JOB_NOT_FOUND" });
    }
    return {
      data: {
        jobId: row.id,
        jobTypeCode: row.type,
        statusCode: uiStatus(row.status),
        progressPct: row.progress,
        createdAt: row.createdAt.toISOString(),
        startedAt: row.startedAt?.toISOString() ?? null,
        completedAt:
          row.status === "SUCCEEDED"
            ? (row.finishedAt?.toISOString() ?? null)
            : null,
        failedAt: new Set(["FAILED", "DEAD"]).has(row.status)
          ? (row.finishedAt?.toISOString() ?? null)
          : null,
        failure: new Set(["FAILED", "DEAD"]).has(row.status)
          ? {
              code: row.errorCode ?? "JOB_FAILED",
              message:
                "The job failed. Use its correlation reference when contacting support.",
            }
          : null,
        resultReference: row.resultReference,
        retryEligible:
          row.status === "FAILED" && row.attemptCount < row.maxAttempts,
        attemptCount: row.attemptCount,
        maxAttempts: row.maxAttempts,
        version: row.version,
      },
    };
  }

  private async canView(
    i: CustomerIdentity,
    type: string | null,
    id: string | null,
  ) {
    if (!type || !id) return false;
    const t = type.toUpperCase();
    if (t === "IMPORTJOB" || t === "IMPORT_JOB") {
      if (!allowed(i, permissions.importsView)) return false;
      return Boolean(
        await this.db.importBatch.findFirst({
          where: { id, actorUserId: i.userId },
        }),
      );
    }
    if (t === "EXPORT") {
      if (!allowed(i, permissions.exportsView)) return false;
      return Boolean(
        await this.db.exportEvent.findFirst({
          where: { id, userId: i.userId },
        }),
      );
    }
    if (t === "UPLOAD_SESSION") {
      if (!allowed(i, permissions.documentsView)) return false;
      return Boolean(
        await this.db.uploadSession.findFirst({
          where: { id, requestedByUserId: i.userId },
        }),
      );
    }
    if (t === "QUOTATION") {
      if (!allowed(i, permissions.quotationsView)) return false;
      return Boolean(
        await this.db.quotation.findFirst({
          where: { id, countryCode: { in: [...i.countryCodes] } },
        }),
      );
    }
    if (t === "USER") {
      // Same reason as templates.service: the raw workspace set does not know
      // that a system administrator holds every workspace.
      return hasWorkspace(i, "ADMIN") && allowed(i, permissions.usersManage);
    }
    return false;
  }
}

function uiStatus(status: string) {
  if (status === "PENDING") return "QUEUED";
  if (status === "PROCESSING") return "RUNNING";
  if (status === "SUCCEEDED") return "COMPLETED";
  return "FAILED";
}

function allowed(i: CustomerIdentity, permission: string) {
  return i.permissions.has(permission) && !i.deniedPermissions.has(permission);
}
