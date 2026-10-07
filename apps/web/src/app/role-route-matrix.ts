/**
 * Static mirror of ROLE_ROUTE_MATRIX.md, used only to drive the "View As"
 * navigation preview. This never gates real access — the backend remains the
 * sole source of truth for permissions; this only decides which nav items a
 * previewed role would normally see, so a manager can sanity-check the menu
 * shape without impersonating anyone.
 */
export type MatrixVerdict = "ALLOW" | "CONTEXT_ONLY" | "DENY";

/**
 * The roles that exist, by the codes the database seeds -- so the preview can
 * ask the server what each one really grants. "Sales User B" and "Sales
 * Support" were design columns with no role behind them, and previewing a role
 * nobody has is previewing nothing.
 */
export const VIEW_AS_ROLES: readonly {
  code: string;
  label: { en: string; ar: string };
}[] = [
  { code: "SALES_MANAGER", label: { en: "Sales Manager", ar: "مدير مبيعات" } },
  { code: "SALES_REP", label: { en: "Sales User", ar: "مندوب مبيعات" } },
  {
    code: "LOGISTICS_COORDINATOR",
    label: { en: "Logistics", ar: "اللوجستيات" },
  },
  { code: "OPERATIONS_ANALYST", label: { en: "Operations", ar: "العمليات" } },
  { code: "FINANCE_ANALYST", label: { en: "Finance", ar: "المالية" } },
  { code: "QUALITY_ENGINEER", label: { en: "Quality", ar: "الجودة" } },
  { code: "R_AND_D", label: { en: "R&D", ar: "البحث والتطوير" } },
];

const ROLE_COLUMNS = [
  "SYSTEM_ADMIN",
  "SALES_MANAGER",
  "SALES_USER",
  "SALES_USER_B",
  "SALES_SUPPORT",
  "LOGISTICS",
  "OPERATIONS",
  "FINANCE",
] as const;

// One row per matrix line, columns aligned to ROLE_COLUMNS above.
const ROWS: readonly [string, ...MatrixVerdict[]][] = [
  ["/", "ALLOW", "ALLOW", "ALLOW", "ALLOW", "ALLOW", "DENY", "DENY", "DENY"],
  [
    "/approvals",
    "ALLOW",
    "ALLOW",
    "CONTEXT_ONLY",
    "CONTEXT_ONLY",
    "DENY",
    "DENY",
    "DENY",
    "DENY",
  ],
  [
    "/today",
    "ALLOW",
    "ALLOW",
    "ALLOW",
    "ALLOW",
    "ALLOW",
    "DENY",
    "DENY",
    "DENY",
  ],
  [
    "/search",
    "ALLOW",
    "ALLOW",
    "CONTEXT_ONLY",
    "CONTEXT_ONLY",
    "CONTEXT_ONLY",
    "CONTEXT_ONLY",
    "CONTEXT_ONLY",
    "CONTEXT_ONLY",
  ],
  [
    "/customers",
    "ALLOW",
    "CONTEXT_ONLY",
    "CONTEXT_ONLY",
    "CONTEXT_ONLY",
    "CONTEXT_ONLY",
    "DENY",
    "DENY",
    "DENY",
  ],
  [
    "/customers/:accountId",
    "ALLOW",
    "CONTEXT_ONLY",
    "CONTEXT_ONLY",
    "CONTEXT_ONLY",
    "CONTEXT_ONLY",
    "DENY",
    "DENY",
    "DENY",
  ],
  [
    "/contacts",
    "ALLOW",
    "CONTEXT_ONLY",
    "CONTEXT_ONLY",
    "CONTEXT_ONLY",
    "CONTEXT_ONLY",
    "DENY",
    "DENY",
    "DENY",
  ],
  [
    "/contacts/:contactId",
    "ALLOW",
    "CONTEXT_ONLY",
    "CONTEXT_ONLY",
    "CONTEXT_ONLY",
    "CONTEXT_ONLY",
    "DENY",
    "DENY",
    "DENY",
  ],
  [
    "/projects",
    "ALLOW",
    "CONTEXT_ONLY",
    "CONTEXT_ONLY",
    "CONTEXT_ONLY",
    "CONTEXT_ONLY",
    "DENY",
    "DENY",
    "DENY",
  ],
  [
    "/projects/:projectId",
    "ALLOW",
    "CONTEXT_ONLY",
    "CONTEXT_ONLY",
    "CONTEXT_ONLY",
    "CONTEXT_ONLY",
    "DENY",
    "DENY",
    "DENY",
  ],
  [
    "/opportunities",
    "ALLOW",
    "CONTEXT_ONLY",
    "CONTEXT_ONLY",
    "CONTEXT_ONLY",
    "DENY",
    "DENY",
    "DENY",
    "DENY",
  ],
  [
    "/opportunities/:opportunityId",
    "ALLOW",
    "CONTEXT_ONLY",
    "CONTEXT_ONLY",
    "CONTEXT_ONLY",
    "DENY",
    "DENY",
    "DENY",
    "DENY",
  ],
  [
    "/activities",
    "ALLOW",
    "CONTEXT_ONLY",
    "CONTEXT_ONLY",
    "CONTEXT_ONLY",
    "DENY",
    "DENY",
    "DENY",
    "DENY",
  ],
  [
    "/activities/calendar",
    "ALLOW",
    "CONTEXT_ONLY",
    "CONTEXT_ONLY",
    "CONTEXT_ONLY",
    "DENY",
    "DENY",
    "DENY",
    "DENY",
  ],
  [
    "/products",
    "ALLOW",
    "ALLOW",
    "ALLOW",
    "ALLOW",
    "DENY",
    "DENY",
    "ALLOW",
    "DENY",
  ],
  [
    "/quotations",
    "ALLOW",
    "CONTEXT_ONLY",
    "CONTEXT_ONLY",
    "CONTEXT_ONLY",
    "DENY",
    "DENY",
    "DENY",
    "DENY",
  ],
  [
    "/quotations/:quotationId",
    "ALLOW",
    "CONTEXT_ONLY",
    "CONTEXT_ONLY",
    "CONTEXT_ONLY",
    "DENY",
    "DENY",
    "DENY",
    "DENY",
  ],
  [
    "/customer-orders",
    "ALLOW",
    "ALLOW",
    "ALLOW",
    "ALLOW",
    "ALLOW",
    "CONTEXT_ONLY",
    "CONTEXT_ONLY",
    "CONTEXT_ONLY",
  ],
  [
    "/customer-orders/:customerOrderId",
    "ALLOW",
    "ALLOW",
    "ALLOW",
    "ALLOW",
    "ALLOW",
    "CONTEXT_ONLY",
    "CONTEXT_ONLY",
    "CONTEXT_ONLY",
  ],
  [
    "/finance/receivables",
    "ALLOW",
    "CONTEXT_ONLY",
    "DENY",
    "DENY",
    "DENY",
    "DENY",
    "DENY",
    "ALLOW",
  ],
  [
    "/orders",
    "ALLOW",
    "CONTEXT_ONLY",
    "DENY",
    "DENY",
    "DENY",
    "CONTEXT_ONLY",
    "DENY",
    "DENY",
  ],
  [
    "/orders/:salesOrderId",
    "ALLOW",
    "CONTEXT_ONLY",
    "DENY",
    "DENY",
    "DENY",
    "CONTEXT_ONLY",
    "DENY",
    "DENY",
  ],
  [
    "/capacity",
    "ALLOW",
    "DENY",
    "DENY",
    "DENY",
    "DENY",
    "DENY",
    "ALLOW",
    "DENY",
  ],
  [
    "/capacity/estimates/:estimateId",
    "ALLOW",
    "DENY",
    "DENY",
    "DENY",
    "DENY",
    "DENY",
    "ALLOW",
    "DENY",
  ],
  [
    "/logistics/plans",
    "ALLOW",
    "CONTEXT_ONLY",
    "CONTEXT_ONLY",
    "CONTEXT_ONLY",
    "DENY",
    "CONTEXT_ONLY",
    "DENY",
    "DENY",
  ],
  [
    "/logistics/plans/:planId",
    "ALLOW",
    "CONTEXT_ONLY",
    "CONTEXT_ONLY",
    "CONTEXT_ONLY",
    "DENY",
    "CONTEXT_ONLY",
    "DENY",
    "DENY",
  ],
  [
    "/customer-feedback",
    "ALLOW",
    "ALLOW",
    "ALLOW",
    "ALLOW",
    "ALLOW",
    "CONTEXT_ONLY",
    "CONTEXT_ONLY",
    "DENY",
  ],
  [
    "/customer-feedback/:feedbackId",
    "ALLOW",
    "ALLOW",
    "ALLOW",
    "ALLOW",
    "ALLOW",
    "CONTEXT_ONLY",
    "CONTEXT_ONLY",
    "DENY",
  ],
  ["/map", "ALLOW", "ALLOW", "ALLOW", "ALLOW", "ALLOW", "DENY", "DENY", "DENY"],
  [
    "/work-orders",
    "ALLOW",
    "CONTEXT_ONLY",
    "CONTEXT_ONLY",
    "CONTEXT_ONLY",
    "DENY",
    "CONTEXT_ONLY",
    "ALLOW",
    "DENY",
  ],
  [
    "/work-orders/:workOrderId",
    "ALLOW",
    "CONTEXT_ONLY",
    "CONTEXT_ONLY",
    "CONTEXT_ONLY",
    "DENY",
    "CONTEXT_ONLY",
    "ALLOW",
    "DENY",
  ],
  [
    "/operations/production-schedule",
    "ALLOW",
    "CONTEXT_ONLY",
    "DENY",
    "DENY",
    "DENY",
    "CONTEXT_ONLY",
    "ALLOW",
    "DENY",
  ],
  [
    "/logistics/delivery-calendar",
    "ALLOW",
    "CONTEXT_ONLY",
    "DENY",
    "DENY",
    "DENY",
    "ALLOW",
    "CONTEXT_ONLY",
    "DENY",
  ],
  [
    "/shipments",
    "ALLOW",
    "DENY",
    "DENY",
    "DENY",
    "DENY",
    "CONTEXT_ONLY",
    "DENY",
    "DENY",
  ],
  [
    "/shipments/:shipmentId",
    "ALLOW",
    "DENY",
    "DENY",
    "DENY",
    "DENY",
    "CONTEXT_ONLY",
    "DENY",
    "DENY",
  ],
  [
    "/finance/fx",
    "ALLOW",
    "DENY",
    "DENY",
    "DENY",
    "DENY",
    "DENY",
    "DENY",
    "ALLOW",
  ],
  [
    "/finance/payments",
    "ALLOW",
    "DENY",
    "DENY",
    "DENY",
    "DENY",
    "DENY",
    "DENY",
    "CONTEXT_ONLY",
  ],
  [
    "/finance/payments/:paymentId",
    "ALLOW",
    "DENY",
    "DENY",
    "DENY",
    "DENY",
    "DENY",
    "DENY",
    "CONTEXT_ONLY",
  ],
  [
    "/finance/cheques",
    "ALLOW",
    "DENY",
    "DENY",
    "DENY",
    "DENY",
    "DENY",
    "DENY",
    "CONTEXT_ONLY",
  ],
  [
    "/returns",
    "ALLOW",
    "DENY",
    "DENY",
    "DENY",
    "DENY",
    "DENY",
    "DENY",
    "CONTEXT_ONLY",
  ],
  [
    "/returns/:caseId",
    "ALLOW",
    "DENY",
    "DENY",
    "DENY",
    "DENY",
    "DENY",
    "DENY",
    "CONTEXT_ONLY",
  ],
  [
    "/data/imports",
    "ALLOW",
    "DENY",
    "DENY",
    "DENY",
    "ALLOW",
    "DENY",
    "DENY",
    "DENY",
  ],
  [
    "/data/imports/:jobId",
    "ALLOW",
    "DENY",
    "DENY",
    "DENY",
    "ALLOW",
    "DENY",
    "DENY",
    "DENY",
  ],
  [
    "/data/quality",
    "ALLOW",
    "DENY",
    "DENY",
    "DENY",
    "ALLOW",
    "DENY",
    "DENY",
    "DENY",
  ],
  [
    "/data/reconciliation",
    "ALLOW",
    "DENY",
    "DENY",
    "DENY",
    "ALLOW",
    "DENY",
    "DENY",
    "DENY",
  ],
  [
    "/documents",
    "ALLOW",
    "ALLOW",
    "CONTEXT_ONLY",
    "CONTEXT_ONLY",
    "ALLOW",
    "CONTEXT_ONLY",
    "DENY",
    "CONTEXT_ONLY",
  ],
  [
    "/reports",
    "ALLOW",
    "ALLOW",
    "CONTEXT_ONLY",
    "CONTEXT_ONLY",
    "DENY",
    "DENY",
    "ALLOW",
    "CONTEXT_ONLY",
  ],
  [
    "/targets",
    "ALLOW",
    "ALLOW",
    "DENY",
    "DENY",
    "DENY",
    "DENY",
    "DENY",
    "DENY",
  ],
  [
    "/ai/brief",
    "ALLOW",
    "ALLOW",
    "DENY",
    "DENY",
    "DENY",
    "DENY",
    "DENY",
    "DENY",
  ],
  [
    "/complaints",
    "ALLOW",
    "CONTEXT_ONLY",
    "DENY",
    "DENY",
    "DENY",
    "DENY",
    "CONTEXT_ONLY",
    "DENY",
  ],
  [
    "/complaints/:complaintId",
    "ALLOW",
    "CONTEXT_ONLY",
    "DENY",
    "DENY",
    "DENY",
    "DENY",
    "CONTEXT_ONLY",
    "DENY",
  ],
  [
    "/research",
    "ALLOW",
    "ALLOW",
    "DENY",
    "DENY",
    "DENY",
    "DENY",
    "DENY",
    "DENY",
  ],
  [
    "/notifications",
    "ALLOW",
    "ALLOW",
    "ALLOW",
    "ALLOW",
    "ALLOW",
    "ALLOW",
    "ALLOW",
    "ALLOW",
  ],
  [
    "/actions",
    "ALLOW",
    "ALLOW",
    "ALLOW",
    "ALLOW",
    "ALLOW",
    "ALLOW",
    "ALLOW",
    "ALLOW",
  ],
  [
    "/messages",
    "ALLOW",
    "ALLOW",
    "ALLOW",
    "ALLOW",
    "ALLOW",
    "ALLOW",
    "ALLOW",
    "ALLOW",
  ],
  [
    "/settings",
    "ALLOW",
    "ALLOW",
    "ALLOW",
    "ALLOW",
    "ALLOW",
    "ALLOW",
    "ALLOW",
    "ALLOW",
  ],
  [
    "/profile",
    "ALLOW",
    "ALLOW",
    "ALLOW",
    "ALLOW",
    "ALLOW",
    "ALLOW",
    "ALLOW",
    "ALLOW",
  ],
  [
    "/people",
    "ALLOW",
    "ALLOW",
    "ALLOW",
    "ALLOW",
    "ALLOW",
    "ALLOW",
    "ALLOW",
    "ALLOW",
  ],
  [
    "/sales/management",
    "ALLOW",
    "ALLOW",
    "DENY",
    "DENY",
    "DENY",
    "DENY",
    "DENY",
    "DENY",
  ],
  [
    "/sales/support",
    "ALLOW",
    "DENY",
    "DENY",
    "DENY",
    "ALLOW",
    "DENY",
    "DENY",
    "DENY",
  ],
  [
    "/intelligence/market-signals",
    "ALLOW",
    "ALLOW",
    "DENY",
    "DENY",
    "DENY",
    "DENY",
    "DENY",
    "DENY",
  ],
  [
    "/intelligence/target-markets",
    "ALLOW",
    "ALLOW",
    "DENY",
    "DENY",
    "DENY",
    "DENY",
    "DENY",
    "DENY",
  ],
  [
    "/intelligence/target-accounts",
    "ALLOW",
    "ALLOW",
    "DENY",
    "DENY",
    "DENY",
    "DENY",
    "DENY",
    "DENY",
  ],
  [
    "/intelligence/competitors",
    "ALLOW",
    "ALLOW",
    "DENY",
    "DENY",
    "DENY",
    "DENY",
    "DENY",
    "DENY",
  ],
  [
    "/intelligence/watchlist",
    "ALLOW",
    "ALLOW",
    "DENY",
    "DENY",
    "DENY",
    "DENY",
    "DENY",
    "DENY",
  ],
  [
    "/repeat-business",
    "ALLOW",
    "ALLOW",
    "DENY",
    "DENY",
    "DENY",
    "DENY",
    "DENY",
    "DENY",
  ],
];

const MATRIX: Record<
  string,
  Partial<Record<(typeof ROLE_COLUMNS)[number], MatrixVerdict>>
> = Object.fromEntries(
  ROWS.map(([route, ...verdicts]) => [
    route,
    Object.fromEntries(ROLE_COLUMNS.map((role, i) => [role, verdicts[i]])),
  ]),
);

/** Admin-only routes (not in ROWS above) are always DENY when previewing a non-admin role. */
const ADMIN_ONLY_PREFIXES = ["/admin/"];

/**
 * The seeded roles against the matrix's own column names.
 *
 * ROLE_ROUTE_MATRIX.md was written with the role names the design used --
 * "Sales User", "Logistics", "Finance" -- and the database was seeded with the
 * names the organisation uses: SALES_REP, LOGISTICS_COORDINATOR,
 * FINANCE_ANALYST. Nothing reconciled the two, so every lookup for a real
 * non-manager role missed the matrix entirely and fell through to "visible".
 *
 * Written down once, here, rather than in each caller.
 */
export const ROLE_CODE_ALIASES: Readonly<Record<string, string>> = {
  SALES_REP: "SALES_USER",
  LOGISTICS_COORDINATOR: "LOGISTICS",
  OPERATIONS_ANALYST: "OPERATIONS",
  FINANCE_ANALYST: "FINANCE",
  // Quality works the factory side: the operations column, minus the planning.
  QUALITY_ENGINEER: "OPERATIONS",
};

/** The matrix column a role reads from, whichever of its two names is used. */
export function matrixRole(roleCode: string): string {
  return ROLE_CODE_ALIASES[roleCode] ?? roleCode;
}

export function isRouteVisibleForRole(
  route: string,
  roleCode: string,
): boolean {
  if (ADMIN_ONLY_PREFIXES.some((prefix) => route.startsWith(prefix))) {
    return roleCode === "SYSTEM_ADMIN";
  }
  const column = matrixRole(roleCode);
  const verdict = MATRIX[route]?.[column as (typeof ROLE_COLUMNS)[number]];
  // Unmapped/new routes default to visible so View As never hides screens
  // the matrix simply hasn't been updated for yet.
  return verdict === undefined ? true : verdict !== "DENY";
}

/**
 * What a previewed role would see, not just which menu items it would have.
 *
 * "View as" filtered the sidebar and nothing else, so a manager switched to
 * Sales User, watched four menu items disappear, and then read exactly the same
 * dashboard — the targets panel, the team figures, the management column all
 * still there. That is the complaint that the view does not actually change,
 * and it is accurate: the previewed role never reached a single screen.
 *
 * Screens already declare the permission they need, and the matrix already says
 * which screens a role can reach. Between them they say what a role can see, so
 * a permission is dropped from the preview when *every* screen that needs it is
 * denied to that role. Any permission a reachable screen still needs survives,
 * which is what keeps the preview from stripping a role back to nothing.
 *
 * This is a preview and only a preview. The server holds the real permissions
 * and is unaffected — a manager previewing a salesperson still has a manager's
 * access, and the banner on screen says so.
 */
export function previewPermissions(
  permissions: readonly string[],
  roleCode: string,
  screens: readonly { route: string; permission: string }[],
): string[] {
  /** Permissions that some screen this role can still open depends on. */
  const reachable = new Set(
    screens
      .filter((screen) => isRouteVisibleForRole(screen.route, roleCode))
      .map((screen) => screen.permission),
  );
  /** Every permission any screen asks for, so unscreened ones are left alone. */
  const screened = new Set(screens.map((screen) => screen.permission));
  return permissions.filter(
    (permission) => reachable.has(permission) || !screened.has(permission),
  );
}

/**
 * Where a previewed role opens.
 *
 * A role whose home screen is denied to it has to land somewhere, and the
 * somewhere is the screen that role actually starts its day on — the same
 * table the real sign-in landing uses, so the preview and the real thing
 * cannot disagree.
 */
export const ROLE_LANDING: Readonly<Record<string, string>> = {
  SYSTEM_ADMIN: "/",
  SALES_MANAGER: "/",
  SALES_USER: "/",
  SALES_USER_B: "/",
  SALES_SUPPORT: "/sales/support",
  LOGISTICS: "/logistics/plans",
  OPERATIONS: "/capacity",
  FINANCE: "/finance/fx",
  // Keyed by the role itself: it shares the operations column, not its desk.
  QUALITY_ENGINEER: "/complaints",
};

export function landingForRole(roleCode: string): string {
  return ROLE_LANDING[roleCode] ?? ROLE_LANDING[matrixRole(roleCode)] ?? "/";
}

/** Screens that are somebody's own business, never a place to be dropped. */
const NOT_A_HOME = ["/settings", "/profile", "/notifications", "/messages"];

/**
 * Where a person lands when they sign in.
 *
 * This was a table of role codes that did not exist. The database seeds
 * SALES_REP, LOGISTICS_COORDINATOR, OPERATIONS_ANALYST and FINANCE_ANALYST;
 * the table was keyed on SALES_USER, LOGISTICS, OPERATIONS and FINANCE, so no
 * lookup ever hit and everybody was dropped on `/`. For four of the seven
 * roles `/` needs a permission they do not have, so a Logistics Coordinator, an
 * Operations Analyst, a Finance Analyst and an R&D user each signed in to an
 * Access Denied screen.
 *
 * The aliases fix the lookup. The fallback is what stops it happening again:
 * whatever the table says, the landing has to be a screen this person can
 * actually open, so it is checked against their permissions and, failing that,
 * the first screen in the registry that they can. A role nobody thought to add
 * to the table now lands somewhere useful rather than nowhere.
 */
export function landingRoute(
  roleCode: string,
  permissions: readonly string[],
  screens: readonly { route: string; permission: string }[],
): string {
  const held = new Set(permissions);
  const canOpen = (route: string) => {
    const screen = screens.find((one) => one.route === route);
    if (screen === undefined) return false;
    return screen.permission === "authenticated" || held.has(screen.permission);
  };
  const preferred =
    ROLE_LANDING[roleCode] ?? ROLE_LANDING[matrixRole(roleCode)];
  if (preferred !== undefined && canOpen(preferred)) return preferred;
  const candidates = screens.filter(
    (screen) =>
      !screen.route.includes(":") && !NOT_A_HOME.includes(screen.route),
  );
  // A screen this role was actually granted comes first. Screens that ask only
  // for a signed-in session are open to everybody, so they always sit earlier
  // in the registry than anyone's own work -- taking the first match outright
  // landed an R&D user on the action queue while R&D intelligence, the one
  // screen they hold a permission for, went unopened.
  const granted = candidates.find((screen) => held.has(screen.permission));
  if (granted) return granted.route;
  const anySignedIn = candidates.find(
    (screen) => screen.permission === "authenticated",
  );
  // The floor is a screen, never a denial.
  return anySignedIn?.route ?? "/settings";
}
