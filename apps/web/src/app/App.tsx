import { lazy, Suspense, useEffect, useRef, useState } from "react";
import {
  Link,
  Navigate,
  NavLink,
  Route,
  Routes,
  useLocation,
  useNavigate,
  matchPath,
} from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AbpLogo } from "./AbpLogo.tsx";

import { UserAvatar } from "./UserAvatar.tsx";
import {
  applyTheme,
  readStoredTheme,
  resolveTheme,
  storeTheme,
  watchSystemTheme,
  type ResolvedTheme,
  type ThemePreference,
} from "./theme.ts";
import type { ApiClient, components } from "@abp/api-client";
import { createWebApiClient } from "../api/client.ts";
import { getMe, type Me } from "../api/customer-api.ts";
import { useI18n } from "../i18n/i18n.tsx";
import {
  NotificationsPage,
  notificationQuery,
  notificationRoute,
} from "./NotificationsPage.tsx";
import {
  AppIcon,
  ErrorBanner,
  ScreenIdProvider,
  SlideOver,
} from "./CommercialUI.tsx";
import { TransportEstimatePanel } from "./TransportEstimatePanel.tsx";
import { commercialRequest, rows, isObject } from "./commercial-api.ts";
import { CreateCustomerForm, CreateContactForm } from "./CustomerPage.tsx";
import { listCountries, listAccounts } from "../api/customer-api.ts";
import { listActivities } from "../api/activity-api.ts";
import { enumLabel } from "../i18n/enum-labels.ts";
import { CustomerPage } from "./CustomerPage.tsx";
import { SalesCorePage } from "./SalesCorePage.tsx";
import {
  isMfaSetupRequired,
  isPasswordChangeRequired,
  logout,
} from "../api/auth-api.ts";
import {
  LocalLoginPage,
  MfaEnrollmentPage,
  PasswordChangePage,
} from "./LocalAuthPage.tsx";
import { RequestAccessPage } from "./RequestAccessPage.tsx";
import { PublicFeedbackPage } from "./PublicFeedbackPage.tsx";
import { AdminUsersPage } from "./AdminUsersPage.tsx";
import { ComplaintsPage } from "./ComplaintsPage.tsx";
import { ReturnsPage } from "./ReturnsPage.tsx";
import {
  screens,
  type ScreenDefinition,
  type Workspace,
} from "./screen-registry.ts";
import {
  VIEW_AS_ROLES,
  isRouteVisibleForRole,
  landingRoute,
  matrixRole,
  previewPermissions,
} from "./role-route-matrix.ts";

type SearchResult = components["schemas"]["SearchResult"];

const screenGroupMap: Record<string, string> = {
  HOME: "OVERVIEW",
  TODAY: "OVERVIEW",
  APPROVALS: "OVERVIEW",
  SEARCH: "OVERVIEW",
  ACTIONS: "OVERVIEW",
  CUSTOMERS: "SALES",
  CONTACTS: "SALES",
  OPPORTUNITIES: "SALES",
  QUOTATIONS: "SALES",
  QUOTATION_WIZARD: "SALES",
  CUSTOMER_ORDERS: "SALES",
  CUSTOMER_FEEDBACK: "SALES",
  // With the feedback it often starts from: customer service, owned by sales.
  COMPLAINTS: "SALES",
  CUSTOMER_MAP: "SALES",
  ACTIVITIES: "SALES",
  PROJECTS: "SALES MANAGEMENT",
  PRODUCTS: "SALES MANAGEMENT",
  TARGETS: "SALES MANAGEMENT",
  SALES_MANAGEMENT: "SALES MANAGEMENT",
  SALES_SUPPORT: "SALES MANAGEMENT",
  REPORTS: "SALES MANAGEMENT",
  CALENDAR: "PLANNING",
  CAPACITY: "OPERATIONS",
  WORK_ORDERS: "OPERATIONS",
  PRODUCTION_SCHEDULE: "OPERATIONS",
  AI: "INTEGRATED TOOLS",
  LOGISTICS: "LOGISTICS",
  LOGISTICS_PLANS: "LOGISTICS",
  LOGISTICS_PLAN: "LOGISTICS",
  CARGO_LOADER: "LOGISTICS",
  LOGISTICS_CALENDAR: "LOGISTICS",
  ERP_ORDERS: "ERP & DATA",
  ORDERS: "ERP & DATA",
  RETURNS: "ERP & DATA",
  SHIPMENTS: "LOGISTICS",
  DOCUMENTS: "ERP & DATA",
  IMPORTS: "ERP & DATA",
  DQ: "ERP & DATA",
  RECONCILIATION: "ERP & DATA",
  FINANCE: "FINANCE",
  FINANCE_FX: "FINANCE",
  FINANCE_PAYMENTS: "FINANCE",
  FINANCE_RECEIVABLES: "FINANCE",
  FINANCE_CHEQUES: "FINANCE",
  ANALYTICS: "INTELLIGENCE & ANALYTICS",
  RESEARCH: "INTELLIGENCE & ANALYTICS",
  MARKET_SIGNALS: "INTELLIGENCE & ANALYTICS",
  TARGET_MARKETS: "INTELLIGENCE & ANALYTICS",
  TARGET_ACCOUNTS: "INTELLIGENCE & ANALYTICS",
  COMPETITORS: "INTELLIGENCE & ANALYTICS",
  WATCHLIST: "INTELLIGENCE & ANALYTICS",
  REPEAT_BUSINESS: "SALES MANAGEMENT",
  NOTIFICATIONS: "COMMUNICATION",
  MESSAGES: "COMMUNICATION",
  PEOPLE: "COMMUNICATION",
  MY_PROFILE: "COMMUNICATION",
  SETTINGS: "COMMUNICATION",
  ADMIN_USERS: "ADMINISTRATION",
  ADMIN_PRICING: "ADMINISTRATION",
  ADMIN_ROLES: "ADMINISTRATION",
  ADMIN_COUNTRIES: "ADMINISTRATION",
  ADMIN_POLICIES: "ADMINISTRATION",
  ADMIN_CAPACITY: "ADMINISTRATION",
  ADMIN_IMPORT: "ADMINISTRATION",
  ADMIN_DQ: "ADMINISTRATION",
  ADMIN_TEMPLATES: "ADMINISTRATION",
  ADMIN_AUDIT: "ADMINISTRATION",
  ADMIN_SEGMENTS: "ADMINISTRATION",
  ADMIN_CLIENT_IDENTITIES: "ADMINISTRATION",
  ADMIN_SYSTEM: "ADMINISTRATION",
};

const CalendarPage = lazy(() =>
  import("./CalendarPage.tsx").then((module) => ({
    default: module.CalendarPage,
  })),
);
const QuotationStudio = lazy(() =>
  import("./QuotationStudio.tsx").then((module) => ({
    default: module.QuotationStudio,
  })),
);
const QuotationWizard = lazy(() =>
  import("./QuotationWizard.tsx").then((module) => ({
    default: module.QuotationWizard,
  })),
);
const PricingSettingsPage = lazy(() =>
  import("./PricingSettingsPage.tsx").then((module) => ({
    default: module.PricingSettingsPage,
  })),
);
const LogisticsPlanner = lazy(() =>
  import("./LogisticsPlanner.tsx").then((module) => ({
    default: module.LogisticsPlanner,
  })),
);
const CargoLoaderPage = lazy(() =>
  import("./CargoLoaderPage.tsx").then((module) => ({
    default: module.CargoLoaderPage,
  })),
);
const AIPage = lazy(() =>
  import("./AIPage.tsx").then((module) => ({ default: module.AIPage })),
);
const SettingsPage = lazy(() =>
  import("./SettingsPage.tsx").then((module) => ({
    default: module.SettingsPage,
  })),
);
const ContactPage = lazy(() =>
  import("./ContactPage.tsx").then((module) => ({
    default: module.ContactPage,
  })),
);
const ContactDirectoryPage = lazy(() =>
  import("./ContactDirectoryPage.tsx").then((module) => ({
    default: module.ContactDirectoryPage,
  })),
);
const ProjectPage = lazy(() =>
  import("./ProjectPage.tsx").then((module) => ({
    default: module.ProjectPage,
  })),
);
const OpportunityPage = lazy(() =>
  import("./OpportunityPage.tsx").then((module) => ({
    default: module.OpportunityPage,
  })),
);
const ActivityPage = lazy(() =>
  import("./ActivityPage.tsx").then((module) => ({
    default: module.ActivityPage,
  })),
);
const ProductPage = lazy(() =>
  import("./ProductPage.tsx").then((module) => ({
    default: module.ProductPage,
  })),
);
const AnalyticsPage = lazy(() =>
  import("./AnalyticsPage.tsx").then((module) => ({
    default: module.AnalyticsPage,
  })),
);
const QuotationPage = lazy(() =>
  import("./QuotationPage.tsx").then((module) => ({
    default: module.QuotationPage,
  })),
);
import { recordScreens } from "./record-screens.ts";
import { defaultPreviewPerson, parsePeople } from "../lib/person-targets.ts";
const RecordScreen = lazy(() =>
  import("./RecordScreen.tsx").then((module) => ({
    default: module.RecordScreen,
  })),
);
const ContractScreen = lazy(() =>
  import("./ContractScreen.tsx").then((module) => ({
    default: module.ContractScreen,
  })),
);
const ClientPortalPage = lazy(() =>
  import("./ClientPortalPage.tsx").then((module) => ({
    default: module.ClientPortalPage,
  })),
);
const CapacityPlannerPage = lazy(() =>
  import("./CapacityPlannerPage.tsx").then((module) => ({
    default: module.CapacityPlannerPage,
  })),
);
const ActionQueuePage = lazy(() =>
  import("./ActionQueuePage.tsx").then((module) => ({
    default: module.ActionQueuePage,
  })),
);
const DocumentsPage = lazy(() =>
  import("./DocumentsPage.tsx").then((module) => ({
    default: module.DocumentsPage,
  })),
);
const TargetsPage = lazy(() =>
  import("./TargetsPage.tsx").then((module) => ({
    default: module.TargetsPage,
  })),
);
const SearchPage = lazy(() =>
  import("./SearchPage.tsx").then((module) => ({
    default: module.SearchPage,
  })),
);
const DataQualityPage = lazy(() =>
  import("./DataQualityPage.tsx").then((module) => ({
    default: module.DataQualityPage,
  })),
);
const CustomerOrdersPage = lazy(() =>
  import("./CustomerOrdersPage.tsx").then((module) => ({
    default: module.CustomerOrdersPage,
  })),
);
const ReceivablesPage = lazy(() =>
  import("./ReceivablesPage.tsx").then((module) => ({
    default: module.ReceivablesPage,
  })),
);
const ShipmentsPage = lazy(() =>
  import("./ShipmentsPage.tsx").then((module) => ({
    default: module.ShipmentsPage,
  })),
);
const DeliveryCalendarPage = lazy(() =>
  import("./DeliveryCalendarPage.tsx").then((module) => ({
    default: module.DeliveryCalendarPage,
  })),
);
const WorkOrdersPage = lazy(() =>
  import("./WorkOrdersPage.tsx").then((module) => ({
    default: module.WorkOrdersPage,
  })),
);
const ProductionSchedulePage = lazy(() =>
  import("./ProductionSchedulePage.tsx").then((module) => ({
    default: module.ProductionSchedulePage,
  })),
);
const SystemPage = lazy(() =>
  import("./SystemPage.tsx").then((module) => ({
    default: module.SystemPage,
  })),
);
const FeedbackPage = lazy(() =>
  import("./FeedbackPage.tsx").then((module) => ({
    default: module.FeedbackPage,
  })),
);
const CustomerMapPage = lazy(() =>
  import("./CustomerMapPage.tsx").then((module) => ({
    default: module.CustomerMapPage,
  })),
);
const ErpOrdersPage = lazy(() =>
  import("./ErpOrdersPage.tsx").then((module) => ({
    default: module.ErpOrdersPage,
  })),
);
const MessagesPage = lazy(() =>
  import("./MessagesPage.tsx").then((module) => ({
    default: module.MessagesPage,
  })),
);
const PeoplePage = lazy(() =>
  import("./PeoplePage.tsx").then((module) => ({
    default: module.PeoplePage,
  })),
);
const ApprovalsPage = lazy(() =>
  import("./ApprovalsPage.tsx").then((module) => ({
    default: module.ApprovalsPage,
  })),
);
const CommercialTodayPage = lazy(() =>
  import("./CommercialTodayPage.tsx").then((module) => ({
    default: module.CommercialTodayPage,
  })),
);
const MyProfilePage = lazy(() =>
  import("./MyProfilePage.tsx").then((module) => ({
    default: module.MyProfilePage,
  })),
);
const SmartImportPage = lazy(() =>
  import("./SmartImportPage.tsx").then((module) => ({
    default: module.SmartImportPage,
  })),
);

/** What the next click switches to: light → dark → system → light. */
function themeMenuLabel(
  preference: ThemePreference,
  locale: "en" | "ar",
): string {
  if (preference === "light")
    return locale === "ar" ? "المظهر الداكن" : "Dark theme";
  if (preference === "dark")
    return locale === "ar" ? "تبع النظام" : "Match system";
  return locale === "ar" ? "المظهر الفاتح" : "Light theme";
}
export function App({ client = createWebApiClient() }: { client?: ApiClient }) {
  const queryClient = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
  const currentScreen = screens.find((item) =>
    matchPath(item.route, location.pathname),
  );
  const activeGroup = screenGroupMap[currentScreen?.id ?? "HOME"] ?? "OVERVIEW";
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [quickCreate, setQuickCreate] = useState(false);
  const [contactCreateOpen, setContactCreateOpen] = useState(false);
  const [transportCalcOpen, setTransportCalcOpen] = useState(false);
  const [quickCreateMenuOpen, setQuickCreateMenuOpen] = useState(false);
  const [notifPanelOpen, setNotifPanelOpen] = useState(false);
  const [followUpPanelOpen, setFollowUpPanelOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const portalMode = location.pathname.startsWith("/portal");
  const { locale, t, toggle } = useI18n();
  const [menuOpen, setMenuOpen] = useState(false);
  const [expandedGroup, setExpandedGroup] = useState<string | null>(
    activeGroup,
  );
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [logoutBusy, setLogoutBusy] = useState(false);
  // Consumed by the first landing redirect; see `landing` below.
  const landingUsed = useRef(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => window.localStorage.getItem("abp.sidebar.collapsed") === "true",
  );
  // The preference the user chose; `resolvedTheme` is what it means now.
  const [theme, setTheme] = useState<ThemePreference>(readStoredTheme);
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() =>
    resolveTheme(readStoredTheme()),
  );
  const [viewAsRole, setViewAsRole] = useState<string | null>(() =>
    window.sessionStorage.getItem("abp.viewAsRole"),
  );
  // Previewing a salesperson is previewing a person: their target, their deals.
  const [viewAsUser, setViewAsUser] = useState<string | null>(() =>
    window.sessionStorage.getItem("abp.viewAsUser"),
  );
  const me = useQuery({
    queryKey: ["me"],
    queryFn: () => getMe(client),
    retry: false,
    enabled: true,
  });
  /** What the previewed role really grants, read from the role itself. */
  const rolePreview = useQuery({
    queryKey: ["role-preview", viewAsRole],
    enabled: viewAsRole !== null && Boolean(me.data),
    staleTime: 10 * 60_000,
    retry: false,
    queryFn: async () => {
      const result = await commercialRequest(
        client,
        "GET",
        "/me/role-preview/{roleCode}",
        { path: { roleCode: viewAsRole ?? "" } },
      );
      const payload =
        isObject(result.data) && isObject(result.data.data)
          ? result.data.data
          : null;
      return payload === null
        ? null
        : {
            workspace:
              typeof payload.workspace === "string" ? payload.workspace : "",
            permissions: Array.isArray(payload.permissions)
              ? payload.permissions.filter(
                  (code): code is string => typeof code === "string",
                )
              : [],
          };
    },
  });
  /** The salespeople "View as Sales User" can be, with their figures. */
  const previewPeople = useQuery({
    queryKey: ["view-as-people", new Date().getFullYear()],
    enabled: viewAsRole === "SALES_REP" && Boolean(me.data),
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: async () => {
      const result = await client.GET("/targets/{year}/people", {
        params: { path: { year: String(new Date().getFullYear()) } },
      });
      return parsePeople(result.data);
    },
  });
  const notifications = useQuery({
    ...notificationQuery(client),
    enabled:
      !portalMode &&
      Boolean(me.data) &&
      !isPasswordChangeRequired() &&
      !isMfaSetupRequired() &&
      (!me.data?.user.mfaRequired || me.data.user.mfaEnabled),
  });
  const countries = useQuery({
    queryKey: ["reference-countries"],
    queryFn: () => listCountries(client),
    enabled: quickCreate,
  });
  // Follow-ups and meetings are Activity rows with a due date; the topbar
  // shows everything due in the next week plus anything already overdue.
  const followUps = useQuery({
    queryKey: ["topbar-follow-ups"],
    queryFn: () =>
      listActivities(client, 1, {
        dueTo: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
      }),
    enabled:
      !portalMode &&
      Boolean(me.data) &&
      !isPasswordChangeRequired() &&
      !isMfaSetupRequired(),
  });
  const openFollowUps = rows(followUps.data?.data).filter(
    (item) => item.taskStatusCode === "OPEN" || item.taskStatusCode == null,
  );
  const overdueFollowUps = openFollowUps.filter(
    (item) =>
      typeof item.dueAt === "string" && new Date(item.dueAt) < new Date(),
  );
  const globalSearch = useQuery<readonly SearchResult[]>({
    queryKey: ["global-search", paletteQuery.trim()],
    enabled:
      paletteOpen &&
      paletteQuery.trim().length >= 2 &&
      Boolean(me.data?.access.permissions.includes("search.use")),
    queryFn: async () => {
      const result = await client.GET("/search", {
        params: {
          query: { search: paletteQuery.trim(), page: 1, limit: 8 },
        },
      });
      if (!result.data)
        throw new Error(`GLOBAL_SEARCH_${String(result.response.status)}`);
      return result.data.data as unknown as readonly SearchResult[];
    },
    retry: false,
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen(true);
      }
      if (event.key === "Escape") {
        setPaletteOpen(false);
        setMenuOpen(false);
      }
    };
    window.addEventListener("keydown", listener);
    return () => {
      window.removeEventListener("keydown", listener);
    };
  }, []);
  useEffect(() => {
    const resolved = resolveTheme(theme);
    setResolvedTheme(resolved);
    applyTheme(resolved);
    storeTheme(theme);
    // Only "system" has anything to listen to; the other two are decisions
    // the user already made, and the OS does not get to overrule them.
    if (theme !== "system") return;
    return watchSystemTheme((next) => {
      setResolvedTheme(next);
      applyTheme(next);
    });
  }, [theme]);
  useEffect(() => {
    setExpandedGroup(activeGroup);
  }, [activeGroup]);
  // The customer's feedback page needs no account, so it is answered before
  // anything asks who is signed in.
  if (location.pathname === "/feedback")
    return <PublicFeedbackPage client={client} />;
  if (location.pathname === "/request-access")
    return (
      <RequestAccessPage
        client={client}
        onBackToLogin={() => {
          void navigate("/", { replace: true });
        }}
      />
    );
  if (me.isLoading)
    return (
      <div className="app-state">
        <div className="spinner" />
        {t("loading")}
      </div>
    );
  if (me.error || !me.data)
    return (
      <LocalLoginPage
        client={client}
        onAuthenticated={() =>
          void queryClient.invalidateQueries({ queryKey: ["me"] })
        }
        onRequestAccess={() => {
          void navigate("/request-access");
        }}
      />
    );
  if (isPasswordChangeRequired() || me.data.user.mustChangePassword)
    return (
      <PasswordChangePage
        client={client}
        onComplete={() =>
          void queryClient.invalidateQueries({ queryKey: ["me"] })
        }
      />
    );
  if (
    isMfaSetupRequired() ||
    (me.data.user.mfaRequired && !me.data.user.mfaEnabled)
  )
    return (
      <MfaEnrollmentPage
        client={client}
        onComplete={() =>
          void queryClient.invalidateQueries({ queryKey: ["me"] })
        }
      />
    );

  const primaryRole = me.data.access.roles[0]?.code;
  const isPortalUser = me.data.access.roles.some(
    ({ code }) => code === "CUSTOMER_PORTAL_USER",
  );
  if (isPortalUser && location.pathname === "/")
    return <Navigate to="/portal" replace />;
  if (isPortalUser && !portalMode) return <AccessDenied />;
  if (portalMode && !isPortalUser) return <AccessDenied />;
  if (portalMode)
    return (
      <Suspense fallback={<div className="app-state">{t("loading")}</div>}>
        <ClientPortalPage
          client={client}
          setTheme={setTheme}
          onLogout={() => {
            setLogoutBusy(true);
            void logout(client)
              .catch(() => undefined)
              .finally(() => {
                queryClient.clear();
                window.location.assign("/");
              });
          }}
          logoutBusy={logoutBusy}
        />
      </Suspense>
    );

  /**
   * Where each role starts its day.
   *
   * This is a first-impression, not a wall: the redirect fires once per
   * session, so the sidebar's own "Sales overview" link -- which points at "/"
   * -- takes you Home later rather than bouncing you straight back out.
   *
   * It used to be a table of role codes, and the codes were wrong. The database
   * seeds SALES_REP, LOGISTICS_COORDINATOR, OPERATIONS_ANALYST and
   * FINANCE_ANALYST; the table was keyed on SALES_USER, LOGISTICS, OPERATIONS
   * and FINANCE, so no lookup ever hit and every role was left on "/" -- which
   * needs `sales.workspace.view`, which four of the seven roles do not have.
   * A Logistics Coordinator, an Operations Analyst, a Finance Analyst and an
   * R&D user each signed in to an Access Denied screen. `landingRoute` now
   * checks the destination against what the person can actually open, so a role
   * nobody remembers to add lands somewhere useful instead of nowhere.
   */
  const landing =
    primaryRole === undefined
      ? "/"
      : landingRoute(primaryRole, me.data.access.permissions, screens);
  if (location.pathname === "/" && landing !== "/" && !landingUsed.current) {
    landingUsed.current = true;
    return <Navigate to={landing} replace />;
  }

  const canViewAs =
    primaryRole === "SYSTEM_ADMIN" || primaryRole === "SALES_MANAGER";
  const effectiveViewAsRole = canViewAs ? viewAsRole : null;
  /**
   * The permissions the preview runs on.
   *
   * This is the change that makes "View as" mean anything: every screen reads
   * its panels off `me.access.permissions`, so previewing a role has to narrow
   * that set or nothing below the sidebar can differ. A permission survives
   * unless every screen that needs it is denied to the previewed role -- see
   * role-route-matrix.ts.
   *
   * The server still holds the real permissions and still enforces them. A
   * manager previewing a salesperson has a manager's access throughout; they
   * are only being shown what the salesperson sees.
   */
  // The role's own grant once it has loaded; the matrix's guess only until
  // then, so the screen is never blank while the answer is on its way.
  const realRole =
    effectiveViewAsRole !== null && rolePreview.data ? rolePreview.data : null;
  const previewWorkspace =
    realRole?.workspace ??
    (matrixRole(effectiveViewAsRole ?? "") === "FINANCE" ? "FINANCE" : "SALES");
  const previewPerson =
    effectiveViewAsRole === "SALES_REP" && previewPeople.data
      ? (previewPeople.data.find((person) => person.userId === viewAsUser) ??
        defaultPreviewPerson(previewPeople.data))
      : null;
  const previewed: Me =
    effectiveViewAsRole === null
      ? me.data
      : {
          ...me.data,
          user: previewPerson
            ? {
                ...me.data.user,
                userId: previewPerson.userId,
                displayName: previewPerson.displayName,
              }
            : me.data.user,
          access: {
            ...me.data.access,
            permissions:
              realRole?.permissions ??
              previewPermissions(
                me.data.access.permissions,
                effectiveViewAsRole,
                screens,
              ),
            // A previewed salesperson does not keep the manager's Finance and
            // Admin sections. SYSTEM_ADMIN is the only role that sees both,
            // and previewing it is previewing yourself.
            workspaces: me.data.access.workspaces.map(
              (workspace: Me["access"]["workspaces"][number]) =>
                effectiveViewAsRole === "SYSTEM_ADMIN" ||
                (workspace.workspace === "FINANCE" &&
                  previewWorkspace === "FINANCE") ||
                (workspace.workspace !== "FINANCE" &&
                  workspace.workspace !== "ADMIN")
                  ? workspace
                  : { ...workspace, enabled: false },
            ),
          },
        };
  const permissions = new Set(previewed.access.permissions);
  const enabledWorkspaces = new Set(
    previewed.access.workspaces
      .filter((workspace) => workspace.enabled)
      .map((workspace) => workspace.workspace),
  );
  const workspaceVisible = (workspace: Workspace) => {
    // While previewing, even an administrator is shown the previewed role's
    // sections -- otherwise the one role that most needs the preview is the
    // one role it does not work for.
    if (primaryRole === "SYSTEM_ADMIN" && effectiveViewAsRole === null)
      return true;
    if (workspace === "finance") return enabledWorkspaces.has("FINANCE");
    if (workspace === "admin") return enabledWorkspaces.has("ADMIN");
    return true;
  };
  const exitViewAs = () => {
    setViewAsRole(null);
    window.sessionStorage.removeItem("abp.viewAsRole");
  };
  const chooseViewAsUser = (userId: string) => {
    setViewAsUser(userId);
    window.sessionStorage.setItem("abp.viewAsUser", userId);
  };
  const chooseViewAs = (roleCode: string | null) => {
    setViewAsRole(roleCode);
    if (roleCode) window.sessionStorage.setItem("abp.viewAsRole", roleCode);
    else window.sessionStorage.removeItem("abp.viewAsRole");
  };
  /**
   * Leaving a screen the previewed role cannot open.
   *
   * Switching to Sales User while sitting on Company targets used to remove
   * Targets from the menu and leave the targets on screen, which reads as a
   * preview that does not work. Now it goes to where that role starts its day.
   */
  // Decided on the role's real grant, and not before it has loaded: judged
  // on the matrix's guess, switching to Sales User on Company targets would
  // leave a screen the real role can open.
  const previewCanOpenThisScreen =
    effectiveViewAsRole === null ||
    realRole === null ||
    screens
      .filter((item) => matchPath(item.route, location.pathname) !== null)
      .every((item) => allowed(item.permission, permissions));
  if (
    effectiveViewAsRole !== null &&
    realRole !== null &&
    !previewCanOpenThisScreen
  )
    return (
      <Navigate
        to={landingRoute(effectiveViewAsRole, realRole.permissions, screens)}
        replace
      />
    );

  const visible = screens.filter(
    (item) =>
      allowed(item.permission, permissions) &&
      workspaceVisible(item.workspace) &&
      (!effectiveViewAsRole ||
        realRole !== null ||
        isRouteVisibleForRole(item.route, effectiveViewAsRole)),
  );
  const paletteItems = visible.filter(
    (item) =>
      !item.route.includes(":") &&
      item.title[locale].toLowerCase().includes(paletteQuery.toLowerCase()),
  );
  const commandRoutes = [
    ...(globalSearch.data ?? []).map(globalSearchHref),
    ...paletteItems.map((item) => item.route),
  ];
  const unread =
    isObject(notifications.data?.data) &&
    isObject(notifications.data.data.meta) &&
    typeof notifications.data.data.meta.unreadCount === "number"
      ? notifications.data.data.meta.unreadCount
      : rows(notifications.data?.data).filter((item) => !item.readAt).length;
  const groups: {
    label: { en: string; ar: string };
    workspaces: Workspace[];
    icon: string;
  }[] = [
    {
      label: { en: "OVERVIEW", ar: "نظرة عامة" },
      workspaces: [],
      icon: "⊞",
    },
    {
      label: { en: "SALES", ar: "المبيعات" },
      workspaces: ["sales"],
      icon: "◈",
    },
    {
      label: { en: "SALES MANAGEMENT", ar: "إدارة المبيعات" },
      workspaces: [],
      icon: "◈",
    },
    {
      label: { en: "PLANNING", ar: "التخطيط" },
      workspaces: [],
      icon: "◫",
    },
    {
      label: { en: "INTEGRATED TOOLS", ar: "الأدوات المتكاملة" },
      workspaces: [],
      icon: "⬡",
    },
    {
      label: { en: "OPERATIONS", ar: "العمليات والإنتاج" },
      workspaces: [],
      icon: "⚙",
    },
    {
      label: { en: "LOGISTICS", ar: "اللوجستيات" },
      workspaces: [],
      icon: "⛟",
    },
    {
      label: { en: "ERP & DATA", ar: "بيانات ERP" },
      workspaces: [],
      icon: "◧",
    },
    {
      label: { en: "FINANCE", ar: "المالية" },
      workspaces: ["finance"],
      icon: "◎",
    },
    {
      label: {
        en: "INTELLIGENCE & ANALYTICS",
        ar: "الذكاء والتحليلات",
      },
      workspaces: [],
      icon: "◉",
    },
    {
      label: { en: "COMMUNICATION", ar: "التواصل" },
      workspaces: [],
      icon: "◌",
    },
    {
      label: { en: "ADMINISTRATION", ar: "الإدارة" },
      workspaces: ["admin"],
      icon: "◑",
    },
  ];
  /**
   * What a screen is handed.
   *
   * `previewed`, not `me.data`: this is the only place the previewed role
   * can reach a screen, and every screen decides which panels to show from
   * `me.access.permissions`. Handing over the real set is what made "View
   * as" a sidebar filter and nothing more. The header outside this function
   * keeps the real `me.data`, because the name and photo in the corner are
   * still yours while you preview somebody else's screen.
   */
  const render = (item: ScreenDefinition) => {
    if (
      !allowed(item.permission, permissions) ||
      !workspaceVisible(item.workspace)
    )
      return (
        <AccessDenied
          message={
            item.id.startsWith("CUSTOMER")
              ? "Customer access is not granted."
              : undefined
          }
        />
      );
    switch (item.id) {
      case "QUOTATION_DETAIL":
        return (
          <QuotationStudio
            key={location.pathname}
            client={client}
            me={previewed}
          />
        );
      case "QUOTATION_WIZARD":
        return <QuotationWizard client={client} me={previewed} />;
      case "CALENDAR":
        return <CalendarPage client={client} me={previewed} />;
      case "LOGISTICS_PLAN":
        return (
          <LogisticsPlanner client={client} me={previewed} screen={item} />
        );
      case "CARGO_LOADER":
        return <CargoLoaderPage client={client} />;
      case "AI":
        return <AIPage client={client} />;
      case "SETTINGS":
        return (
          <SettingsPage
            client={client}
            me={previewed}
            theme={theme}
            setTheme={setTheme}
          />
        );
      case "DOCUMENTS":
        return <DocumentsPage client={client} me={previewed} />;
      case "TARGETS":
        return <TargetsPage client={client} me={previewed} />;
      case "SEARCH":
        return <SearchPage client={client} />;
      case "DQ":
        return <DataQualityPage client={client} />;
      case "CUSTOMER_ORDERS":
      case "CUSTOMER_ORDER_DETAIL":
        return <CustomerOrdersPage client={client} me={previewed} />;
      case "SHIPMENTS":
      case "SHIPMENT_DETAIL":
        return <ShipmentsPage client={client} me={previewed} />;
      case "CUSTOMER_FEEDBACK":
      case "CUSTOMER_FEEDBACK_DETAIL":
        return <FeedbackPage client={client} me={previewed} />;
      case "CUSTOMER_MAP":
        return <CustomerMapPage client={client} />;
      case "ADMIN_SYSTEM":
        return <SystemPage client={client} />;
      case "WORK_ORDERS":
      case "WORK_ORDER_DETAIL":
        return <WorkOrdersPage client={client} me={previewed} />;
      case "PRODUCTION_SCHEDULE":
        return <ProductionSchedulePage client={client} />;
      case "LOGISTICS_CALENDAR":
        return <DeliveryCalendarPage client={client} />;
      case "FINANCE_RECEIVABLES":
        return <ReceivablesPage client={client} me={previewed} />;
      case "ERP_ORDERS":
      case "ERP_ORDER_DETAIL":
        return <ErpOrdersPage client={client} />;
      case "CAPACITY":
        return <CapacityPlannerPage client={client} me={previewed} />;
      case "ACTIONS":
        return <ActionQueuePage client={client} />;
      case "NOTIFICATIONS":
        return <NotificationsPage client={client} />;
      case "PEOPLE":
        return <PeoplePage client={client} me={previewed} />;
      case "APPROVALS":
        return <ApprovalsPage client={client} me={previewed} />;
      case "TODAY":
        return <CommercialTodayPage client={client} me={previewed} />;
      case "MY_PROFILE":
        return <MyProfilePage client={client} me={previewed} />;
      case "MESSAGES":
        return <MessagesPage client={client} me={previewed} />;
      case "IMPORTS":
      case "IMPORT_JOB":
      case "ADMIN_IMPORT":
        return <SmartImportPage client={client} />;
      case "HOME":
      case "SALES_MANAGEMENT":
      case "SALES_SUPPORT":
        // One page, three routes: it reads which of the three it is
        // from the path and shows the overview, the command centre or
        // the support desk accordingly.
        return <SalesCorePage client={client} me={previewed} />;
      case "CUSTOMERS":
      case "CUSTOMER_DETAIL":
        return <CustomerPage client={client} me={previewed} />;
      case "CONTACTS":
        return <ContactDirectoryPage client={client} />;
      case "CONTACT_DETAIL":
        return <ContactPage client={client} me={previewed} />;
      case "PROJECTS":
      case "PROJECT_DETAIL":
        return <ProjectPage client={client} me={previewed} />;
      case "OPPORTUNITIES":
      case "OPPORTUNITY_DETAIL":
        return <OpportunityPage client={client} me={previewed} />;
      case "ACTIVITIES":
        return <ActivityPage client={client} me={previewed} />;
      case "PRODUCTS":
        return <ProductPage client={client} me={previewed} />;
      case "REPORTS":
        return <AnalyticsPage client={client} me={previewed} />;
      case "QUOTATIONS":
        return <QuotationPage client={client} me={previewed} />;
      case "ADMIN_USERS":
        return <AdminUsersPage client={client} me={previewed} />;
      case "ADMIN_PRICING":
        return <PricingSettingsPage client={client} me={previewed} />;
      case "COMPLAINTS":
      case "COMPLAINT_DETAIL":
        return <ComplaintsPage client={client} me={previewed} />;
      case "RETURNS":
      case "RETURN_DETAIL":
        return <ReturnsPage client={client} me={previewed} />;
      default: {
        // Most remaining routes are ordinary lists of records, and a described
        // list reads like a CRM where the operation browser read like a
        // developer tool. Anything still undescribed keeps the old renderer
        // rather than losing its screen.
        const spec = recordScreens[item.id];
        if (spec) {
          return (
            <RecordScreen
              key={item.id}
              client={client}
              me={previewed}
              spec={spec}
            />
          );
        }
        return (
          <ContractScreen
            key={item.id}
            screen={item}
            client={client}
            me={previewed}
          />
        );
      }
    }
  };

  return (
    <div
      className={`app-shell abp2-shell ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}
    >
      <button
        type="button"
        className="mobile-menu"
        aria-expanded={menuOpen}
        onClick={() => {
          setMenuOpen((value) => !value);
        }}
      >
        {t("menu")}
      </button>
      <aside className={`sidebar ${menuOpen ? "open" : ""}`}>
        <div className="brand">
          <AbpLogo className="brand-wordmark" size="md" decorative />
          <img className="brand-logo" src="/favicon.svg" alt="" />
          <span className="brand-system">{t("brandSystem")}</span>
          <button
            type="button"
            className="sidebar-collapse"
            aria-label={
              sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"
            }
            aria-pressed={sidebarCollapsed}
            onClick={() => {
              setSidebarCollapsed((current) => {
                const next = !current;
                window.localStorage.setItem(
                  "abp.sidebar.collapsed",
                  String(next),
                );
                return next;
              });
            }}
          >
            <AppIcon id="COLLAPSE" />
          </button>
        </div>
        {canViewAs && (
          <div className="view-as-control">
            <label htmlFor="view-as-select">
              {locale === "ar" ? "عرض كـ" : "View As"}
            </label>
            <select
              id="view-as-select"
              value={viewAsRole ?? ""}
              onChange={(event) => {
                chooseViewAs(event.target.value || null);
              }}
            >
              <option value="">
                {locale === "ar" ? "دوري الحقيقي" : "My real role"}
              </option>
              {VIEW_AS_ROLES.map((role) => (
                <option key={role.code} value={role.code}>
                  {role.label[locale]}
                </option>
              ))}
            </select>
            {previewPerson && previewPeople.data && (
              <select
                id="view-as-person"
                aria-label={locale === "ar" ? "المندوب" : "Salesperson"}
                value={previewPerson.userId}
                onChange={(event) => {
                  chooseViewAsUser(event.target.value);
                }}
              >
                {previewPeople.data.map((person) => (
                  <option key={person.userId} value={person.userId}>
                    {person.displayName}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}
        <nav aria-label="Primary navigation">
          {(() => {
            const toggleGroup = (groupLabel: string) => {
              setExpandedGroup((previous) =>
                previous === groupLabel ? null : groupLabel,
              );
            };
            const groupedScreens: Record<string, ScreenDefinition[]> = {};
            for (const item of visible) {
              if (item.route.includes(":") || item.id === "SEARCH") continue;
              const groupKey =
                screenGroupMap[item.id] ?? item.workspace.toUpperCase();
              if (!groupedScreens[groupKey]) groupedScreens[groupKey] = [];
              groupedScreens[groupKey].push(item);
            }
            return groups.map((group) => {
              const groupKey = group.label.en;
              const items = groupedScreens[groupKey];
              if (!items?.length) return null;
              // Overview is the front door -- the dashboard, search and the
              // action queue -- so it is never one of the nine that shut.
              // An administrator lands on Users & access, which collapsed
              // every other group and left them with a dashboard they could
              // not see a link to.
              const isCollapsed =
                groupKey !== "OVERVIEW" && expandedGroup !== groupKey;
              return (
                <section className="nav-group" key={groupKey}>
                  <button
                    type="button"
                    className="workspace-label-btn"
                    onClick={() => {
                      toggleGroup(groupKey);
                    }}
                    aria-expanded={!isCollapsed}
                  >
                    <span className="workspace-label-text">
                      {group.label[locale]}
                    </span>
                    <span className="workspace-label-toggle" aria-hidden="true">
                      {isCollapsed ? "+" : "−"}
                    </span>
                  </button>
                  {!isCollapsed &&
                    items.map((item) => (
                      <NavLink
                        key={item.id}
                        to={item.route}
                        onClick={() => {
                          setMenuOpen(false);
                        }}
                      >
                        <span className="nav-icon" aria-hidden="true">
                          <AppIcon id={item.id} />
                        </span>
                        <span>{item.title[locale]}</span>
                      </NavLink>
                    ))}
                </section>
              );
            });
          })()}
        </nav>
        <footer className="sidebar-footer">
          <span className="environment-dot" />
          <span>
            <strong>
              {locale === "ar" ? "بيئة محلية" : "Local workspace"}
            </strong>
            <small>
              {locale === "ar" ? "نظام ABP التجاري" : "ABP Commercial System"}
            </small>
          </span>
        </footer>
      </aside>
      {menuOpen && (
        <button
          type="button"
          className="mobile-menu-backdrop"
          aria-label={locale === "ar" ? "إغلاق القائمة" : "Close navigation"}
          onClick={() => {
            setMenuOpen(false);
          }}
        />
      )}
      <main
        className="app-main"
        inert={menuOpen ? true : undefined}
        tabIndex={0}
        aria-label={
          locale === "ar" ? "محتوى التطبيق الرئيسي" : "Main application content"
        }
      >
        {effectiveViewAsRole && (
          <div className="view-as-banner" role="status">
            <span>
              {locale === "ar"
                ? `تعرض الآن كـ: ${VIEW_AS_ROLES.find((role) => role.code === effectiveViewAsRole)?.label.ar ?? effectiveViewAsRole} — دورك الفعلي ${String(me.data.access.roles[0]?.name ?? primaryRole)}. لا تتغير صلاحياتك الفعلية.`
                : `Viewing as: ${VIEW_AS_ROLES.find((role) => role.code === effectiveViewAsRole)?.label.en ?? effectiveViewAsRole} — your real role is ${String(me.data.access.roles[0]?.name ?? primaryRole)}. Your actual permissions are unchanged.`}
            </span>
            <button type="button" onClick={exitViewAs}>
              {locale === "ar" ? "الخروج من وضع العرض" : "Exit View As"}
            </button>
          </div>
        )}
        <header className="topbar">
          <button
            type="button"
            className="search-trigger"
            aria-label={
              locale === "ar" ? "البحث التجاري الشامل" : "Global Sales search"
            }
            onClick={() => {
              setPaletteOpen(true);
            }}
          >
            <AppIcon id="SEARCH" />
            <span>{t("search")}</span>
            <kbd>Ctrl K</kbd>
          </button>
          <nav className="topbar-breadcrumb" aria-label="Breadcrumb">
            <Link to="/">ABP</Link>
            <span>/</span>
            <span>{currentScreen?.title[locale]}</span>
          </nav>
          <div className="topbar-context">
            {permissions.has("accounts.create") && (
              <div className="topbar-dropdown-wrap">
                <button
                  type="button"
                  className="topbar-create"
                  aria-label={locale === "ar" ? "إضافة سريعة" : "Quick create"}
                  aria-expanded={quickCreateMenuOpen}
                  onClick={() => {
                    setQuickCreateMenuOpen((current) => !current);
                    setNotifPanelOpen(false);
                  }}
                >
                  <span aria-hidden="true">＋</span>
                  <span>
                    {locale === "ar" ? "إضافة سريعة" : "Quick create"}
                  </span>
                </button>
                {quickCreateMenuOpen && (
                  <>
                    <button
                      type="button"
                      className="topbar-dropdown-backdrop"
                      aria-label={t("close")}
                      onClick={() => {
                        setQuickCreateMenuOpen(false);
                      }}
                    />
                    <div className="topbar-dropdown-menu" role="menu">
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setQuickCreateMenuOpen(false);
                          setQuickCreate(true);
                        }}
                      >
                        <AppIcon id="CUSTOMERS" />
                        {locale === "ar" ? "عميل جديد" : "New customer"}
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setQuickCreateMenuOpen(false);
                          setContactCreateOpen(true);
                        }}
                      >
                        <AppIcon id="CONTACTS" />
                        {locale === "ar" ? "جهة اتصال جديدة" : "New contact"}
                      </button>
                      <Link
                        role="menuitem"
                        to="/opportunities?create=1"
                        onClick={() => {
                          setQuickCreateMenuOpen(false);
                        }}
                      >
                        <AppIcon id="OPPORTUNITIES" />
                        {locale === "ar"
                          ? "فرصة بيعية جديدة"
                          : "New opportunity"}
                      </Link>
                      <Link
                        role="menuitem"
                        to="/quotation-wizard"
                        onClick={() => {
                          setQuickCreateMenuOpen(false);
                        }}
                      >
                        <AppIcon id="QUOTATIONS" />
                        {locale === "ar" ? "عرض سعر جديد" : "New quotation"}
                      </Link>
                      <Link
                        role="menuitem"
                        to="/activities?create=1"
                        onClick={() => {
                          setQuickCreateMenuOpen(false);
                        }}
                      >
                        <AppIcon id="ACTIVITIES" />
                        {locale === "ar" ? "نشاط جديد" : "New activity"}
                      </Link>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setQuickCreateMenuOpen(false);
                          setTransportCalcOpen(true);
                        }}
                      >
                        <AppIcon id="CAPACITY_BOX" />
                        {locale === "ar"
                          ? "حساب نقل سريع"
                          : "Quick transport calc"}
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
            <div className="topbar-dropdown-wrap">
              <button
                type="button"
                className="topbar-icon-button notif-btn"
                aria-label={`${locale === "ar" ? "المتابعات والاجتماعات" : "Follow-ups and meetings"}${openFollowUps.length > 0 ? ` ${String(openFollowUps.length)}` : ""}`}
                aria-expanded={followUpPanelOpen}
                onClick={() => {
                  setFollowUpPanelOpen((current) => !current);
                  setNotifPanelOpen(false);
                  setQuickCreateMenuOpen(false);
                  setUserMenuOpen(false);
                }}
              >
                <AppIcon id="CLOCK" />
                {openFollowUps.length > 0 && (
                  <span
                    className={`notif-badge${overdueFollowUps.length > 0 ? " is-overdue" : ""}`}
                    aria-hidden="true"
                  >
                    {openFollowUps.length > 99 ? "99+" : openFollowUps.length}
                  </span>
                )}
              </button>
              {followUpPanelOpen && (
                <>
                  <button
                    type="button"
                    className="topbar-dropdown-backdrop"
                    aria-label={t("close")}
                    onClick={() => {
                      setFollowUpPanelOpen(false);
                    }}
                  />
                  <div className="topbar-dropdown-menu notif-panel" role="menu">
                    <header className="notif-panel-header">
                      <strong>
                        {locale === "ar"
                          ? "المتابعات والاجتماعات"
                          : "Follow-ups & meetings"}
                      </strong>
                      <Link
                        to="/activities"
                        onClick={() => {
                          setFollowUpPanelOpen(false);
                        }}
                      >
                        {locale === "ar" ? "عرض الكل" : "View all"}
                      </Link>
                    </header>
                    {openFollowUps.length === 0 ? (
                      <p className="notif-panel-empty">
                        {locale === "ar"
                          ? "مفيش متابعات مستحقة"
                          : "Nothing due right now"}
                      </p>
                    ) : (
                      openFollowUps.slice(0, 6).map((item) => (
                        <Link
                          key={String(item.activityId)}
                          to={activityHref(item)}
                          className={`notif-panel-row${
                            typeof item.dueAt === "string" &&
                            new Date(item.dueAt) < new Date()
                              ? " unread"
                              : ""
                          }`}
                          onClick={() => {
                            setFollowUpPanelOpen(false);
                          }}
                        >
                          <span
                            className="notif-panel-dot"
                            aria-hidden="true"
                          />
                          <span>
                            <strong>
                              {typeof item.subject === "string" && item.subject
                                ? item.subject
                                : enumLabel(String(item.typeCode), locale)}
                            </strong>
                            <small>
                              {enumLabel(String(item.typeCode), locale)}
                              {typeof item.dueAt === "string"
                                ? ` · ${formatDueAt(item.dueAt, locale)}`
                                : ""}
                            </small>
                          </span>
                        </Link>
                      ))
                    )}
                  </div>
                </>
              )}
            </div>
            <div className="topbar-dropdown-wrap">
              <button
                type="button"
                className="topbar-icon-button notif-btn"
                aria-label={`${locale === "ar" ? "الإشعارات" : "Notifications"}${unread > 0 ? ` ${String(unread > 99 ? "99+" : unread)}` : ""}`}
                aria-expanded={notifPanelOpen}
                onClick={() => {
                  setNotifPanelOpen((current) => !current);
                  setQuickCreateMenuOpen(false);
                  setFollowUpPanelOpen(false);
                  setUserMenuOpen(false);
                }}
              >
                <AppIcon id="NOTIFICATIONS" />
                {unread > 0 && (
                  <span className="notif-badge" aria-hidden="true">
                    {unread > 99 ? "99+" : unread}
                  </span>
                )}
              </button>
              {notifPanelOpen && (
                <>
                  <button
                    type="button"
                    className="topbar-dropdown-backdrop"
                    aria-label={t("close")}
                    onClick={() => {
                      setNotifPanelOpen(false);
                    }}
                  />
                  <div className="topbar-dropdown-menu notif-panel" role="menu">
                    <header className="notif-panel-header">
                      <strong>
                        {locale === "ar" ? "الإشعارات" : "Notifications"}
                      </strong>
                      <Link
                        to="/notifications"
                        onClick={() => {
                          setNotifPanelOpen(false);
                        }}
                      >
                        {locale === "ar" ? "عرض الكل" : "View all"}
                      </Link>
                    </header>
                    {rows(notifications.data?.data).length === 0 ? (
                      <p className="notif-panel-empty">
                        {locale === "ar"
                          ? "لا توجد إشعارات جديدة"
                          : "No notifications yet"}
                      </p>
                    ) : (
                      rows(notifications.data?.data)
                        .slice(0, 6)
                        .map((item) => (
                          <Link
                            key={String(item.notificationId)}
                            to={notificationRoute(item)}
                            className={`notif-panel-row ${item.readAt ? "" : "unread"}`}
                            onClick={() => {
                              setNotifPanelOpen(false);
                            }}
                          >
                            <span
                              className="notif-panel-dot"
                              aria-hidden="true"
                            />
                            <span>
                              <strong>
                                {typeof item.titleSafe === "string"
                                  ? item.titleSafe
                                  : ""}
                              </strong>
                              <small>
                                {typeof item.bodySafe === "string"
                                  ? item.bodySafe
                                  : ""}
                              </small>
                            </span>
                          </Link>
                        ))
                    )}
                  </div>
                </>
              )}
            </div>
            {/* The pill used to print every code in the scope inline. With 23
                countries granted that is a paragraph sitting in the top bar,
                pushing the account menu off the edge. The badge now states the
                scope's size; the codes themselves live in the tooltip, and the
                Settings screen already lists them in full. */}
            <span
              className="scope-pill"
              title={`${t("countryScope")}: ${
                me.data.access.countryScope.countryCodes.join(", ") || "—"
              }`}
            >
              <span className="scope-dot" />
              {scopeSummary(me.data.access.countryScope.countryCodes, locale)}
            </span>
            <div className="topbar-dropdown-wrap">
              <button
                type="button"
                className="user-menu"
                aria-label={locale === "ar" ? "حسابي" : "My account"}
                aria-expanded={userMenuOpen}
                onClick={() => {
                  setUserMenuOpen((current) => !current);
                  setNotifPanelOpen(false);
                  setFollowUpPanelOpen(false);
                  setQuickCreateMenuOpen(false);
                }}
              >
                <UserAvatar
                  userId={me.data.user.userId}
                  displayName={me.data.user.displayName}
                  photoUpdatedAt={me.data.user.photoUpdatedAt}
                  size="sm"
                />
                <span className="user-copy">
                  <strong>{me.data.user.displayName}</strong>
                  <small>
                    {me.data.access.roles[0]?.name ?? t("signedInAs")}
                  </small>
                </span>
              </button>
              {userMenuOpen && (
                <>
                  <button
                    type="button"
                    className="topbar-dropdown-backdrop"
                    aria-label={t("close")}
                    onClick={() => {
                      setUserMenuOpen(false);
                    }}
                  />
                  <div className="topbar-dropdown-menu user-panel" role="menu">
                    <header className="user-panel-header">
                      <UserAvatar
                        userId={me.data.user.userId}
                        displayName={me.data.user.displayName}
                        photoUpdatedAt={me.data.user.photoUpdatedAt}
                        size="md"
                      />
                      <span>
                        <strong>{me.data.user.displayName}</strong>
                        <small>{me.data.user.email}</small>
                      </span>
                    </header>
                    <Link
                      to="/profile"
                      role="menuitem"
                      onClick={() => {
                        setUserMenuOpen(false);
                      }}
                    >
                      <AppIcon id="CONTACTS" />
                      {locale === "ar" ? "ملفي الشخصي" : "My profile"}
                    </Link>
                    <Link
                      to="/settings"
                      role="menuitem"
                      onClick={() => {
                        setUserMenuOpen(false);
                      }}
                    >
                      <AppIcon id="MANAGEMENT" />
                      {locale === "ar" ? "إعداداتي" : "My preferences"}
                    </Link>
                    <Link
                      to="/messages"
                      role="menuitem"
                      onClick={() => {
                        setUserMenuOpen(false);
                      }}
                    >
                      <AppIcon id="SUPPORT" />
                      {locale === "ar" ? "الرسائل" : "Messages"}
                    </Link>
                    <Link
                      to="/activities"
                      role="menuitem"
                      onClick={() => {
                        setUserMenuOpen(false);
                      }}
                    >
                      <AppIcon id="ACTIVITIES" />
                      {locale === "ar" ? "متابعاتي" : "My follow-ups"}
                    </Link>
                    <div className="user-panel-divider" />
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setTheme((current) =>
                          current === "light"
                            ? "dark"
                            : current === "dark"
                              ? "system"
                              : "light",
                        );
                      }}
                    >
                      <AppIcon
                        id={
                          theme === "system"
                            ? "SETTINGS"
                            : resolvedTheme === "light"
                              ? "MOON"
                              : "SUN"
                        }
                      />
                      {themeMenuLabel(theme, locale)}
                    </button>
                    <button type="button" role="menuitem" onClick={toggle}>
                      <span aria-hidden="true">🌐</span>
                      {t("language")}
                    </button>
                    <div className="user-panel-divider" />
                    <button
                      type="button"
                      role="menuitem"
                      className="user-panel-signout"
                      disabled={logoutBusy}
                      onClick={() => {
                        setLogoutBusy(true);
                        void logout(client)
                          .catch(() => undefined)
                          .finally(() => {
                            queryClient.clear();
                            window.location.assign("/");
                          });
                      }}
                    >
                      <span aria-hidden="true">↪</span>
                      {locale === "ar" ? "تسجيل الخروج" : "Sign out"}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </header>
        <ErrorBanner
          error={notifications.error}
          retry={() => void notifications.refetch()}
        />
        <Suspense fallback={<div className="app-state">{t("loading")}</div>}>
          <div className="route-content">
            <Routes>
              {screens.flatMap((item) =>
                [item.route, ...(item.aliases ?? [])].map((path) => (
                  <Route
                    key={`${item.id}:${path}`}
                    path={path}
                    element={
                      <ScreenIdProvider screenId={item.id}>
                        {render(item)}
                      </ScreenIdProvider>
                    }
                  />
                )),
              )}
              <Route
                path="*"
                element={
                  <div className="app-state denied">
                    <div>
                      <h1>404</h1>
                      <p>
                        {locale === "ar"
                          ? "الصفحة دي مش موجودة."
                          : "There is no page at this address."}
                      </p>
                    </div>
                  </div>
                }
              />
            </Routes>
          </div>
        </Suspense>
      </main>
      {quickCreate && (
        <SlideOver
          title={locale === "ar" ? "عميل جديد" : "New customer"}
          onClose={() => {
            setQuickCreate(false);
          }}
        >
          <ErrorBanner
            error={countries.error}
            retry={() => void countries.refetch()}
          />
          <CreateCustomerForm
            client={client}
            countries={(countries.data ?? []).filter((country) =>
              me.data.access.countryScope.countryCodes.includes(
                country.countryCode,
              ),
            )}
            onCreated={async () => {
              setQuickCreate(false);
              await queryClient.invalidateQueries();
            }}
          />
        </SlideOver>
      )}
      {contactCreateOpen && (
        <SlideOver
          title={locale === "ar" ? "جهة اتصال جديدة" : "New contact"}
          onClose={() => {
            setContactCreateOpen(false);
          }}
        >
          <NewContactFlow
            client={client}
            locale={locale}
            onCreated={async () => {
              setContactCreateOpen(false);
              await queryClient.invalidateQueries();
            }}
          />
        </SlideOver>
      )}
      {transportCalcOpen && (
        <SlideOver
          title={locale === "ar" ? "حساب نقل سريع" : "Quick transport calc"}
          onClose={() => {
            setTransportCalcOpen(false);
          }}
        >
          <TransportEstimatePanel />
        </SlideOver>
      )}
      {paletteOpen && (
        <div className="dialog-backdrop command-backdrop" role="presentation">
          <section
            className="command-palette"
            role="dialog"
            aria-modal="true"
            aria-label={t("search")}
          >
            <header>
              <input
                autoFocus
                aria-label={t("search")}
                value={paletteQuery}
                onChange={(event) => {
                  setPaletteQuery(event.target.value);
                  setSelectedIndex(0);
                }}
                placeholder={t("commandHelp")}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                    event.preventDefault();
                    setSelectedIndex((index) =>
                      Math.max(
                        0,
                        Math.min(
                          commandRoutes.length - 1,
                          index + (event.key === "ArrowDown" ? 1 : -1),
                        ),
                      ),
                    );
                  }
                  if (event.key === "Enter" && commandRoutes[selectedIndex]) {
                    event.preventDefault();
                    void navigate(commandRoutes[selectedIndex]);
                    setPaletteOpen(false);
                  }
                }}
              />
              <button
                type="button"
                className="icon-button"
                aria-label={t("close")}
                onClick={() => {
                  setPaletteOpen(false);
                }}
              >
                ×
              </button>
            </header>
            <ErrorBanner
              error={globalSearch.error}
              retry={() => void globalSearch.refetch()}
            />
            <div className="command-results">
              {globalSearch.data && globalSearch.data.length > 0 && (
                <p className="command-section-label">
                  {locale === "ar" ? "النتائج التجارية" : "Business results"}
                </p>
              )}
              {(globalSearch.data ?? []).map((result, index) => (
                <NavLink
                  key={`${result.resourceTypeCode}:${result.resourceId}`}
                  className={selectedIndex === index ? "palette-selected" : ""}
                  to={globalSearchHref(result)}
                  onClick={() => {
                    setPaletteOpen(false);
                  }}
                >
                  <strong>{result.primaryText}</strong>
                  <small>
                    {result.resourceTypeCode}
                    {result.secondaryText ? ` · ${result.secondaryText}` : ""}
                  </small>
                </NavLink>
              ))}
              {paletteItems.length > 0 && (
                <p className="command-section-label">
                  {locale === "ar" ? "التنقل" : "Navigation"}
                </p>
              )}
              {paletteItems.map((item, index) => (
                <NavLink
                  key={item.id}
                  className={
                    selectedIndex === (globalSearch.data?.length ?? 0) + index
                      ? "palette-selected"
                      : ""
                  }
                  to={item.route}
                  onClick={() => {
                    setPaletteOpen(false);
                  }}
                >
                  <strong>{item.title[locale]}</strong>
                  <small>{item.module}</small>
                </NavLink>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function AccessDenied({ message }: { message?: string | undefined }) {
  const { t } = useI18n();
  return (
    <div className="app-state denied" role="alert">
      <div>
        <h1>403 · {t("accessDenied")}</h1>
        <p>{message ?? t("accessDeniedNote")}</p>
      </div>
    </div>
  );
}

// Contacts belong to an account, so "New contact" from the global Quick
// Create menu needs an account picked first — unlike "New customer", which
// has no such prerequisite. Step 1 searches/selects the account; step 2
// reuses CustomerPage's own CreateContactForm once one is chosen.
function NewContactFlow({
  client,
  locale,
  onCreated,
}: {
  client: ApiClient;
  locale: "en" | "ar";
  onCreated: (contactId: string) => Promise<void>;
}) {
  const [search, setSearch] = useState("");
  const [accountId, setAccountId] = useState<string>();
  const [accountName, setAccountName] = useState<string>();
  const accounts = useQuery({
    queryKey: ["new-contact-account-search", search],
    enabled: search.trim().length >= 2,
    queryFn: () =>
      listAccounts(client, {
        page: 1,
        limit: 10,
        search: search.trim(),
        archiveState: "ACTIVE",
      }),
  });
  if (accountId) {
    return (
      <div className="contact-form-wrap">
        <p className="dialog-guidance">
          {locale === "ar" ? "العميل: " : "Customer: "}
          <strong>{accountName}</strong>{" "}
          <button
            type="button"
            className="link-button"
            onClick={() => {
              setAccountId(undefined);
              setAccountName(undefined);
            }}
          >
            {locale === "ar" ? "تغيير" : "change"}
          </button>
        </p>
        <CreateContactForm
          client={client}
          accountId={accountId}
          onCreated={onCreated}
        />
      </div>
    );
  }
  return (
    <div>
      <label>
        {locale === "ar"
          ? "ابحث عن العميل أولاً"
          : "Search for the customer first"}
        <input
          autoFocus
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
          }}
          placeholder={
            locale === "ar"
              ? "اسم العميل أو الرقم المرجعي"
              : "Customer name or reference"
          }
        />
      </label>
      {search.trim().length >= 2 && (
        <ul className="quick-pick-list">
          {(accounts.data?.data ?? []).map((account) => (
            <li key={account.accountId}>
              <button
                type="button"
                onClick={() => {
                  setAccountId(account.accountId);
                  setAccountName(account.canonicalName);
                }}
              >
                {account.canonicalName}
                <small>{account.accountRef}</small>
              </button>
            </li>
          ))}
          {accounts.data && accounts.data.data.length === 0 && (
            <li className="quick-pick-empty">
              {locale === "ar" ? "لا توجد نتائج." : "No matches."}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

function allowed(requirement: string, permissions: ReadonlySet<string>) {
  return requirement === "authenticated" || permissions.has(requirement);
}

// Up to three codes fit in a badge and are more useful than a number. Past
// that the list stops being readable at a glance, so it becomes a count and
// the codes move to the tooltip.
function scopeSummary(codes: readonly string[], locale: string): string {
  if (codes.length === 0) return locale === "ar" ? "بدون نطاق" : "No scope";
  if (codes.length <= 3) return codes.join(" · ");
  return locale === "ar"
    ? `${String(codes.length)} دولة`
    : `${String(codes.length)} countries`;
}

// A follow-up filed against a quotation should open that quotation, not a
// generic activity list — that link is the whole point of filing it there.
function activityHref(item: Record<string, unknown>): string {
  const roots: Readonly<Record<string, string>> = {
    ACCOUNT: "/customers",
    CUSTOMER: "/customers",
    CONTACT: "/contacts",
    PROJECT: "/projects",
    OPPORTUNITY: "/opportunities",
    QUOTATION: "/quotations",
  };
  const links = Array.isArray(item.links)
    ? links_(item.links as unknown[])
    : [];
  // The account is always the primary link (the server enforces it), but a
  // reminder filed against a quotation or a deal should open that, not the
  // customer file.
  const target =
    links.find((link) => link.resourceTypeCode === "QUOTATION") ??
    links.find((link) => link.resourceTypeCode === "OPPORTUNITY") ??
    links[0];
  if (!target) return "/activities";
  const root = roots[target.resourceTypeCode];
  return root
    ? `${root}/${encodeURIComponent(target.resourceId)}`
    : "/activities";
}

function links_(
  value: unknown[],
): { resourceTypeCode: string; resourceId: string }[] {
  return value.flatMap((link) =>
    isObject(link) &&
    typeof link.resourceTypeCode === "string" &&
    typeof link.resourceId === "string"
      ? [
          {
            resourceTypeCode: link.resourceTypeCode,
            resourceId: link.resourceId,
          },
        ]
      : [],
  );
}

function formatDueAt(value: string, locale: "en" | "ar"): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const days = Math.round((date.getTime() - Date.now()) / 86400000);
  if (days < 0)
    return locale === "ar"
      ? `متأخرة ${String(Math.abs(days))} يوم`
      : `${String(Math.abs(days))}d overdue`;
  if (days === 0) return locale === "ar" ? "النهارده" : "Today";
  if (days === 1) return locale === "ar" ? "بكرة" : "Tomorrow";
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", {
    dateStyle: "medium",
  }).format(date);
}

function globalSearchHref(
  result: components["schemas"]["SearchResult"],
): string {
  const roots: Readonly<Record<string, string>> = {
    ACCOUNT: "/customers",
    CUSTOMER: "/customers",
    CONTACT: "/contacts",
    PROJECT: "/projects",
    OPPORTUNITY: "/opportunities",
    QUOTATION: "/quotations",
    ERP_ORDER: "/orders",
  };
  const root = roots[result.resourceTypeCode];
  return root ? `${root}/${encodeURIComponent(result.resourceId)}` : "/search";
}
