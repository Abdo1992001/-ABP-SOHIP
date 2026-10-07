import { describe, expect, it } from "vitest";
import { screens } from "./screen-registry.ts";
import {
  VIEW_AS_ROLES,
  isRouteVisibleForRole,
  landingForRole,
  landingRoute,
  matrixRole,
  previewPermissions,
} from "./role-route-matrix.ts";

const registry = screens.map((screen) => ({
  route: screen.route,
  permission: screen.permission,
}));

/** Everything a sales manager holds, which is what View As starts from. */
const managerPermissions = [
  "sales.workspace.view",
  "accounts.view",
  "opportunities.view",
  "quotations.view",
  "targets.view",
  "sales.management.view",
  "reports.commercial.view",
];

describe("previewPermissions", () => {
  it("drops a permission whose only screens the role cannot reach", () => {
    // /targets and /sales/management are both DENY for SALES_USER, so a
    // manager previewing a salesperson must stop seeing the targets panel
    // and the management column -- which is the whole point of the preview.
    const preview = previewPermissions(
      managerPermissions,
      "SALES_USER",
      registry,
    );
    expect(preview).not.toContain("targets.view");
    expect(preview).not.toContain("sales.management.view");
  });

  it("keeps a permission a reachable screen still needs", () => {
    const preview = previewPermissions(
      managerPermissions,
      "SALES_USER",
      registry,
    );
    // A salesperson opens customers, opportunities and quotations.
    expect(preview).toContain("accounts.view");
    expect(preview).toContain("opportunities.view");
    expect(preview).toContain("quotations.view");
  });

  it("leaves a permission no screen asks for untouched", () => {
    // Panels gate on permissions that are not any screen's entry permission.
    // The matrix says nothing about those, so the preview must not guess.
    const preview = previewPermissions(
      [...managerPermissions, "accounts.edit"],
      "SALES_USER",
      registry,
    );
    expect(preview).toContain("accounts.edit");
  });

  it("previewing a manager changes nothing for a manager", () => {
    expect(
      previewPermissions(managerPermissions, "SALES_MANAGER", registry),
    ).toEqual(managerPermissions);
  });

  it("narrows a sales role to a logistics one", () => {
    const preview = previewPermissions(
      managerPermissions,
      "LOGISTICS",
      registry,
    );
    // Logistics has no customers, no opportunities, no quotations.
    expect(preview).not.toContain("accounts.view");
    expect(preview).not.toContain("opportunities.view");
    expect(preview).not.toContain("quotations.view");
  });

  it("never returns a permission that was not held to begin with", () => {
    for (const role of VIEW_AS_ROLES) {
      const preview = previewPermissions(
        managerPermissions,
        role.code,
        registry,
      );
      for (const permission of preview)
        expect(managerPermissions).toContain(permission);
    }
  });
});

describe("landingForRole", () => {
  it("sends each role to a screen that role can actually open", () => {
    for (const role of VIEW_AS_ROLES) {
      const landing = landingForRole(role.code);
      expect(
        isRouteVisibleForRole(landing, role.code),
        `${role.code} lands on ${landing}`,
      ).toBe(true);
    }
  });

  it("falls back to the home screen for a role it does not know", () => {
    expect(landingForRole("A_ROLE_ADDED_LATER")).toBe("/");
  });
});

/**
 * The permission sets the database actually seeds, read off the live roles.
 * Hand-invented sets would have hidden the bug this describes: four of the
 * seven seeded roles cannot open `/`, and all four were being landed on it.
 */
const SEEDED = {
  LOGISTICS_COORDINATOR: [
    "logistics.create",
    "logistics.edit",
    "logistics.export",
    "logistics.optimize",
    "logistics.plan",
    "logistics.validate",
    "logistics.view",
    "search.use",
    "shipments.create",
    "shipments.edit",
    "shipments.view",
  ],
  OPERATIONS_ANALYST: [
    "capacity.estimate",
    "capacity.manage",
    "capacity.view",
    "reports.commercial",
    "reports.finance",
    "reports.orders",
    "reports.pipeline",
    "reports.quotations",
    "search.use",
  ],
  FINANCE_ANALYST: [
    "cheques.create",
    "cheques.manage",
    "cheques.view",
    "finance.fx.edit",
    "finance.fx.view",
    "payments.allocate",
    "payments.create",
    "payments.view",
    "reports.commercial",
    "reports.finance",
    "reports.orders",
    "reports.pipeline",
    "reports.quotations",
    "search.use",
  ],
  R_AND_D: ["research.view"],
  SALES_REP: ["sales.workspace.view", "accounts.view", "quotations.view"],
  SALES_MANAGER: [
    "sales.workspace.view",
    "sales.management.view",
    "targets.view",
  ],
} as const;

describe("landingRoute", () => {
  it("never lands anyone on a screen they cannot open", () => {
    const held = new Set<string>();
    for (const [role, permissions] of Object.entries(SEEDED)) {
      const route = landingRoute(role, permissions, registry);
      const screen = registry.find((one) => one.route === route);
      expect(
        screen,
        `${role} landed on ${route}, which is not a screen`,
      ).toBeDefined();
      held.clear();
      for (const permission of permissions) held.add(permission);
      expect(
        screen?.permission === "authenticated" ||
          held.has(screen?.permission ?? ""),
        `${role} landed on ${route}, which needs ${String(screen?.permission)}`,
      ).toBe(true);
    }
  });

  it("sends a logistics coordinator to logistics, not to the sales overview", () => {
    // The old table was keyed on "LOGISTICS", a code the database does not
    // seed, so this person was dropped on `/` -- which needs
    // sales.workspace.view, which they do not have. They signed in to an
    // Access Denied screen.
    expect(
      landingRoute(
        "LOGISTICS_COORDINATOR",
        SEEDED.LOGISTICS_COORDINATOR,
        registry,
      ),
    ).toBe("/logistics/plans");
  });

  it("sends a finance analyst to finance and an operations analyst to capacity", () => {
    expect(
      landingRoute("FINANCE_ANALYST", SEEDED.FINANCE_ANALYST, registry),
    ).toBe("/finance/fx");
    expect(
      landingRoute("OPERATIONS_ANALYST", SEEDED.OPERATIONS_ANALYST, registry),
    ).toBe("/capacity");
  });

  it("keeps the sales roles on the commercial overview", () => {
    expect(landingRoute("SALES_REP", SEEDED.SALES_REP, registry)).toBe("/");
    expect(landingRoute("SALES_MANAGER", SEEDED.SALES_MANAGER, registry)).toBe(
      "/",
    );
  });

  it("finds a screen for a role nobody added to the table", () => {
    // R_AND_D is seeded and appears in neither the table nor the matrix, and
    // holds exactly one permission. It has to land on the screen that
    // permission opens, not on a denial.
    expect(landingRoute("R_AND_D", SEEDED.R_AND_D, registry)).toBe("/research");
  });

  it("lands a role holding nothing on a screen every signed-in person has", () => {
    // Not a denial and not a blank: the action queue asks for nothing beyond
    // being signed in, so it is the floor.
    const route = landingRoute("A_ROLE_WITH_NOTHING", [], registry);
    expect(registry.find((one) => one.route === route)?.permission).toBe(
      "authenticated",
    );
  });
});

describe("matrixRole", () => {
  it("reads a seeded role against the matrix column it means", () => {
    expect(matrixRole("SALES_REP")).toBe("SALES_USER");
    expect(matrixRole("LOGISTICS_COORDINATOR")).toBe("LOGISTICS");
    expect(matrixRole("FINANCE_ANALYST")).toBe("FINANCE");
  });

  it("leaves a role that is already a column alone", () => {
    expect(matrixRole("SALES_MANAGER")).toBe("SALES_MANAGER");
    expect(matrixRole("SYSTEM_ADMIN")).toBe("SYSTEM_ADMIN");
  });

  it("makes the matrix answer for a seeded role at all", () => {
    // Previously every lookup for SALES_REP missed the matrix and defaulted to
    // visible, so previewing a sales rep hid nothing.
    expect(isRouteVisibleForRole("/targets", "SALES_REP")).toBe(false);
    expect(isRouteVisibleForRole("/customers", "SALES_REP")).toBe(true);
    expect(isRouteVisibleForRole("/customers", "LOGISTICS_COORDINATOR")).toBe(
      false,
    );
  });
});
