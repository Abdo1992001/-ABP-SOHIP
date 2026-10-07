import { describe, expect, it } from "vitest";
import { permissions } from "@abp/contracts";
import type { CustomerIdentity } from "./customer-auth.js";
import { accountAccessWhere } from "./account-scope.js";

/**
 * Who may reach a customer record.
 *
 * This was three functions, and the two that were not this one had each lost
 * part of the policy. The losses were invisible until somebody pressed a
 * button: a manager typing an address into a customer their own salesperson
 * owned got a 404, and the segments panel 404'd for everyone but the owner.
 *
 * So each branch is asserted here by the shape it produces, because a branch
 * that silently disappears is exactly how this broke.
 */

const identity = (over: Partial<CustomerIdentity> = {}): CustomerIdentity =>
  ({
    userId: "u-1",
    managerUserId: null,
    teamId: null,
    sessionId: "s-1",
    roles: [
      { roleId: "r", code: "SALES_REP", name: "Sales rep", workspace: "SALES" },
    ],
    workspaces: new Set(["SALES"]),
    permissions: new Set<string>(),
    deniedPermissions: new Set<string>(),
    countryCodes: new Set(["EG"]),
    policyVersion: 1,
    traceId: "t",
    correlationId: "c",
    ...over,
  }) as CustomerIdentity;

const admin = identity({
  roles: [
    {
      roleId: "r",
      code: "SYSTEM_ADMIN",
      name: "System admin",
      workspace: "SALES",
    },
  ],
});

const manager = identity({
  roles: [
    {
      roleId: "r",
      code: "SALES_MANAGER",
      name: "Sales manager",
      workspace: "SALES",
    },
  ],
  permissions: new Set([permissions.salesManagementView]),
});

/** Does this clause let in anybody at all, or name a specific person? */
const branches = (clauses: readonly unknown[]) =>
  clauses.map((clause) => JSON.stringify(clause));

describe("accountAccessWhere", () => {
  it("lets a system administrator reach every record", () => {
    // An administrator who cannot edit a record they do not own cannot do the
    // one job the role exists for.
    for (const level of ["VIEW", "COLLABORATE_EDIT"] as const) {
      const clauses = accountAccessWhere(admin, level);
      expect(clauses).toHaveLength(1);
      expect(JSON.stringify(clauses[0])).not.toContain("u-1");
    }
  });

  it("lets a manager reach what their own reports own", () => {
    const clauses = branches(accountAccessWhere(manager, "COLLABORATE_EDIT"));
    expect(clauses.some((c) => c.includes("managerUserId"))).toBe(true);
  });

  it("does not give a salesperson their colleagues' records", () => {
    const clauses = branches(
      accountAccessWhere(identity(), "COLLABORATE_EDIT"),
    );
    expect(clauses.some((c) => c.includes("managerUserId"))).toBe(false);
  });

  it("always includes the owner", () => {
    for (const who of [identity(), manager])
      for (const level of ["VIEW", "COLLABORATE_EDIT"] as const)
        expect(
          branches(accountAccessWhere(who, level)).some((c) =>
            c.includes('"ownerUserId":"u-1"'),
          ),
        ).toBe(true);
  });

  it("reads a view share only for viewing", () => {
    const viewing = JSON.stringify(accountAccessWhere(identity(), "VIEW"));
    const editing = JSON.stringify(
      accountAccessWhere(identity(), "COLLABORATE_EDIT"),
    );
    expect(viewing).toContain("VIEW");
    // A record shared read-only must not become editable.
    expect(editing).toContain("COLLABORATE_EDIT");
    expect(editing).not.toMatch(/"VIEW"/);
  });

  it("ignores a share that has expired", () => {
    expect(JSON.stringify(accountAccessWhere(identity(), "VIEW"))).toContain(
      "expiresAt",
    );
  });

  it("wants an active share, not any share", () => {
    expect(JSON.stringify(accountAccessWhere(identity(), "VIEW"))).toContain(
      "ACTIVE",
    );
  });

  it("never returns an empty clause, which Prisma reads as matching nothing", () => {
    for (const who of [admin, manager, identity()])
      for (const level of ["VIEW", "COLLABORATE_EDIT"] as const) {
        const clauses = accountAccessWhere(who, level);
        expect(clauses.length).toBeGreaterThan(0);
        for (const clause of clauses)
          expect(Object.keys(clause as object).length).toBeGreaterThan(0);
      }
  });
});
