import { permissions, type PermissionCode } from "@abp/contracts";

export type Workspace = "sales" | "logistics" | "operations" | "finance";

export interface RouteDefinition {
  path: string;
  label: string;
  workspace: Workspace;
  permission: PermissionCode;
  kind: "core" | "management" | "support" | "isolated";
}

export const routes: readonly RouteDefinition[] = [
  {
    path: "/sales",
    label: "Sales overview",
    workspace: "sales",
    permission: permissions.salesWorkspaceView,
    kind: "core",
  },
  {
    path: "/sales/customers",
    label: "Customers",
    workspace: "sales",
    permission: permissions.accountsView,
    kind: "core",
  },
  {
    path: "/sales/projects",
    label: "Projects",
    workspace: "sales",
    permission: permissions.projectsView,
    kind: "core",
  },
  {
    path: "/sales/opportunities",
    label: "Opportunities",
    workspace: "sales",
    permission: permissions.opportunitiesView,
    kind: "core",
  },
  {
    path: "/sales/activities",
    label: "Activities",
    workspace: "sales",
    permission: permissions.activitiesView,
    kind: "core",
  },
  {
    path: "/sales/products",
    label: "Products / Catalog",
    workspace: "sales",
    permission: permissions.catalogView,
    kind: "core",
  },
  {
    path: "/sales/management",
    label: "Sales management",
    workspace: "sales",
    permission: permissions.salesManagementView,
    kind: "management",
  },
  {
    path: "/sales/support",
    label: "Sales support",
    workspace: "sales",
    permission: permissions.salesSupportAct,
    kind: "support",
  },
] as const;
