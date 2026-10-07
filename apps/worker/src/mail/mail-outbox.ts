import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { createPrismaClient } from "@abp/database";
import type { MailConfig } from "./mail-config.js";
import { MailError, type MailTransport } from "./mail-transport.js";
import {
  notificationDigest,
  undeliveredNotice,
  type Lang,
} from "./mail-templates.js";

type Database = ReturnType<typeof createPrismaClient>;

/** Minutes to wait before each retry; after the last, the message has failed. */
export const RETRY_MINUTES = [1, 5, 15, 60, 180] as const;
export const MAX_ATTEMPTS = RETRY_MINUTES.length + 1;

export interface StoredAttachment {
  storageKey: string;
  fileName: string;
  mimeType: string;
}

/** When to try again after a failure, or null when it is time to give up. */
export function nextAttempt(
  attempts: number,
  permanent: boolean,
  now: Date,
): Date | null {
  if (permanent || attempts >= MAX_ATTEMPTS) return null;
  const minutes = RETRY_MINUTES[Math.max(0, attempts - 1)] ?? 180;
  return new Date(now.getTime() + minutes * 60_000);
}

function objectPath(key: string): string {
  return resolve(
    process.env.ABP_LOCAL_OBJECT_ROOT ?? ".tmp/object-storage",
    key,
  );
}

/**
 * Send what is due. Messages are claimed with SKIP LOCKED, so two workers
 * never send the same one; one stuck in SENDING by a worker that died is put
 * back in the queue after ten minutes.
 */
export async function sendDueEmails(
  db: Database,
  transport: MailTransport,
  batch = 10,
  now = new Date(),
): Promise<{ sent: number; failed: number }> {
  await db.$executeRaw`
    UPDATE email_messages SET status_code = 'QUEUED'
     WHERE status_code = 'SENDING'
       AND next_attempt_at < now() - interval '10 minutes'`;
  const claimed = await db.$queryRaw<{ email_message_id: string }[]>`
    UPDATE email_messages
       SET status_code = 'SENDING', attempts = attempts + 1, next_attempt_at = now()
     WHERE email_message_id IN (
       SELECT email_message_id FROM email_messages
        WHERE status_code = 'QUEUED' AND next_attempt_at <= now()
        ORDER BY created_at
        LIMIT ${batch}
        FOR UPDATE SKIP LOCKED)
    RETURNING email_message_id`;
  let sent = 0;
  let failed = 0;
  for (const { email_message_id: id } of claimed) {
    const message = await db.emailMessage.findUnique({ where: { id } });
    if (!message) continue;
    try {
      const files = (Array.isArray(message.attachments)
        ? message.attachments
        : []) as unknown as StoredAttachment[];
      const attachments = await Promise.all(
        files.map(async (file) => ({
          fileName: file.fileName,
          mimeType: file.mimeType,
          content: await readFile(objectPath(file.storageKey)).catch(() => {
            throw new MailError(
              `The attachment ${file.fileName} is missing.`,
              true,
            );
          }),
        })),
      );
      const result = await transport.send({
        to: message.toAddresses,
        cc: message.ccAddresses,
        replyTo: message.replyTo,
        subject: message.subject,
        html: message.bodyHtml,
        text: message.bodyText,
        attachments,
      });
      await db.$transaction(async (tx) => {
        await tx.emailMessage.update({
          where: { id },
          data: {
            statusCode: "SENT",
            sentAt: new Date(),
            lastError: null,
            providerMessageId: result.messageId,
          },
        });
        await markQuotationDelivery(tx, id, "SENT", result.messageId);
      });
      sent += 1;
    } catch (error) {
      const permanent = error instanceof MailError && error.permanent;
      const reason =
        error instanceof Error ? error.message : "The email could not be sent.";
      const retryAt = nextAttempt(message.attempts, permanent, now);
      await db.$transaction(async (tx) => {
        await tx.emailMessage.update({
          where: { id },
          data:
            retryAt === null
              ? { statusCode: "FAILED", lastError: reason.slice(0, 1000) }
              : {
                  statusCode: "QUEUED",
                  nextAttemptAt: retryAt,
                  lastError: reason.slice(0, 1000),
                },
        });
        if (retryAt !== null) return;
        await markQuotationDelivery(tx, id, "FAILED", null);
        // Whoever sent it is told, in the app, so a customer is not left
        // waiting for a quotation that never arrived.
        if (message.createdByUserId) {
          const notice = undeliveredNotice(
            await languageOf(tx, message.createdByUserId),
            message.subject,
            reason,
          );
          await tx.userNotification.create({
            data: {
              recipientUserId: message.createdByUserId,
              typeCode: "EMAIL_UNDELIVERED",
              titleSafe: notice.title,
              bodySafe: notice.body,
              resourceTypeCode: message.resourceTypeCode,
              resourceId: message.resourceId,
              // About email that failed: not itself to be emailed.
              emailStatusCode: "SKIPPED",
            },
          });
        }
      });
      if (retryAt === null) failed += 1;
    }
  }
  return { sent, failed };
}

type Tx = Parameters<Parameters<Database["$transaction"]>[0]>[0];

async function markQuotationDelivery(
  tx: Tx,
  emailMessageId: string,
  status: "SENT" | "FAILED",
  providerReference: string | null,
) {
  await tx.$executeRaw`
    UPDATE quotation_send_events
       SET metadata = coalesce(metadata, '{}'::jsonb)
                      || jsonb_build_object('deliveryStatus', ${status}::text),
           provider_reference = coalesce(${providerReference}::text, provider_reference)
     WHERE metadata ->> 'emailMessageId' = ${emailMessageId}`;
}

async function languageOf(tx: Tx | Database, userId: string): Promise<Lang> {
  const preference = await tx.userPreference.findUnique({
    where: { userId },
    select: { preferences: true },
  });
  const language = (preference?.preferences as Record<string, unknown> | null)
    ?.language;
  return language === "ar" ? "ar" : "en";
}

/** Where a notification about this kind of record opens in the app. */
const ROUTES: Record<string, string> = {
  ACCOUNT: "/customers",
  CUSTOMER: "/customers",
  CONTACT: "/contacts",
  PROJECT: "/projects",
  QUOTATION: "/quotations",
  OPPORTUNITY: "/opportunities",
  ACTIVITY: "/activities",
  SHIPMENT: "/shipments",
  SALES_ORDER: "/orders",
  ERP_ORDER: "/orders",
  PAYMENT: "/finance/payments",
  COMPLAINT: "/complaints",
  CUSTOMER_ORDER: "/customer-orders",
  WORK_ORDER: "/work-orders",
  CUSTOMER_FEEDBACK: "/customer-feedback",
};

export function notificationPath(
  resourceTypeCode: string | null,
  resourceId: string | null,
): string {
  if (resourceTypeCode === "SYSTEM") return "/admin/system";
  const root = resourceTypeCode ? ROUTES[resourceTypeCode] : undefined;
  return root && resourceId ? `${root}/${resourceId}` : "/notifications";
}

/** Whether this person wants their notifications by email (absent means yes). */
export function wantsEmail(preferences: unknown): boolean {
  if (typeof preferences !== "object" || preferences === null) return true;
  return (preferences as Record<string, unknown>).emailNotifications !== false;
}

/**
 * Gather each person's new notifications into one email. Whatever arrived
 * since the last pass goes out together, so sixteen alerts at once are one
 * message, not sixteen.
 */
export async function queueNotificationEmails(
  db: Database,
  config: MailConfig,
  now = new Date(),
): Promise<number> {
  // Nothing to send with: mark what is waiting, so switching email on later
  // does not deliver a pile of old news.
  if (config.provider === "NONE") {
    await db.userNotification.updateMany({
      where: { emailStatusCode: null },
      data: { emailStatusCode: "SKIPPED" },
    });
    return 0;
  }
  const pending = await db.userNotification.findMany({
    where: { emailStatusCode: null },
    orderBy: { createdAt: "asc" },
    take: 500,
  });
  const byPerson = new Map<string, typeof pending>();
  for (const row of pending) {
    // Older than two days is history by now, not news.
    if (now.getTime() - row.createdAt.getTime() > 2 * 86_400_000) {
      await db.userNotification.update({
        where: { id: row.id },
        data: { emailStatusCode: "SKIPPED" },
      });
      continue;
    }
    byPerson.set(row.recipientUserId, [
      ...(byPerson.get(row.recipientUserId) ?? []),
      row,
    ]);
  }
  let queued = 0;
  for (const [userId, rows] of byPerson) {
    const ids = rows.map((row) => row.id);
    const [person, preference] = await Promise.all([
      db.appUser.findUnique({
        where: { id: userId },
        select: { active: true, emailNormalized: true, displayName: true },
      }),
      db.userPreference.findUnique({
        where: { userId },
        select: { preferences: true },
      }),
    ]);
    const address = person?.emailNormalized ?? "";
    if (
      !person?.active ||
      !address.includes("@") ||
      !wantsEmail(preference?.preferences)
    ) {
      await db.userNotification.updateMany({
        where: { id: { in: ids } },
        data: { emailStatusCode: "SKIPPED" },
      });
      continue;
    }
    const prefs = preference?.preferences as Record<string, unknown> | null;
    const email = notificationDigest({
      lang: prefs?.language === "ar" ? "ar" : "en",
      name: person.displayName,
      appUrl: config.appUrl,
      items: rows.map((row) => ({
        title: row.titleSafe,
        body: row.bodySafe,
        path: notificationPath(row.resourceTypeCode, row.resourceId),
      })),
    });
    await db.$transaction(async (tx) => {
      const message = await tx.emailMessage.create({
        data: {
          purposeCode: "NOTIFICATION",
          toAddresses: [address],
          subject: email.subject.slice(0, 250),
          bodyHtml: email.html,
          bodyText: email.text,
          resourceTypeCode: "USER",
          resourceId: userId,
        },
      });
      await tx.userNotification.updateMany({
        where: { id: { in: ids } },
        data: { emailStatusCode: "QUEUED", emailMessageId: message.id },
      });
    });
    queued += 1;
  }
  return queued;
}
