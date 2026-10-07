import type { Prisma } from "@abp/database";

/**
 * The one place a notification is created.
 *
 * The settings screen had four notification switches that saved to the
 * preferences blob and were read by nothing — a control that does not control
 * anything, which is worse than no control, because the user believes they
 * have turned something off. This makes the preference real: every producer
 * goes through here, and here is where the recipient's choice is honoured.
 *
 * Categories are the notification type codes the system actually emits. There
 * is no "email" category because there is no mailer in this system; a switch
 * for it would be the same fiction in a new place.
 */

/** Types a person may silence. */
export const OPTIONAL_NOTIFICATION_TYPES = [
  "QUOTATION_ACCEPTED",
  "SHIPMENT_UPDATE",
  "OVERDUE_TASK",
  "AI_INSIGHT",
  "REPEAT_BUSINESS_REQUEST",
  "CUSTOMER_FEEDBACK",
  // Raised by the worker's alert scanner when something becomes late.
  "PAYMENT_OVERDUE",
  "PRODUCTION_AT_RISK",
  "DELIVERY_LATE",
  "FEEDBACK_REQUEST",
  "QUOTATION_EXPIRING",
] as const;

/**
 * Types that arrive whatever the preference says.
 *
 * An approval request is somebody waiting on this person to make a decision;
 * silencing it does not make the decision go away, it just makes the deal sit.
 * The settings screen shows this as always-on rather than as a switch that
 * quietly does nothing.
 */
export const MANDATORY_NOTIFICATION_TYPES = [
  "APPROVAL_NEEDED",
  // A customer who said it is critical is waiting on someone; muting that
  // does not make them wait less.
  "CRITICAL_FEEDBACK",
  // An email the system could not deliver -- a quotation that never reached
  // the customer -- has to be known to the person who sent it.
  "EMAIL_UNDELIVERED",
  // Backups failing is how data gets lost: administrators cannot mute it.
  "BACKUP_PROBLEM",
  // An order booked for a customer who is late paying: the salesperson and
  // the manager must both know, with the reason given.
  "CREDIT_OVERRIDE",
] as const;

export type NotificationTypeCode =
  | (typeof OPTIONAL_NOTIFICATION_TYPES)[number]
  | (typeof MANDATORY_NOTIFICATION_TYPES)[number];

function isMandatory(typeCode: string): boolean {
  return (MANDATORY_NOTIFICATION_TYPES as readonly string[]).includes(typeCode);
}

/**
 * Whether this person wants this kind of notification.
 *
 * Absent means yes: a new category should reach people until they say
 * otherwise, and someone who has never opened Settings should not silently
 * miss things.
 */
export function wantsNotification(
  preferences: unknown,
  typeCode: string,
): boolean {
  if (isMandatory(typeCode)) return true;
  if (typeof preferences !== "object" || preferences === null) return true;
  const muted = (preferences as Record<string, unknown>).mutedNotifications;
  if (!Array.isArray(muted)) return true;
  return !muted.includes(typeCode);
}

interface NotifyInput {
  recipientUserId: string;
  typeCode: NotificationTypeCode;
  titleSafe: string;
  bodySafe: string;
  resourceTypeCode?: string;
  resourceId?: string;
  actionCode?: string;
}

/**
 * Create a notification unless its recipient has muted that category.
 *
 * Takes the transaction client so a notification is written in the same
 * transaction as the thing it is about: a deal that rolls back must not leave
 * a notification behind telling someone it happened.
 */
export async function notify(
  tx: Prisma.TransactionClient,
  input: NotifyInput,
): Promise<boolean> {
  const preference = await tx.userPreference.findUnique({
    where: { userId: input.recipientUserId },
    select: { preferences: true },
  });
  if (!wantsNotification(preference?.preferences, input.typeCode)) return false;
  await tx.userNotification.create({
    data: {
      recipientUserId: input.recipientUserId,
      typeCode: input.typeCode,
      titleSafe: input.titleSafe,
      bodySafe: input.bodySafe,
      ...(input.resourceTypeCode === undefined
        ? {}
        : { resourceTypeCode: input.resourceTypeCode }),
      ...(input.resourceId === undefined
        ? {}
        : { resourceId: input.resourceId }),
      ...(input.actionCode === undefined
        ? {}
        : { actionCode: input.actionCode }),
    },
  });
  return true;
}

/**
 * Who manages this person: their own manager, or -- when none is set --
 * everyone holding the Sales Manager role. Never the person themselves.
 */
export async function managersOf(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<string[]> {
  const profile = await tx.userProfile.findUnique({
    where: { userId },
    select: { managerUserId: true },
  });
  if (profile?.managerUserId) return [profile.managerUserId];
  const rows = await tx.$queryRaw<{ user_id: string }[]>`
    SELECT DISTINCT ur.user_id FROM user_roles ur
      JOIN roles r ON r.id = ur.role_id
      JOIN app_users u ON u.id = ur.user_id
     WHERE r.code = 'SALES_MANAGER' AND u.active`;
  return rows.map((row) => row.user_id).filter((id) => id !== userId);
}
