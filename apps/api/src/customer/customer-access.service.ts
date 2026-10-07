import { Injectable } from "@nestjs/common";
import { permissions } from "@abp/contracts";
import { ApiProblem } from "../platform/api-exception.filter.js";
import { hasWorkspace, type CustomerIdentity } from "./customer-auth.js";

@Injectable()
export class CustomerAccessService {
  requireCountry(identity: CustomerIdentity, countryCode: string): void {
    if (!identity.countryCodes.has(countryCode.trim())) this.forbid();
  }

  requirePermission(identity: CustomerIdentity, permission: string): void {
    if (!hasWorkspace(identity, "SALES")) this.forbid();
    if (identity.deniedPermissions.has(permission)) this.forbid();
    if (!identity.permissions.has(permission)) this.forbid();
  }

  requireView(identity: CustomerIdentity): void {
    this.requirePermission(identity, permissions.accountsView);
  }

  forbid(): never {
    throw new ApiProblem({ status: 403, code: "FORBIDDEN" });
  }
}
