import { readFile } from "node:fs/promises";
import { Inject, Injectable } from "@nestjs/common";
import { permissions } from "@abp/contracts";
import type { DatabaseClient, TransactionManager } from "@abp/database";
import type { CustomerIdentity } from "../customer/customer-auth.js";
import { ApiProblem } from "../platform/api-exception.filter.js";
import { AuditService } from "../platform/audit.service.js";
import {
  databaseClientToken,
  transactionManagerToken,
} from "../platform/database.providers.js";

/**
 * The parts of the system an administrator keeps an eye on: whether email
 * goes out, and whether last night's backup was taken and restores.
 *
 * Mail settings live in the environment the worker reads too; the API only
 * says whether they are there, never what the secrets are.
 */

export function mailStatus(env: NodeJS.ProcessEnv = process.env) {
  const value = (name: string) => (env[name] ?? "").trim();
  const provider = value("ABP_MAIL_PROVIDER").toUpperCase();
  const sender = value("ABP_MAIL_SENDER");
  const configured =
    provider === "GRAPH"
      ? Boolean(
          value("ABP_MAIL_GRAPH_TENANT_ID") &&
          value("ABP_MAIL_GRAPH_CLIENT_ID") &&
          value("ABP_MAIL_GRAPH_CLIENT_SECRET") &&
          sender,
        )
      : provider === "SMTP"
        ? Boolean(value("ABP_MAIL_SMTP_HOST") && sender)
        : false;
  return {
    configured,
    provider: configured ? provider : "NONE",
    sender: configured ? sender : null,
  };
}

const escape = (text: string) =>
  text.replace(/[&<>"']/g, (char) => `&#${String(char.charCodeAt(0))};`);

@Injectable()
export class SystemService {
  constructor(
    @Inject(databaseClientToken) private readonly db: DatabaseClient,
    @Inject(transactionManagerToken) private readonly txs: TransactionManager,
    private readonly audit: AuditService,
  ) {}

  mail() {
    return { data: mailStatus() };
  }

  async sendTest(i: CustomerIdentity) {
    this.require(i, permissions.usersManage);
    const status = mailStatus();
    if (!status.configured)
      throw new ApiProblem({ status: 422, code: "EMAIL_NOT_CONFIGURED" });
    const me = await this.db.appUser.findUnique({
      where: { id: i.userId },
      select: { displayName: true, emailNormalized: true },
    });
    if (!me?.emailNormalized.includes("@"))
      throw new ApiProblem({ status: 422, code: "YOUR_EMAIL_IS_MISSING" });
    const name = escape(me.displayName);
    return this.txs.run(i, async (tx) => {
      const message = await tx.emailMessage.create({
        data: {
          purposeCode: "TEST",
          toAddresses: [me.emailNormalized],
          subject: "ABP Commercial — test email",
          bodyHtml: `<div style="font-family:Segoe UI,Arial,sans-serif;color:#14213D"><p style="font-size:18px;font-weight:700;border-bottom:3px solid #C8102E;padding-bottom:8px">ACROW · ABP Commercial</p><p>Hello ${name},</p><p>This test message left ABP Commercial through ${escape(status.provider)} from ${escape(status.sender ?? "")}. Quotations and notifications will be sent the same way.</p></div>`,
          bodyText: `Hello ${me.displayName}, email from ABP Commercial is working.`,
          resourceTypeCode: "USER",
          resourceId: i.userId,
          createdByUserId: i.userId,
        },
      });
      await this.audit.record(tx, {
        actorUserId: i.userId,
        actorSessionId: i.sessionId,
        actionCode: "MAIL_TEST_QUEUED",
        resourceType: "EmailMessage",
        resourceId: message.id,
        workspace: "SYSTEM",
        countryCode: null,
        metadata: { provider: status.provider },
        traceId: i.traceId,
        correlationId: i.correlationId,
        source: "system-api",
      });
      return { data: { emailMessageId: message.id, to: me.emailNormalized } };
    });
  }

  /** The last emails, newest first, and what became of each. */
  async emails(i: CustomerIdentity, limit: number) {
    this.require(i, permissions.usersManage);
    const rows = await this.db.emailMessage.findMany({
      orderBy: { createdAt: "desc" },
      take: Math.min(Math.max(limit, 1), 100),
      select: {
        id: true,
        purposeCode: true,
        toAddresses: true,
        subject: true,
        statusCode: true,
        attempts: true,
        lastError: true,
        createdAt: true,
        sentAt: true,
        nextAttemptAt: true,
      },
    });
    const counts = await this.db.emailMessage.groupBy({
      by: ["statusCode"],
      _count: { _all: true },
      where: { createdAt: { gte: new Date(Date.now() - 7 * 86_400_000) } },
    });
    return {
      data: {
        week: Object.fromEntries(
          counts.map((row) => [row.statusCode, row._count._all]),
        ),
        emails: rows.map((row) => ({
          emailMessageId: row.id,
          purposeCode: row.purposeCode,
          to: row.toAddresses,
          subject: row.subject,
          statusCode: row.statusCode,
          attempts: row.attempts,
          lastError: row.lastError,
          createdAt: row.createdAt.toISOString(),
          sentAt: row.sentAt?.toISOString() ?? null,
          nextAttemptAt:
            row.statusCode === "QUEUED"
              ? row.nextAttemptAt.toISOString()
              : null,
        })),
      },
    };
  }

  /**
   * What the backup service wrote after its last run. Missing means backups
   * have never run here -- which is itself the thing to show.
   */
  async backup(i: CustomerIdentity) {
    this.require(i, permissions.usersManage);
    const file = (process.env.ABP_BACKUP_STATUS_FILE ?? "").trim();
    if (!file) return { data: { configured: false, lastRun: null } };
    try {
      const parsed = JSON.parse(await readFile(file, "utf8")) as unknown;
      return {
        data: {
          configured: true,
          lastRun:
            typeof parsed === "object" && parsed !== null ? parsed : null,
        },
      };
    } catch {
      return { data: { configured: true, lastRun: null } };
    }
  }

  private require(i: CustomerIdentity, permission: string) {
    if (!i.permissions.has(permission) || i.deniedPermissions.has(permission))
      throw new ApiProblem({ status: 403, code: "FORBIDDEN" });
  }
}
