import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import {
  Prisma,
  type DatabaseClient,
  type TransactionClient,
  type TransactionManager,
} from "@abp/database";
import { ApiProblem } from "../platform/api-exception.filter.js";
import {
  databaseClientToken,
  transactionManagerToken,
} from "../platform/database.providers.js";
import type { CustomerIdentity } from "../customer/customer-auth.js";
import type {
  AdminListQuery,
  CountriesDto,
  CreateRoleDto,
  CreateUserDto,
  InviteDto,
  LifecycleDto,
  LogoutDto,
  RevokeDto,
  RolesDto,
  UpdateRoleDto,
  UpdateUserDto,
} from "./identity.dto.js";
import { hashPassword } from "../security/password.service.js";

const TEMP_PASSWORD_LOWER = "abcdefghijkmnopqrstuvwxyz";
const TEMP_PASSWORD_UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const TEMP_PASSWORD_DIGITS = "23456789";
const TEMP_PASSWORD_SYMBOLS = "!@#$%^&*-_+=";

function generateTempPassword(): string {
  const pick = (alphabet: string) => alphabet[randomInt(alphabet.length)];
  const required = [
    pick(TEMP_PASSWORD_LOWER),
    pick(TEMP_PASSWORD_UPPER),
    pick(TEMP_PASSWORD_DIGITS),
    pick(TEMP_PASSWORD_SYMBOLS),
  ];
  const all =
    TEMP_PASSWORD_LOWER +
    TEMP_PASSWORD_UPPER +
    TEMP_PASSWORD_DIGITS +
    TEMP_PASSWORD_SYMBOLS;
  const filler = Array.from({ length: 12 }, () => pick(all));
  const characters = [...required, ...filler];
  // Fisher-Yates using CSPRNG bytes, avoids Array.sort(Math.random) bias.
  const bytes = randomBytes(characters.length);
  for (let i = characters.length - 1; i > 0; i -= 1) {
    const j = bytes[i]! % (i + 1);
    [characters[i], characters[j]] = [characters[j]!, characters[i]!];
  }
  return characters.join("");
}
const userInclude = { profile: true } as const;
@Injectable()
export class IdentityService {
  constructor(
    @Inject(databaseClientToken) private readonly db: DatabaseClient,
    @Inject(transactionManagerToken) private readonly txs: TransactionManager,
  ) {}
  async permissions(i: CustomerIdentity, q: AdminListQuery) {
    this.require(i, "roles.view");
    const s = skip(q),
      where = q.search
        ? {
            OR: [
              { code: { contains: q.search, mode: "insensitive" as const } },
              {
                description: {
                  contains: q.search,
                  mode: "insensitive" as const,
                },
              },
            ],
          }
        : {};
    const [total, rows] = await this.db.$transaction([
      this.db.permission.count({ where }),
      this.db.permission.findMany({
        where,
        skip: s,
        take: q.limit,
        orderBy: { code: "asc" },
      }),
    ]);
    return {
      data: rows.map((x) => ({
        permissionId: x.id,
        permissionCode: x.code,
        description: x.description,
      })),
      meta: meta(s, q.limit, total, rows.length),
    };
  }
  async roles(i: CustomerIdentity, q: AdminListQuery) {
    this.require(i, "roles.view");
    const s = skip(q),
      where = q.search
        ? {
            OR: [
              { code: { contains: q.search, mode: "insensitive" as const } },
              { name: { contains: q.search, mode: "insensitive" as const } },
            ],
          }
        : {};
    const [total, rows] = await this.db.$transaction([
      this.db.role.count({ where }),
      this.db.role.findMany({
        where,
        skip: s,
        take: q.limit,
        orderBy: { code: "asc" },
      }),
    ]);
    return { data: rows.map(role), meta: meta(s, q.limit, total, rows.length) };
  }
  async createRole(i: CustomerIdentity, key: string, b: CreateRoleDto) {
    this.require(i, "roles.manage");
    needKey(key);
    const h = hash(b),
      replay = await this.replay(i, "ROLE_CREATE", key, h);
    if (replay) {
      const x = await this.db.role.findUnique({ where: { id: replay } });
      if (!x) missing();
      return { data: role(x), etag: tag(x.rowVersion) };
    }
    const ps = await this.db.permission.findMany({
      where: { id: { in: b.permissionIds } },
    });
    if (ps.length !== b.permissionIds.length) rule("UNKNOWN_PERMISSION");
    return this.txs.run(i, async (tx) => {
      const x = await tx.role.create({
        data: {
          code: b.roleCode,
          name: b.name.trim(),
          workspace: workspace(b.roleCode),
          permissions: { create: ps.map((p) => ({ permissionCode: p.code })) },
        },
      });
      await remember(tx, i, "ROLE_CREATE", key, h, x.id);
      await events(tx, i, "ROLE_CREATED", "ROLE", x.id, {
        permissionCodes: ps.map((p) => p.code),
      });
      return { data: role(x), etag: tag(x.rowVersion) };
    });
  }
  async updateRole(
    i: CustomerIdentity,
    id: string,
    t: string,
    b: UpdateRoleDto,
  ) {
    this.require(i, "roles.manage");
    const expected = etag(t),
      before = await this.db.role.findUnique({ where: { id } });
    if (!before) missing();
    if (before.systemProtected && b.isSystemProtected === false)
      throw new ApiProblem({ status: 409, code: "SYSTEM_ROLE_PROTECTED" });
    let ps: { code: string }[] | undefined;
    if (b.permissionIds) {
      ps = await this.db.permission.findMany({
        where: { id: { in: b.permissionIds } },
        select: { code: true },
      });
      if (ps.length !== b.permissionIds.length) rule("UNKNOWN_PERMISSION");
    }
    return this.txs.run(i, async (tx) => {
      const n = await tx.role.updateMany({
        where: { id, rowVersion: expected },
        data: {
          ...(b.name ? { name: b.name.trim() } : {}),
          ...(b.isSystemProtected === true ? { systemProtected: true } : {}),
          rowVersion: { increment: 1 },
        },
      });
      if (n.count !== 1) precondition();
      if (ps) {
        await tx.rolePermission.deleteMany({ where: { roleId: id } });
        await tx.rolePermission.createMany({
          data: ps.map((p) => ({ roleId: id, permissionCode: p.code })),
        });
      }
      const x = await tx.role.findUniqueOrThrow({ where: { id } });
      await events(tx, i, "ROLE_UPDATED", "ROLE", id, {
        permissionCodes: ps?.map((p) => p.code) ?? null,
      });
      return { data: role(x), etag: tag(x.rowVersion) };
    });
  }
  /** Lightweight name roster for the caller's own country scope — not the
   * admin user list. Lets a Sales Manager resolve ownerUserId -> displayName
   * on their own team (e.g. a "top reps" leaderboard) without users.view. */
  async roster(i: CustomerIdentity) {
    this.require(i, "sales.management.view");
    const rows = await this.db.appUser.findMany({
      where: {
        active: true,
        authStatusCode: "ACTIVE",
        countries: {
          some: {
            countryCode: { in: [...i.countryCodes] },
            statusCode: "ACTIVE",
          },
        },
      },
      select: { id: true, displayName: true },
      orderBy: { displayName: "asc" },
    });
    return {
      data: rows.map((x) => ({ userId: x.id, displayName: x.displayName })),
    };
  }
  async users(i: CustomerIdentity, q: AdminListQuery) {
    this.require(i, "users.view");
    const s = skip(q),
      where = q.search
        ? {
            OR: [
              {
                emailNormalized: {
                  contains: q.search,
                  mode: "insensitive" as const,
                },
              },
              {
                displayName: {
                  contains: q.search,
                  mode: "insensitive" as const,
                },
              },
            ],
          }
        : {};
    const [total, rows] = await this.db.$transaction([
      this.db.appUser.count({ where }),
      this.db.appUser.findMany({
        where,
        include: userInclude,
        skip: s,
        take: q.limit,
        orderBy: { displayName: "asc" },
      }),
    ]);
    return { data: rows.map(user), meta: meta(s, q.limit, total, rows.length) };
  }
  async createUser(i: CustomerIdentity, key: string, b: CreateUserDto) {
    this.require(i, "users.create");
    needKey(key);
    await this.validateRolesCountries(b.roleIds, b.countryCodes);
    if (
      b.managerUserId &&
      !(await this.db.appUser.findUnique({ where: { id: b.managerUserId } }))
    )
      missing();
    const h = hash(b),
      replay = await this.replay(i, "USER_CREATE", key, h);
    // A replayed request never re-issues the temp password — it was only
    // ever returned once, on the original response.
    if (replay) {
      const r = await this.userResult(replay);
      return { ...r, tempPassword: null as string | null };
    }
    // A sign-in name is unique across the tenant, so it is checked before the
    // temp password is generated rather than letting the unique index fail the
    // transaction and lose the password with it.
    const username = b.username?.trim().toLowerCase() || null;
    if (username) {
      const taken = await this.db.appUser.findFirst({
        where: { usernameNormalized: username },
        select: { id: true },
      });
      if (taken) throw new ApiProblem({ status: 409, code: "USERNAME_TAKEN" });
    }
    const tempPassword = generateTempPassword();
    const passwordHash = await hashPassword(tempPassword);
    return this.txs.run(i, async (tx) => {
      const id = randomUUID(),
        email = b.email.trim().toLowerCase();
      const x = await tx.appUser.create({
        data: {
          id,
          externalSubject: `local:${id}`,
          emailNormalized: email,
          usernameNormalized: username,
          displayName: b.displayName.trim(),
          authStatusCode: "ACTIVE",
          authProvider: "LOCAL",
          active: true,
          passwordHash,
          mustChangePassword: true,
          // MFA is optional/self-serve: users can enroll from Settings ->
          // Security whenever they choose; new accounts are never forced in.
          mfaRequired: false,
          profile: {
            create: {
              displayName: b.displayName.trim(),
              jobTitle: b.jobTitle ?? null,
              managerUserId: b.managerUserId ?? null,
              teamId: b.teamId ?? null,
            },
          },
          roles: { create: b.roleIds.map((roleId) => ({ roleId })) },
          countries: {
            create: b.countryCodes.map((c) => ({
              countryCode: c.toUpperCase(),
              grantedBy: i.userId,
              statusCode: "ACTIVE",
            })),
          },
        },
        include: userInclude,
      });
      await remember(tx, i, "USER_CREATE", key, h, id);
      await events(tx, i, "USER_CREATED", "USER", id, {
        countryCodes: b.countryCodes,
        roleIds: b.roleIds,
      });
      return { data: user(x), etag: tag(x.rowVersion), tempPassword };
    });
  }
  /** Public, unauthenticated — writes an AccessRequest row only. No account
   * is created and no access is granted; an admin must review and approve. */
  async submitAccessRequest(b: {
    fullName: string;
    workEmail: string;
    companyOrRole?: string | null;
    countryCode?: string | null;
    message?: string | null;
  }) {
    const x = await this.db.accessRequest.create({
      data: {
        fullName: b.fullName.trim(),
        workEmail: b.workEmail.trim().toLowerCase(),
        companyOrRole: b.companyOrRole?.trim() || null,
        countryCode: b.countryCode?.trim().toUpperCase() || null,
        message: b.message?.trim() || null,
      },
    });
    await this.db.auditEvent.create({
      data: {
        actorUserId: null,
        actionCode: "ACCESS_REQUEST_SUBMITTED",
        resourceType: "ACCESS_REQUEST",
        resourceId: x.id,
        workspace: "ADMIN",
        countryCode: x.countryCode,
        metadata: { workEmail: x.workEmail },
        source: "API",
        traceId: randomUUID(),
        correlationId: randomUUID(),
      },
    });
    return { data: accessRequest(x) };
  }
  async accessRequests(i: CustomerIdentity, q: AdminListQuery) {
    this.require(i, "users.view");
    const s = skip(q),
      where = q.search
        ? {
            OR: [
              {
                fullName: {
                  contains: q.search,
                  mode: "insensitive" as const,
                },
              },
              {
                workEmail: {
                  contains: q.search,
                  mode: "insensitive" as const,
                },
              },
            ],
          }
        : {};
    const [total, rows] = await this.db.$transaction([
      this.db.accessRequest.count({ where }),
      this.db.accessRequest.findMany({
        where,
        skip: s,
        take: q.limit,
        orderBy: { createdAt: "desc" },
      }),
    ]);
    return {
      data: rows.map(accessRequest),
      meta: meta(s, q.limit, total, rows.length),
    };
  }
  async approveAccessRequest(
    i: CustomerIdentity,
    id: string,
    t: string,
    key: string,
    b: {
      jobTitle?: string | null;
      roleIds: string[];
      countryCodes: string[];
    },
  ) {
    this.require(i, "users.create");
    const expected = etag(t),
      before = await this.db.accessRequest.findUnique({ where: { id } });
    if (!before) missing();
    if (before.statusCode !== "PENDING") rule("ACCESS_REQUEST_NOT_PENDING");
    const created = await this.createUser(i, key, {
      email: before.workEmail,
      displayName: before.fullName,
      jobTitle: b.jobTitle ?? before.companyOrRole ?? null,
      roleIds: b.roleIds,
      countryCodes: b.countryCodes,
    });
    return this.txs.run(i, async (tx) => {
      const n = await tx.accessRequest.updateMany({
        where: { id, rowVersion: expected },
        data: {
          statusCode: "APPROVED",
          reviewedByUserId: i.userId,
          reviewedAt: new Date(),
          createdUserId: created.data.userId,
          rowVersion: { increment: 1 },
        },
      });
      if (n.count !== 1) precondition();
      await events(tx, i, "ACCESS_REQUEST_APPROVED", "ACCESS_REQUEST", id, {
        createdUserId: created.data.userId,
      });
      const x = await tx.accessRequest.findUniqueOrThrow({ where: { id } });
      return {
        data: accessRequest(x),
        user: created.data,
        tempPassword: created.tempPassword,
      };
    });
  }
  async rejectAccessRequest(
    i: CustomerIdentity,
    id: string,
    t: string,
    b: { reason: string },
  ) {
    this.require(i, "users.manage");
    const expected = etag(t);
    return this.txs.run(i, async (tx) => {
      const n = await tx.accessRequest.updateMany({
        where: { id, rowVersion: expected, statusCode: "PENDING" },
        data: {
          statusCode: "REJECTED",
          reviewedByUserId: i.userId,
          reviewedAt: new Date(),
          rejectionReason: b.reason,
          rowVersion: { increment: 1 },
        },
      });
      if (n.count !== 1) precondition();
      await events(tx, i, "ACCESS_REQUEST_REJECTED", "ACCESS_REQUEST", id, {
        reason: b.reason,
      });
      const x = await tx.accessRequest.findUniqueOrThrow({ where: { id } });
      return { data: accessRequest(x) };
    });
  }
  async updateUser(
    i: CustomerIdentity,
    id: string,
    t: string,
    b: UpdateUserDto,
  ) {
    this.require(i, "users.manage");
    const expected = etag(t),
      before = await this.db.appUser.findUnique({ where: { id } });
    if (!before) missing();
    if (b.managerUserId === id) rule("SELF_MANAGER_INVALID");
    return this.txs.run(i, async (tx) => {
      const n = await tx.appUser.updateMany({
        where: { id, rowVersion: expected },
        data: {
          ...(b.displayName ? { displayName: b.displayName.trim() } : {}),
          rowVersion: { increment: 1 },
          policyVersion: { increment: 1 },
        },
      });
      if (n.count !== 1) precondition();
      await tx.userProfile.upsert({
        where: { userId: id },
        create: {
          userId: id,
          displayName: b.displayName ?? before.displayName,
          jobTitle: b.jobTitle ?? null,
          managerUserId: b.managerUserId ?? null,
          teamId: b.teamId ?? null,
        },
        update: {
          ...(b.displayName ? { displayName: b.displayName } : {}),
          ...(b.jobTitle !== undefined ? { jobTitle: b.jobTitle } : {}),
          ...(b.managerUserId !== undefined
            ? { managerUserId: b.managerUserId }
            : {}),
          ...(b.teamId !== undefined ? { teamId: b.teamId } : {}),
        },
      });
      await events(tx, i, "USER_UPDATED", "USER", id, {});
      const x = await tx.appUser.findUniqueOrThrow({
        where: { id },
        include: userInclude,
      });
      return { data: user(x), etag: tag(x.rowVersion) };
    });
  }
  async lifecycle(
    i: CustomerIdentity,
    id: string,
    key: string,
    b: LifecycleDto,
    target: "ACTIVE" | "SUSPENDED" | "DISABLED",
  ) {
    this.require(i, "users.manage");
    needKey(key);
    if (id === i.userId && target !== "ACTIVE")
      throw new ApiProblem({ status: 409, code: "SELF_DISABLE_FORBIDDEN" });
    const h = hash({ id, b, target }),
      replay = await this.replay(i, "USER_LIFECYCLE", key, h);
    if (replay) return { data: (await this.userResult(id)).data };
    return this.txs.run(i, async (tx) => {
      const n = await tx.appUser.updateMany({
        where: { id, rowVersion: BigInt(b.expectedRowVersion) },
        data: {
          authStatusCode: target,
          active: target === "ACTIVE",
          rowVersion: { increment: 1 },
          policyVersion: { increment: 1 },
        },
      });
      if (n.count !== 1) precondition();
      if (target !== "ACTIVE")
        await tx.appSession.updateMany({
          where: { userId: id, statusCode: "ACTIVE" },
          data: {
            statusCode: "REVOKED",
            revokedAt: new Date(),
            revokedByUserId: i.userId,
          },
        });
      await remember(tx, i, "USER_LIFECYCLE", key, h, id);
      await events(tx, i, `USER_${target}`, "USER", id, { reason: b.reason });
      const x = await tx.appUser.findUniqueOrThrow({
        where: { id },
        include: userInclude,
      });
      return { data: user(x) };
    });
  }
  async invite(i: CustomerIdentity, id: string, key: string, b: InviteDto) {
    this.require(i, "users.manage");
    needKey(key);
    const x = await this.db.appUser.findUnique({ where: { id } });
    if (!x) missing();
    if (x.rowVersion !== BigInt(b.expectedRowVersion)) precondition();
    const h = hash({ id, b }),
      replay = await this.replay(i, "USER_INVITE", key, h);
    if (replay)
      return {
        data: {
          success: true,
          resourceId: id,
          statusCode: b.deliveryChannel === "EMAIL" ? "QUEUED" : "MANUAL_READY",
        },
      };
    return this.txs.run(i, async (tx) => {
      let jobId: string | undefined;
      if (b.deliveryChannel === "EMAIL") {
        const j = await tx.durableJob.create({
          data: {
            type: "USER_INVITE_EMAIL",
            status: "PENDING",
            payload: { userId: id, expiresInHours: b.expiresInHours },
            traceId: i.traceId,
            correlationId: i.correlationId,
            idempotencyKey: `invite:${id}:${x.rowVersion}`,
            sourceType: "USER",
            sourceId: id,
          },
        });
        jobId = j.id;
      }
      await remember(tx, i, "USER_INVITE", key, h, id);
      await events(tx, i, "USER_INVITE_REQUESTED", "USER", id, {
        deliveryChannel: b.deliveryChannel,
        jobId: jobId ?? null,
      });
      return {
        data: {
          success: true,
          resourceId: id,
          statusCode: jobId ? "QUEUED" : "MANUAL_READY",
          jobId: jobId ?? null,
        },
      };
    });
  }
  async countries(
    i: CustomerIdentity,
    id: string,
    t: string,
    key: string,
    b: CountriesDto,
  ) {
    this.require(i, "country-access.manage");
    return this.replaceAccess(
      i,
      id,
      t,
      key,
      "USER_COUNTRIES_SET",
      b.reason,
      b,
      async (tx) => {
        const valid = await tx.country.count({
          where: {
            code: { in: b.countryCodes.map((c) => c.toUpperCase()) },
            active: true,
          },
        });
        if (valid !== b.countryCodes.length) rule("UNKNOWN_COUNTRY");
        await tx.userCountryAccess.deleteMany({ where: { userId: id } });
        await tx.userCountryAccess.createMany({
          data: b.countryCodes.map((c) => ({
            userId: id,
            countryCode: c.toUpperCase(),
            grantedBy: i.userId,
            statusCode: "ACTIVE",
          })),
        });
      },
    );
  }
  async setRoles(
    i: CustomerIdentity,
    id: string,
    t: string,
    key: string,
    b: RolesDto,
  ) {
    this.require(i, "roles.assign");
    if (b.validTo && new Date(b.validTo) <= new Date())
      rule("INVALID_ROLE_VALIDITY");
    return this.replaceAccess(
      i,
      id,
      t,
      key,
      "USER_ROLES_SET",
      b.reason,
      b,
      async (tx) => {
        const valid = await tx.role.count({
          where: { id: { in: b.roleIds }, active: true },
        });
        if (valid !== b.roleIds.length) rule("UNKNOWN_ROLE");
        await tx.userRole.deleteMany({ where: { userId: id } });
        await tx.userRole.createMany({
          data: b.roleIds.map((roleId) => ({ userId: id, roleId })),
        });
      },
    );
  }
  async revoke(i: CustomerIdentity, id: string, key: string, b: RevokeDto) {
    this.require(i, "sessions.revoke");
    needKey(key);
    const h = hash({ id, b }),
      replay = await this.replay(i, "SESSIONS_REVOKE", key, h);
    if (!replay)
      await this.txs.run(i, async (tx) => {
        await tx.appSession.updateMany({
          where: {
            userId: id,
            statusCode: "ACTIVE",
            ...(b.exceptCurrentSession ? { id: { not: i.sessionId } } : {}),
          },
          data: {
            statusCode: "REVOKED",
            revokedAt: new Date(),
            revokedByUserId: i.userId,
          },
        });
        await remember(tx, i, "SESSIONS_REVOKE", key, h, id);
        await events(tx, i, "SESSIONS_REVOKED", "USER", id, {
          reason: b.reason,
        });
      });
    return { data: { success: true, resourceId: id, statusCode: "REVOKED" } };
  }
  async logout(i: CustomerIdentity, key: string, b: LogoutDto) {
    needKey(key);
    const h = hash({ b, session: i.sessionId }),
      replay = await this.replay(i, "LOGOUT", key, h);
    if (!replay)
      await this.txs.run(i, async (tx) => {
        await tx.appSession.updateMany({
          where: {
            userId: i.userId,
            statusCode: "ACTIVE",
            ...(b.allSessions ? {} : { id: i.sessionId }),
          },
          data: {
            statusCode: "REVOKED",
            revokedAt: new Date(),
            revokedByUserId: i.userId,
          },
        });
        await remember(tx, i, "LOGOUT", key, h, i.userId);
        await events(tx, i, "LOGOUT", "USER", i.userId, {
          allSessions: b.allSessions,
        });
      });
    return {
      data: { success: true, resourceId: i.userId, statusCode: "REVOKED" },
    };
  }
  /**
   * One user's effective access: their roles, the countries they may see, the
   * permissions those add up to, and any explicit denies.
   *
   * The projection below has existed the whole time and was only ever returned
   * *after* a change, by the two PUTs. With no way to read it first, an
   * administrator setting roles or countries was overwriting a list they could
   * not see — which is how somebody's access gets stripped by accident.
   */
  async userAccess(i: CustomerIdentity, id: string) {
    this.require(i, "users.view");
    return { data: await this.access(id) };
  }

  private async replaceAccess(
    i: CustomerIdentity,
    id: string,
    t: string,
    key: string,
    op: string,
    reason: string,
    fingerprint: unknown,
    work: (tx: TransactionClient) => Promise<void>,
  ) {
    needKey(key);
    const expected = etag(t),
      h = hash({ id, op, reason, fingerprint });
    const replay = await this.replay(i, op, key, h);
    if (replay) return { data: await this.access(id), etag: t };
    return this.txs.run(i, async (tx) => {
      const n = await tx.appUser.updateMany({
        where: { id, rowVersion: expected },
        data: { rowVersion: { increment: 1 }, policyVersion: { increment: 1 } },
      });
      if (n.count !== 1) precondition();
      await work(tx);
      await remember(tx, i, op, key, h, id);
      await events(tx, i, op, "USER", id, { reason });
      const x = await tx.appUser.findUniqueOrThrow({ where: { id } });
      return { data: await this.access(id, tx), etag: tag(x.rowVersion) };
    });
  }
  private async access(
    id: string,
    db: DatabaseClient | TransactionClient = this.db,
  ) {
    const u = await db.appUser.findUnique({
      where: { id },
      include: {
        profile: true,
        roles: { include: { role: { include: { permissions: true } } } },
        countries: true,
        permissionOverrides: true,
      },
    });
    if (!u) missing();
    const denies = u.permissionOverrides
        .filter((x) => x.effectCode === "DENY")
        .map((x) => x.permissionCode),
      allows = u.permissionOverrides
        .filter((x) => x.effectCode === "ALLOW")
        .map((x) => x.permissionCode),
      ps = [
        ...new Set([
          ...u.roles.flatMap((x) =>
            x.role.permissions.map((p) => p.permissionCode),
          ),
          ...allows,
        ]),
      ].filter((x) => !denies.includes(x));
    return {
      user: user(u),
      roles: u.roles.map((x) => role(x.role)),
      permissions: ps,
      countryCodes: u.countries
        .filter((x) => x.statusCode === "ACTIVE")
        .map((x) => x.countryCode.trim()),
      effectiveDenies: denies,
    };
  }
  private async validateRolesCountries(rs: string[], cs: string[]) {
    if (
      (await this.db.role.count({
        where: { id: { in: rs }, active: true },
      })) !== rs.length
    )
      rule("UNKNOWN_ROLE");
    if (
      (await this.db.country.count({
        where: { code: { in: cs.map((x) => x.toUpperCase()) }, active: true },
      })) !== cs.length
    )
      rule("UNKNOWN_COUNTRY");
  }
  private async userResult(id: string) {
    const x = await this.db.appUser.findUnique({
      where: { id },
      include: userInclude,
    });
    if (!x) missing();
    return { data: user(x), etag: tag(x.rowVersion) };
  }
  private require(i: CustomerIdentity, p: string) {
    if (i.deniedPermissions.has(p) || !i.permissions.has(p)) forbid();
  }
  private replay(i: CustomerIdentity, op: string, k: string, h: string) {
    return this.db.commandIdempotency
      .findUnique({
        where: {
          actorUserId_operationCode_idempotencyKey: {
            actorUserId: i.userId,
            operationCode: op,
            idempotencyKey: k,
          },
        },
      })
      .then((x) => {
        if (x && x.requestHash !== h)
          throw new ApiProblem({ status: 409, code: "IDEMPOTENCY_KEY_REUSED" });
        return x?.responseResourceId ?? null;
      });
  }
}
const skip = (q: AdminListQuery) => q.offset ?? (q.page - 1) * q.limit;
const meta = (o: number, l: number, t: number, c: number) => ({
  page: Math.floor(o / l) + 1,
  offset: o,
  limit: l,
  total: t,
  hasNext: o + c < t,
});
const role = (x: {
  id: string;
  code: string;
  name: string;
  systemProtected: boolean;
}) => ({
  roleId: x.id,
  roleCode: x.code,
  name: x.name,
  isSystemProtected: x.systemProtected,
});
function user(x: {
  id: string;
  emailNormalized: string;
  displayName: string;
  authStatusCode: string;
  lastSignInAt: Date | null;
  rowVersion: bigint;
  mustChangePassword: boolean;
  mfaRequired: boolean;
  mfaEnabled: boolean;
  profile: {
    jobTitle: string | null;
    managerUserId: string | null;
    teamId: string | null;
  } | null;
}) {
  return {
    userId: x.id,
    email: x.emailNormalized,
    displayName: x.displayName,
    jobTitle: x.profile?.jobTitle ?? null,
    managerUserId: x.profile?.managerUserId ?? null,
    teamId: x.profile?.teamId ?? null,
    authStatusCode: x.authStatusCode,
    lastSignInAt: x.lastSignInAt?.toISOString() ?? null,
    rowVersion: x.rowVersion.toString(),
    mustChangePassword: x.mustChangePassword,
    mfaRequired: x.mfaRequired,
    mfaEnabled: x.mfaEnabled,
  };
}
function accessRequest(x: {
  id: string;
  fullName: string;
  workEmail: string;
  companyOrRole: string | null;
  countryCode: string | null;
  message: string | null;
  statusCode: string;
  reviewedByUserId: string | null;
  reviewedAt: Date | null;
  rejectionReason: string | null;
  createdUserId: string | null;
  rowVersion: bigint;
  createdAt: Date;
}) {
  return {
    accessRequestId: x.id,
    fullName: x.fullName,
    workEmail: x.workEmail,
    companyOrRole: x.companyOrRole,
    countryCode: x.countryCode,
    message: x.message,
    statusCode: x.statusCode,
    reviewedByUserId: x.reviewedByUserId,
    reviewedAt: x.reviewedAt?.toISOString() ?? null,
    rejectionReason: x.rejectionReason,
    createdUserId: x.createdUserId,
    rowVersion: x.rowVersion.toString(),
    createdAt: x.createdAt.toISOString(),
  };
}
const tag = (x: bigint) => `\"rv-${x}\"`;
function etag(v: string) {
  const m = /^(?:W\/)?\"?rv-(\d+)\"?$/.exec(v.trim());
  if (!m) throw new ApiProblem({ status: 400, code: "IF_MATCH_REQUIRED" });
  return BigInt(m[1]!);
}
const hash = (x: unknown) =>
  createHash("sha256").update(JSON.stringify(x)).digest("hex");
const workspace = (c: string) =>
  c.startsWith("FINANCE")
    ? "FINANCE"
    : c.startsWith("LOGISTICS")
      ? "LOGISTICS"
      : c.startsWith("OPERATIONS")
        ? "OPERATIONS"
        : "SALES";
function needKey(x: string) {
  if (!x || x.length > 200)
    throw new ApiProblem({ status: 400, code: "IDEMPOTENCY_KEY_REQUIRED" });
}
function missing(): never {
  throw new ApiProblem({ status: 404, code: "RESOURCE_NOT_FOUND" });
}
function rule(c: string): never {
  throw new ApiProblem({ status: 422, code: c });
}
function precondition(): never {
  throw new ApiProblem({ status: 412, code: "CONCURRENCY_CONFLICT" });
}
function forbid(): never {
  throw new ApiProblem({ status: 403, code: "FORBIDDEN" });
}
async function remember(
  tx: TransactionClient,
  i: CustomerIdentity,
  op: string,
  k: string,
  h: string,
  id: string,
) {
  await tx.commandIdempotency.create({
    data: {
      actorUserId: i.userId,
      operationCode: op,
      idempotencyKey: k,
      requestHash: h,
      responseResourceId: id,
    },
  });
}
async function events(
  tx: TransactionClient,
  i: CustomerIdentity,
  a: string,
  t: string,
  id: string,
  m: Record<string, unknown>,
) {
  const metadata = m as Prisma.InputJsonValue;
  await tx.auditEvent.create({
    data: {
      actorUserId: i.userId,
      actorSessionId: i.sessionId,
      actionCode: a,
      resourceType: t,
      resourceId: id,
      workspace: "ADMIN",
      countryCode: null,
      metadata,
      traceId: i.traceId,
      correlationId: i.correlationId,
      source: "API",
    },
  });
  await tx.securityEvent.create({
    data: {
      eventTypeCode: a,
      actorUserId: i.userId,
      subjectUserId: t === "USER" ? id : null,
      resourceTypeCode: t,
      resourceId: id,
      metadata,
      traceId: i.traceId,
    },
  });
}
