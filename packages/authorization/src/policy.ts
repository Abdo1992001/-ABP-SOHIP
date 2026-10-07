import type { AuthorizationContext, PermissionCode } from "@abp/contracts";

export interface ResourceScope {
  countryCode: string;
  ownerUserId?: string;
  sharedWithUserIds?: ReadonlySet<string>;
}

export type AuthorizationDecision =
  | { allowed: true }
  | {
      allowed: false;
      reason: "MISSING_PERMISSION" | "COUNTRY_SCOPE_DENIED" | "EXPLICIT_DENY";
    };

export function authorize(
  context: AuthorizationContext,
  requiredPermission: PermissionCode,
  resource: ResourceScope,
): AuthorizationDecision {
  // Country Scope is evaluated before ownership/share. Neither can widen it.
  if (!context.countryCodes.has(resource.countryCode.toUpperCase())) {
    return { allowed: false, reason: "COUNTRY_SCOPE_DENIED" };
  }

  if (!context.permissionCodes.has(requiredPermission)) {
    return { allowed: false, reason: "MISSING_PERMISSION" };
  }

  if (context.deniedPermissionCodes?.has(requiredPermission) === true) {
    return { allowed: false, reason: "EXPLICIT_DENY" };
  }

  return { allowed: true };
}
