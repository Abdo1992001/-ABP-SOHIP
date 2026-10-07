import { Injectable } from "@nestjs/common";
import {
  authorize,
  type AuthorizationDecision,
  type ResourceScope,
} from "@abp/authorization";
import type { AuthorizationContext, PermissionCode } from "@abp/contracts";

@Injectable()
export class AuthorizationPolicyService {
  authorize(
    context: AuthorizationContext,
    permission: PermissionCode,
    resource: ResourceScope,
  ): AuthorizationDecision {
    return authorize(context, permission, resource);
  }
}
