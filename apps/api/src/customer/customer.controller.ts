import {
  Body,
  Delete,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { components } from "@abp/api-client";
import type { DatabaseClient } from "@abp/database";
import { ApiProblem } from "../platform/api-exception.filter.js";
import { databaseClientToken } from "../platform/database.providers.js";
import type { Response } from "express";
import {
  CustomerIdentityGuard,
  isSystemAdmin,
  type CustomerRequest,
} from "./customer-auth.js";
import {
  AccountListQuery,
  ArchiveAccountDto,
  CustomerShareListQuery,
  CreateAccountDto,
  UpdateAccountDto,
  CreateCustomerShareDto,
  DuplicateCheckDto,
  MergeAccountDto,
  MergePreviewDto,
  TransferOwnershipDto,
} from "./customer.dto.js";
import { CustomerService } from "./customer.service.js";

@Controller("accounts")
@UseGuards(CustomerIdentityGuard)
export class CustomerController {
  constructor(private readonly customers: CustomerService) {}

  @Get()
  list(@Req() request: CustomerRequest, @Query() query: AccountListQuery) {
    return this.customers.list(request.customerIdentity, query);
  }

  @Post("duplicate-check")
  @HttpCode(200)
  duplicateCheck(
    @Req() request: CustomerRequest,
    @Body() input: DuplicateCheckDto,
  ) {
    return this.customers.duplicateCheck(request.customerIdentity, input);
  }

  @Post()
  async create(
    @Req() request: CustomerRequest,
    @Res({ passthrough: true }) response: Response,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() input: CreateAccountDto,
  ) {
    const data = await this.customers.create(
      request.customerIdentity,
      input,
      idempotencyKey ?? "",
    );
    response.status(201).setHeader("ETag", data.rowVersion);
    return { data };
  }

  @Get("formwork-mix")
  formworkMix(@Req() request: CustomerRequest) {
    return this.customers.formworkMix(request.customerIdentity);
  }

  @Get(":accountId/commercial-history")
  commercialHistory(
    @Req() request: CustomerRequest,
    @Param("accountId", new ParseUUIDPipe()) accountId: string,
  ) {
    return this.customers.commercialHistory(
      request.customerIdentity,
      accountId,
    );
  }

  @Get(":accountId")
  async get(
    @Req() request: CustomerRequest,
    @Res({ passthrough: true }) response: Response,
    @Param("accountId", new ParseUUIDPipe()) accountId: string,
  ) {
    const data = await this.customers.get(request.customerIdentity, accountId);
    response.setHeader("ETag", data.rowVersion);
    return { data };
  }

  @Patch(":accountId")
  async update(
    @Req() request: CustomerRequest,
    @Res({ passthrough: true }) response: Response,
    @Param("accountId", new ParseUUIDPipe()) accountId: string,
    @Headers("if-match") ifMatch: string | undefined,
    @Body() input: UpdateAccountDto,
  ) {
    const data = await this.customers.update(
      request.customerIdentity,
      accountId,
      ifMatch ?? "",
      input,
    );
    response.setHeader("ETag", data.rowVersion);
    return { data };
  }

  @Post(":accountId/archive")
  @HttpCode(200)
  async archive(
    @Req() request: CustomerRequest,
    @Res({ passthrough: true }) response: Response,
    @Param("accountId", new ParseUUIDPipe()) accountId: string,
    @Headers("if-match") ifMatch: string | undefined,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() input: ArchiveAccountDto,
  ) {
    const data = await this.customers.archive(
      request.customerIdentity,
      accountId,
      ifMatch ?? "",
      input,
      idempotencyKey ?? "",
    );
    response.setHeader("ETag", data.rowVersion);
    return { data };
  }

  @Post(":accountId/transfer-ownership")
  @HttpCode(200)
  async transferOwnership(
    @Req() request: CustomerRequest,
    @Res({ passthrough: true }) response: Response,
    @Param("accountId", new ParseUUIDPipe()) accountId: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body() input: TransferOwnershipDto,
  ) {
    const data = await this.customers.transferOwnership(
      request.customerIdentity,
      accountId,
      input,
      key ?? "",
    );
    response.setHeader("ETag", data.rowVersion);
    return { data };
  }

  @Post(":accountId/merge-preview")
  @HttpCode(200)
  mergePreview(
    @Req() request: CustomerRequest,
    @Param("accountId", new ParseUUIDPipe()) accountId: string,
    @Body() input: MergePreviewDto,
  ) {
    return this.customers.mergePreview(
      request.customerIdentity,
      accountId,
      input,
    );
  }

  @Post(":accountId/merge")
  @HttpCode(200)
  async merge(
    @Req() request: CustomerRequest,
    @Res({ passthrough: true }) response: Response,
    @Param("accountId", new ParseUUIDPipe()) accountId: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body() input: MergeAccountDto,
  ) {
    const data = await this.customers.merge(
      request.customerIdentity,
      accountId,
      input,
      key ?? "",
    );
    response.setHeader("ETag", data.rowVersion);
    return { data };
  }

  @Get(":accountId/shares")
  listShares(
    @Req() request: CustomerRequest,
    @Param("accountId", new ParseUUIDPipe()) accountId: string,
    @Query() query: CustomerShareListQuery,
  ) {
    return this.customers.listShares(
      request.customerIdentity,
      accountId,
      query,
    );
  }

  @Post(":accountId/shares")
  @HttpCode(200)
  async createShare(
    @Req() request: CustomerRequest,
    @Res({ passthrough: true }) response: Response,
    @Param("accountId", new ParseUUIDPipe()) accountId: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body() input: CreateCustomerShareDto,
  ) {
    const data = await this.customers.createShare(
      request.customerIdentity,
      accountId,
      input,
      key ?? "",
    );
    response.setHeader("ETag", data.rowVersion);
    return { data };
  }
}

@Controller("customer-shares")
@UseGuards(CustomerIdentityGuard)
export class CustomerShareController {
  constructor(private readonly customers: CustomerService) {}

  @Delete(":shareId")
  async revokeShare(
    @Req() request: CustomerRequest,
    @Res({ passthrough: true }) response: Response,
    @Param("shareId", new ParseUUIDPipe()) shareId: string,
    @Headers("if-match") ifMatch: string | undefined,
    @Headers("idempotency-key") key: string | undefined,
  ) {
    const result = await this.customers.revokeShare(
      request.customerIdentity,
      shareId,
      ifMatch ?? "",
      key ?? "",
    );
    response.setHeader("ETag", result.rowVersion);
    return {
      data: {
        success: true,
        resourceId: shareId,
        statusCode: "REVOKED",
        jobId: null,
      },
    };
  }
}

@Controller("reference/countries")
@UseGuards(CustomerIdentityGuard)
export class CountryReferenceController {
  constructor(private readonly customers: CustomerService) {}

  @Get()
  async list(): Promise<components["schemas"]["CountryReferenceListEnvelope"]> {
    return { data: await this.customers.countries() };
  }
}

@Controller("me")
@UseGuards(CustomerIdentityGuard)
export class MeController {
  constructor(
    @Inject(databaseClientToken) private readonly database: DatabaseClient,
  ) {}

  /**
   * What a role can actually do, for the "View as" preview.
   *
   * The preview used to guess a role's permissions from the route matrix in
   * the design document, which disagrees with the roles as seeded: the matrix
   * denies a sales user the targets screen, the seeded Sales Rep role grants
   * `targets.view`. So previewing a salesperson showed a dashboard of dashes
   * that no real salesperson ever sees. This reads the role itself.
   *
   * Only the people who may preview may ask, and it returns permission codes
   * and a workspace -- names of capabilities, not data.
   */
  @Get("role-preview/:roleCode")
  async rolePreview(
    @Req() request: CustomerRequest,
    @Param("roleCode") roleCode: string,
  ) {
    const identity = request.customerIdentity;
    const mayPreview =
      isSystemAdmin(identity) ||
      identity.roles.some(({ code }) => code === "SALES_MANAGER");
    if (!mayPreview)
      throw new ApiProblem({ status: 403, code: "ROLE_PREVIEW_NOT_ALLOWED" });
    const role = await this.database.role.findFirst({
      where: { code: roleCode.trim().toUpperCase(), active: true },
      include: { permissions: { select: { permissionCode: true } } },
    });
    if (role === null)
      throw new ApiProblem({ status: 404, code: "ROLE_NOT_FOUND" });
    return {
      data: {
        roleCode: role.code,
        name: role.name,
        workspace: role.workspace,
        permissions: role.permissions
          .map(({ permissionCode }) => permissionCode)
          .sort(),
      },
    };
  }

  @Get()
  get(@Req() request: CustomerRequest): components["schemas"]["MeEnvelope"] {
    const identity = request.customerIdentity;
    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt.getTime() + 60 * 60 * 1000);
    const permissionCodes = [
      ...identity.permissions,
    ] as components["schemas"]["PermissionCode"][];
    /**
     * A system administrator reaches every workspace — `hasWorkspace` says so
     * before it ever looks at the role's own workspace column. Deriving this
     * list from the roles alone reported one workspace for an account that
     * can open all five, so the profile screen told people something the
     * guard disagreed with.
     */
    const workspaceCodes = isSystemAdmin(identity)
      ? WORKSPACE_CODES
      : [...identity.workspaces].filter(isWorkspace);
    const workspaces = workspaceCodes.map((workspace) => ({
      workspace,
      enabled: true,
      capabilities: permissionCodes,
    }));
    return {
      data: {
        user: {
          userId: identity.userId,
          email: identity.email,
          displayName: identity.displayName,
          authStatusCode: identity.authStatusCode,
          rowVersion: `"rv-${identity.rowVersion.toString()}"`,
          jobTitle: identity.jobTitle,
          photoUpdatedAt: identity.photoUpdatedAt?.toISOString() ?? null,
          managerUserId: identity.managerUserId,
          teamId: identity.teamId,
          lastSignInAt: identity.lastSignInAt?.toISOString() ?? null,
          mustChangePassword: identity.mustChangePassword ?? false,
          mfaRequired: identity.mfaRequired ?? false,
          mfaEnabled: identity.mfaEnabled ?? false,
        },
        session: {
          sessionId: identity.sessionId,
          authTransport: "BFF_COOKIE",
          assurance: "FEDERATED_MFA",
          issuedAt: issuedAt.toISOString(),
          expiresAt: expiresAt.toISOString(),
        },
        access: {
          roles: identity.roles
            .filter(({ workspace }) => isWorkspace(workspace))
            .map((role) => ({
              ...role,
              workspace:
                role.workspace as components["schemas"]["WorkspaceCode"],
            })),
          permissions: permissionCodes,
          countryScope: {
            countryCodes: [...identity.countryCodes],
            enforced: true,
          },
          workspaces,
          policyVersion: identity.policyVersion,
        },
        stepUp: { required: false, satisfied: true, permittedMethods: ["MFA"] },
      },
    };
  }
}

const WORKSPACE_CODES = [
  "SALES",
  "LOGISTICS",
  "OPERATIONS",
  "FINANCE",
  "ADMIN",
] as const satisfies readonly components["schemas"]["WorkspaceCode"][];

function isWorkspace(
  value: string,
): value is components["schemas"]["WorkspaceCode"] {
  return (WORKSPACE_CODES as readonly string[]).includes(value);
}
