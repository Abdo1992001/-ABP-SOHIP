import type { Prisma } from "@abp/database";
import { permissions } from "@abp/contracts";
import type { CustomerIdentity } from "./customer-auth.js";

export function isSystemAdmin(identity: CustomerIdentity): boolean {
  return identity.roles.some(({ code }) => code === "SYSTEM_ADMIN");
}

export function hasWorkspace(
  identity: CustomerIdentity,
  workspace: string,
): boolean {
  return isSystemAdmin(identity) || identity.workspaces.has(workspace);
}

/** A reporting line is context, never a blanket CRM grant. */
export function canUseManagerContext(identity: CustomerIdentity): boolean {
  return (
    hasWorkspace(identity, "SALES") &&
    identity.permissions.has(permissions.salesManagementView) &&
    identity.roles.some(({ code }) => code === "SALES_MANAGER")
  );
}

/**
 * Who may see, and who may change, a customer record.
 *
 * One policy, in one place, because there were three of it. This is the full
 * one; the two copies it replaces were each missing parts of it, and each
 * missing part was a person being told a record does not exist when it plainly
 * does:
 *
 *   * `editableRecordWhere` on the PATCH listed only the owner and a share, so
 *     a manager could open a customer their own salesperson owned, press Edit,
 *     type an address and get a 404 -- and an administrator, whose job is to
 *     fix that kind of data, could not edit any record they did not own;
 *   * the segments panel's own copy dropped the administrator, the manager
 *     *and* the access level, so the panel 404'd for everyone but the owner.
 *
 * Other services still carry their own scope expressions. They are not touched
 * here: broadening who may read or write a record is a decision to take
 * deliberately, one service at a time, not in a sweep.
 */
export function accountAccessWhere(
  identity: CustomerIdentity,
  accessLevel: "VIEW" | "COLLABORATE_EDIT",
): Prisma.AccountWhereInput[] {
  // `[{}]` inside an `OR` array matches nothing in Prisma, not everything —
  // `{ id: { not: "00000000-0000-0000-0000-000000000000" } }` is the always-true fix.
  if (isSystemAdmin(identity))
    return [{ id: { not: "00000000-0000-0000-0000-000000000000" } }];
  const userId = identity.userId;
  const now = new Date();
  const levels =
    accessLevel === "VIEW"
      ? ["VIEW", "COLLABORATE_EDIT"]
      : ["COLLABORATE_EDIT"];
  return [
    { ownerUserId: userId },
    ...(canUseManagerContext(identity)
      ? [{ owner: { profile: { is: { managerUserId: userId } } } }]
      : []),
    {
      shares: {
        some: {
          recipientUserId: userId,
          statusCode: "ACTIVE",
          accessLevelCode: { in: levels },
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
      },
    },
  ];
}
