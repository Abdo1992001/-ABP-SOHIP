import { describe, expect, it } from "vitest";
import { permissions, type AuthorizationContext } from "@abp/contracts";
import { authorize } from "./policy.js";

const context: AuthorizationContext = {
  userId: "user-1",
  permissionCodes: new Set([permissions.salesWorkspaceView]),
  countryCodes: new Set(["EG"]),
  policyVersion: "test-v1",
};

describe("authorize", () => {
  it("allows a permission inside Country Scope", () => {
    expect(
      authorize(context, permissions.salesWorkspaceView, { countryCode: "eg" }),
    ).toEqual({ allowed: true });
  });

  it("denies a shared or owned record outside Country Scope", () => {
    expect(
      authorize(context, permissions.salesWorkspaceView, {
        countryCode: "AE",
        ownerUserId: context.userId,
        sharedWithUserIds: new Set([context.userId]),
      }),
    ).toEqual({ allowed: false, reason: "COUNTRY_SCOPE_DENIED" });
  });

  it("denies when the permission is missing", () => {
    expect(
      authorize(context, permissions.logisticsPlan, { countryCode: "EG" }),
    ).toEqual({
      allowed: false,
      reason: "MISSING_PERMISSION",
    });
  });

  it("lets an explicit deny win after country and permission checks", () => {
    expect(
      authorize(
        {
          ...context,
          deniedPermissionCodes: new Set([permissions.salesWorkspaceView]),
        },
        permissions.salesWorkspaceView,
        { countryCode: "EG" },
      ),
    ).toEqual({ allowed: false, reason: "EXPLICIT_DENY" });
  });
});
