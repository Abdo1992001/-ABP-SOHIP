import { createHash } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { components } from "@abp/api-client";
import { permissions } from "@abp/contracts";
import {
  AuditRepository,
  type DatabaseClient,
  Prisma,
  TransactionManager,
  type TransactionClient,
} from "@abp/database";
import { ApiProblem } from "../platform/api-exception.filter.js";
import {
  auditRepositoryToken,
  databaseClientToken,
  transactionManagerToken,
} from "../platform/database.providers.js";
import { CustomerAccessService } from "./customer-access.service.js";
import {
  canUseManagerContext,
  isSystemAdmin,
  type CustomerIdentity,
} from "./customer-auth.js";
import type {
  ContactChannelInputDto,
  ContactDirectoryQuery,
  ContactListQuery,
  CreateContactDto,
  CreateContactShareDto,
  UpdateContactDto,
} from "./contact.dto.js";

type ContactDetail = components["schemas"]["ContactDetail"];
type ContactListItem = components["schemas"]["ContactListItem"];
type ContactListEnvelope = components["schemas"]["ContactListEnvelope"];
type ContactShare = components["schemas"]["ContactShare"];

const contactInclude = {
  account: true,
  channels: { orderBy: [{ channelTypeCode: "asc" }, { id: "asc" }] },
} satisfies Prisma.ContactInclude;

const contactShareInclude = {
  items: { orderBy: { contactId: "asc" } },
  account: true,
} satisfies Prisma.ContactShareInclude;

type ContactWithDetail = Prisma.ContactGetPayload<{
  include: typeof contactInclude;
}>;
type ContactShareWithItems = Prisma.ContactShareGetPayload<{
  include: typeof contactShareInclude;
}>;

@Injectable()
export class ContactService {
  constructor(
    @Inject(databaseClientToken) private readonly database: DatabaseClient,
    @Inject(transactionManagerToken)
    private readonly transactions: TransactionManager,
    @Inject(auditRepositoryToken) private readonly audit: AuditRepository,
    private readonly access: CustomerAccessService,
  ) {}

  async list(
    identity: CustomerIdentity,
    accountId: string,
    query: ContactListQuery,
  ): Promise<ContactListEnvelope> {
    this.access.requirePermission(identity, permissions.contactsView);
    const offset = query.offset ?? (query.page - 1) * query.limit;
    const where: Prisma.ContactWhereInput = {
      accountId,
      account: { countryCode: { in: [...identity.countryCodes] } },
      ...(query.search === undefined || query.search.trim() === ""
        ? {}
        : {
            OR: [
              {
                displayName: {
                  contains: query.search.trim(),
                  mode: "insensitive" as const,
                },
              },
              {
                jobTitle: {
                  contains: query.search.trim(),
                  mode: "insensitive" as const,
                },
              },
              {
                channels: {
                  some: {
                    normalizedValue: {
                      contains: normalizeText(query.search),
                    },
                    channelTypeCode: "EMAIL",
                  },
                },
              },
            ],
          }),
      AND: [{ OR: contactViewContext(identity) }],
    };
    const [total, records] = await this.database.$transaction([
      this.database.contact.count({ where }),
      this.database.contact.findMany({
        where,
        orderBy: contactOrderBy(query.sort),
        skip: offset,
        take: query.limit,
      }),
    ]);
    return {
      data: records.map(toListItem),
      meta: {
        page: Math.floor(offset / query.limit) + 1,
        offset,
        limit: query.limit,
        total,
        hasNext: offset + records.length < total,
      },
    };
  }

  /**
   * Every contact this person may see, across all their customers.
   *
   * The Contacts screen had no list of its own: it borrowed global search and
   * showed nothing until two letters were typed, so a salesperson opening
   * "Contacts" met an empty page. Same visibility as one customer's list --
   * country scope plus the owner / manager / share rules -- with the customer's
   * name and the primary channel, which is what someone opens it to find.
   */
  async directory(identity: CustomerIdentity, query: ContactDirectoryQuery) {
    this.access.requirePermission(identity, permissions.contactsView);
    const offset = query.offset ?? (query.page - 1) * query.limit;
    const term = query.search?.trim() ?? "";
    const where: Prisma.ContactWhereInput = {
      ...(query.accountId ? { accountId: query.accountId } : {}),
      account: { countryCode: { in: [...identity.countryCodes] } },
      ...(term === ""
        ? {}
        : {
            OR: [
              { displayName: { contains: term, mode: "insensitive" as const } },
              { jobTitle: { contains: term, mode: "insensitive" as const } },
              {
                account: {
                  canonicalName: {
                    contains: term,
                    mode: "insensitive" as const,
                  },
                },
              },
              {
                channels: {
                  some: {
                    normalizedValue: { contains: normalizeText(term) },
                    channelTypeCode: "EMAIL",
                  },
                },
              },
            ],
          }),
      AND: [{ OR: contactViewContext(identity) }],
    };
    const [total, records] = await this.database.$transaction([
      this.database.contact.count({ where }),
      this.database.contact.findMany({
        where,
        orderBy: contactOrderBy(query.sort),
        skip: offset,
        take: query.limit,
        include: {
          account: { select: { canonicalName: true, accountRef: true } },
          // The list shows how to write to someone, never a number.
          channels: {
            where: { channelTypeCode: "EMAIL" },
            orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
            take: 1,
          },
        },
      }),
    ]);
    return {
      data: records.map((contact) => ({
        ...toListItem(contact),
        accountName: contact.account.canonicalName,
        accountRef: contact.account.accountRef,
        primaryChannel:
          contact.channels[0] === undefined
            ? null
            : {
                channelTypeCode: contact.channels[0].channelTypeCode,
                value: contact.channels[0].value,
              },
      })),
      meta: {
        page: Math.floor(offset / query.limit) + 1,
        offset,
        limit: query.limit,
        total,
        hasNext: offset + records.length < total,
      },
    };
  }

  async get(
    identity: CustomerIdentity,
    contactId: string,
  ): Promise<ContactDetail> {
    this.access.requirePermission(identity, permissions.contactsView);
    const contact = await this.database.contact.findFirst({
      where: {
        id: contactId,
        account: { countryCode: { in: [...identity.countryCodes] } },
        AND: [{ OR: contactViewContext(identity) }],
      },
      include: contactInclude,
    });
    if (contact === null) this.notFound();
    return toDetail(contact);
  }

  async create(
    identity: CustomerIdentity,
    accountId: string,
    input: CreateContactDto,
    idempotencyKey: string,
  ): Promise<ContactDetail> {
    this.access.requirePermission(identity, permissions.contactsCreate);
    requireIdempotencyKey(idempotencyKey);
    validatePrimaryChannels(input.channels ?? []);
    const requestHash = hashJson({ accountId, input });
    const existing = await this.findIdempotency(
      identity,
      "CONTACT_CREATE",
      idempotencyKey,
      requestHash,
    );
    if (existing !== null) return this.get(identity, existing);

    const account = await this.database.account.findFirst({
      where: {
        id: accountId,
        countryCode: { in: [...identity.countryCodes] },
        recordStatusCode: "ACTIVE",
        OR: accountEditContext(identity),
      },
    });
    if (account === null) this.notFound();

    return this.transactions.run(identity, async (tx) => {
      const contact = await tx.contact.create({
        data: {
          accountId,
          displayName: input.displayName.trim(),
          jobTitle: cleanOptional(input.jobTitle),
          createdByUserId: identity.userId,
          updatedByUserId: identity.userId,
          channels: {
            create: (input.channels ?? []).map((channel) => ({
              channelTypeCode: channel.channelTypeCode,
              value: channel.value.trim(),
              normalizedValue: normalizeChannel(channel),
              isPrimary: channel.isPrimary,
              createdByUserId: identity.userId,
            })),
          },
        },
        include: contactInclude,
      });
      await rememberIdempotency(
        tx,
        identity,
        "CONTACT_CREATE",
        idempotencyKey,
        requestHash,
        contact.id,
      );
      const detail = toDetail(contact);
      await this.appendContactAudit(
        tx,
        identity,
        "CONTACT_CREATED",
        contact,
        null,
        detail,
      );
      return detail;
    });
  }

  async update(
    identity: CustomerIdentity,
    contactId: string,
    expectedTag: string,
    input: UpdateContactDto,
  ): Promise<ContactDetail> {
    this.access.requirePermission(identity, permissions.contactsEdit);
    const expectedVersion = parseRowVersion(expectedTag);
    const before = await this.findEditableContact(identity, contactId);
    if (before === null) this.notFound();

    const outcome = await this.transactions.run(identity, async (tx) => {
      const changed = await tx.contact.updateMany({
        where: { id: contactId, rowVersion: expectedVersion },
        data: {
          ...(input.displayName == null
            ? {}
            : { displayName: input.displayName.trim() }),
          ...(input.jobTitle === undefined
            ? {}
            : { jobTitle: cleanOptional(input.jobTitle) }),
          ...(input.statusCode == null ? {} : { statusCode: input.statusCode }),
          updatedByUserId: identity.userId,
          rowVersion: { increment: 1 },
        },
      });
      if (changed.count !== 1) {
        const current = await tx.contact.findUnique({
          where: { id: contactId },
        });
        return { conflictVersion: current?.rowVersion } as const;
      }
      const updated = await tx.contact.findUniqueOrThrow({
        where: { id: contactId },
        include: contactInclude,
      });
      const detail = toDetail(updated);
      await this.appendContactAudit(
        tx,
        identity,
        "CONTACT_UPDATED",
        updated,
        toDetail(before),
        detail,
      );
      return { detail } as const;
    });
    if ("conflictVersion" in outcome) {
      this.concurrency(
        "CONTACT",
        contactId,
        expectedTag,
        outcome.conflictVersion,
      );
    }
    return outcome.detail;
  }

  async addChannel(
    identity: CustomerIdentity,
    contactId: string,
    input: ContactChannelInputDto,
    idempotencyKey: string,
  ): Promise<ContactDetail> {
    this.access.requirePermission(identity, permissions.contactsEdit);
    requireIdempotencyKey(idempotencyKey);
    const requestHash = hashJson({ contactId, input });
    const existing = await this.findIdempotency(
      identity,
      "CONTACT_CHANNEL_ADD",
      idempotencyKey,
      requestHash,
    );
    if (existing !== null) return this.get(identity, existing);
    const before = await this.findEditableContact(identity, contactId);
    if (before === null) this.notFound();

    return this.transactions.run(identity, async (tx) => {
      if (input.isPrimary) {
        await tx.contactChannel.updateMany({
          where: {
            contactId,
            channelTypeCode: input.channelTypeCode,
            isPrimary: true,
          },
          data: { isPrimary: false },
        });
      }
      await tx.contactChannel.create({
        data: {
          contactId,
          channelTypeCode: input.channelTypeCode,
          value: input.value.trim(),
          normalizedValue: normalizeChannel(input),
          isPrimary: input.isPrimary,
          createdByUserId: identity.userId,
        },
      });
      await tx.contact.update({
        where: { id: contactId },
        data: {
          updatedByUserId: identity.userId,
          rowVersion: { increment: 1 },
        },
      });
      await rememberIdempotency(
        tx,
        identity,
        "CONTACT_CHANNEL_ADD",
        idempotencyKey,
        requestHash,
        contactId,
      );
      const updated = await tx.contact.findUniqueOrThrow({
        where: { id: contactId },
        include: contactInclude,
      });
      const detail = toDetail(updated);
      await this.appendContactAudit(
        tx,
        identity,
        "CONTACT_CHANNEL_ADDED",
        updated,
        toDetail(before),
        detail,
      );
      return detail;
    });
  }

  async removeChannel(
    identity: CustomerIdentity,
    channelId: string,
    expectedTag: string,
    idempotencyKey: string,
  ): Promise<ContactDetail> {
    this.access.requirePermission(identity, permissions.contactsEdit);
    requireIdempotencyKey(idempotencyKey);
    const expectedVersion = parseRowVersion(expectedTag);
    const requestHash = hashJson({ channelId, expectedTag });
    const existing = await this.findIdempotency(
      identity,
      "CONTACT_CHANNEL_REMOVE",
      idempotencyKey,
      requestHash,
    );
    if (existing !== null) return this.get(identity, existing);
    const channel = await this.database.contactChannel.findFirst({
      where: {
        id: channelId,
        contact: editableContactWhere(identity),
      },
      include: { contact: { include: contactInclude } },
    });
    if (channel === null) this.notFound();
    const before = channel.contact;

    const outcome = await this.transactions.run(identity, async (tx) => {
      const changed = await tx.contact.updateMany({
        where: { id: before.id, rowVersion: expectedVersion },
        data: {
          updatedByUserId: identity.userId,
          rowVersion: { increment: 1 },
        },
      });
      if (changed.count !== 1) {
        const current = await tx.contact.findUnique({
          where: { id: before.id },
        });
        return { conflictVersion: current?.rowVersion } as const;
      }
      await tx.contactChannel.delete({ where: { id: channelId } });
      await rememberIdempotency(
        tx,
        identity,
        "CONTACT_CHANNEL_REMOVE",
        idempotencyKey,
        requestHash,
        before.id,
      );
      const updated = await tx.contact.findUniqueOrThrow({
        where: { id: before.id },
        include: contactInclude,
      });
      const detail = toDetail(updated);
      await this.appendContactAudit(
        tx,
        identity,
        "CONTACT_CHANNEL_REMOVED",
        updated,
        toDetail(before),
        detail,
      );
      return { detail } as const;
    });
    if ("conflictVersion" in outcome) {
      this.concurrency(
        "CONTACT",
        before.id,
        expectedTag,
        outcome.conflictVersion,
      );
    }
    return outcome.detail;
  }

  async share(
    identity: CustomerIdentity,
    accountId: string,
    input: CreateContactShareDto,
    idempotencyKey: string,
  ): Promise<ContactShare> {
    this.access.requirePermission(identity, permissions.contactsShare);
    requireIdempotencyKey(idempotencyKey);
    const contactIds = [...new Set(input.contactIds)].sort();
    if (contactIds.length !== input.contactIds.length) {
      throw new ApiProblem({
        status: 422,
        code: "DUPLICATE_CONTACT_SHARE_ITEM",
      });
    }
    const expiresAt =
      input.expiresAt == null ? null : new Date(input.expiresAt);
    if (expiresAt !== null && expiresAt.getTime() <= Date.now()) {
      throw new ApiProblem({ status: 422, code: "SHARE_EXPIRY_IN_PAST" });
    }
    const requestHash = hashJson({
      accountId,
      recipientUserId: input.recipientUserId,
      contactIds,
      accessLevelCode: input.accessLevelCode,
      expiresAt: input.expiresAt ?? null,
    });
    const existing = await this.findIdempotency(
      identity,
      "CONTACT_SHARE_CREATE",
      idempotencyKey,
      requestHash,
    );
    if (existing !== null) return this.getShareForOwner(identity, existing);

    const account = await this.database.account.findFirst({
      where: {
        id: accountId,
        ownerUserId: identity.userId,
        countryCode: { in: [...identity.countryCodes] },
        recordStatusCode: "ACTIVE",
      },
    });
    if (account === null) this.notFound();
    const recipient = await this.database.appUser.findFirst({
      where: {
        id: input.recipientUserId,
        active: true,
        authStatusCode: "ACTIVE",
        countries: {
          some: {
            countryCode: account.countryCode,
            statusCode: "ACTIVE",
            validFrom: { lte: new Date() },
            OR: [{ validTo: null }, { validTo: { gt: new Date() } }],
          },
        },
      },
    });
    if (recipient === null) {
      throw new ApiProblem({
        status: 422,
        code: "SHARE_RECIPIENT_NOT_ELIGIBLE",
      });
    }
    const selectedCount = await this.database.contact.count({
      where: { id: { in: contactIds }, accountId },
    });
    if (selectedCount !== contactIds.length) {
      throw new ApiProblem({
        status: 422,
        code: "CONTACT_SHARE_ACCOUNT_MISMATCH",
      });
    }

    return this.transactions.run(identity, async (tx) => {
      const share = await tx.contactShare.create({
        data: {
          accountId,
          recipientUserId: input.recipientUserId,
          accessLevelCode: input.accessLevelCode,
          expiresAt,
          createdByUserId: identity.userId,
          items: { create: contactIds.map((contactId) => ({ contactId })) },
        },
        include: contactShareInclude,
      });
      await rememberIdempotency(
        tx,
        identity,
        "CONTACT_SHARE_CREATE",
        idempotencyKey,
        requestHash,
        share.id,
      );
      const projection = toShare(share);
      await this.appendShareAudit(
        tx,
        identity,
        "CONTACT_SHARE_CREATED",
        share,
        null,
        projection,
      );
      return projection;
    });
  }

  async revokeShare(
    identity: CustomerIdentity,
    shareId: string,
    expectedTag: string,
    idempotencyKey: string,
  ): Promise<{ rowVersion: string }> {
    this.access.requirePermission(identity, permissions.contactsShare);
    requireIdempotencyKey(idempotencyKey);
    const expectedVersion = parseRowVersion(expectedTag);
    const requestHash = hashJson({ shareId, expectedTag });
    const existing = await this.findIdempotency(
      identity,
      "CONTACT_SHARE_REVOKE",
      idempotencyKey,
      requestHash,
    );
    if (existing !== null) {
      const replay = await this.getShareForOwner(identity, existing);
      return { rowVersion: replay.rowVersion };
    }
    const before = await this.findShareForOwner(identity, shareId);
    if (before === null) this.notFound();

    const outcome = await this.transactions.run(identity, async (tx) => {
      const changed = await tx.contactShare.updateMany({
        where: {
          id: shareId,
          rowVersion: expectedVersion,
          statusCode: "ACTIVE",
        },
        data: {
          statusCode: "REVOKED",
          revokedAt: new Date(),
          revokedByUserId: identity.userId,
          rowVersion: { increment: 1 },
        },
      });
      if (changed.count !== 1) {
        const current = await tx.contactShare.findUnique({
          where: { id: shareId },
        });
        return { conflictVersion: current?.rowVersion } as const;
      }
      const updated = await tx.contactShare.findUniqueOrThrow({
        where: { id: shareId },
        include: contactShareInclude,
      });
      await rememberIdempotency(
        tx,
        identity,
        "CONTACT_SHARE_REVOKE",
        idempotencyKey,
        requestHash,
        shareId,
      );
      const projection = toShare(updated);
      await this.appendShareAudit(
        tx,
        identity,
        "CONTACT_SHARE_REVOKED",
        updated,
        toShare(before),
        projection,
      );
      return { rowVersion: projection.rowVersion } as const;
    });
    if ("conflictVersion" in outcome) {
      this.concurrency(
        "CONTACT_SHARE",
        shareId,
        expectedTag,
        outcome.conflictVersion,
      );
    }
    return outcome;
  }

  private async findEditableContact(
    identity: CustomerIdentity,
    contactId: string,
  ): Promise<ContactWithDetail | null> {
    return this.database.contact.findFirst({
      where: { id: contactId, ...editableContactWhere(identity) },
      include: contactInclude,
    });
  }

  private async findIdempotency(
    identity: CustomerIdentity,
    operationCode: string,
    idempotencyKey: string,
    requestHash: string,
  ): Promise<string | null> {
    const existing = await this.database.commandIdempotency.findUnique({
      where: {
        actorUserId_operationCode_idempotencyKey: {
          actorUserId: identity.userId,
          operationCode,
          idempotencyKey,
        },
      },
    });
    if (existing === null) return null;
    if (existing.requestHash !== requestHash) {
      throw new ApiProblem({ status: 409, code: "IDEMPOTENCY_KEY_REUSED" });
    }
    return existing.responseResourceId;
  }

  private async findShareForOwner(
    identity: CustomerIdentity,
    shareId: string,
  ): Promise<ContactShareWithItems | null> {
    return this.database.contactShare.findFirst({
      where: {
        id: shareId,
        account: {
          ownerUserId: identity.userId,
          countryCode: { in: [...identity.countryCodes] },
        },
      },
      include: contactShareInclude,
    });
  }

  private async getShareForOwner(
    identity: CustomerIdentity,
    shareId: string,
  ): Promise<ContactShare> {
    const share = await this.findShareForOwner(identity, shareId);
    if (share === null) this.notFound();
    return toShare(share);
  }

  private async appendContactAudit(
    tx: TransactionClient,
    identity: CustomerIdentity,
    actionCode: string,
    contact: ContactWithDetail,
    before: ContactDetail | null,
    after: ContactDetail,
  ): Promise<void> {
    await this.audit.append(tx, {
      actorUserId: identity.userId,
      actorSessionId: identity.sessionId,
      actionCode,
      resourceType: "CONTACT",
      resourceId: contact.id,
      workspace: "SALES",
      countryCode: contact.account.countryCode.trim(),
      beforeSnapshot: before,
      afterSnapshot: after,
      metadata: null,
      traceId: identity.traceId,
      correlationId: identity.correlationId,
      source: "API",
    });
  }

  private async appendShareAudit(
    tx: TransactionClient,
    identity: CustomerIdentity,
    actionCode: string,
    share: ContactShareWithItems,
    before: ContactShare | null,
    after: ContactShare,
  ): Promise<void> {
    await this.audit.append(tx, {
      actorUserId: identity.userId,
      actorSessionId: identity.sessionId,
      actionCode,
      resourceType: "CONTACT_SHARE",
      resourceId: share.id,
      workspace: "SALES",
      countryCode: share.account.countryCode.trim(),
      beforeSnapshot: before,
      afterSnapshot: after,
      metadata: null,
      traceId: identity.traceId,
      correlationId: identity.correlationId,
      source: "API",
    });
  }

  private concurrency(
    resourceType: string,
    resourceId: string,
    expected: string,
    current?: bigint,
  ): never {
    throw new ApiProblem({
      status: 412,
      code: "CONCURRENCY_CONFLICT",
      conflict: {
        currentRowVersion:
          current === undefined ? "rv-unknown" : formatRowVersion(current),
        expectedRowVersion: expected,
        resource: { resourceType, resourceId },
      },
    });
  }

  private notFound(): never {
    throw new ApiProblem({ status: 404, code: "RESOURCE_NOT_FOUND" });
  }
}

function contactViewContext(
  identity: CustomerIdentity,
): Prisma.ContactWhereInput[] {
  // `[{}]` inside an `OR` array matches nothing in Prisma, not everything —
  // this silently blocked SYSTEM_ADMIN from every account/contact this
  // bypass fed into. `{ id: { not: "00000000-0000-0000-0000-000000000000" } }` is the always-true fix.
  if (isSystemAdmin(identity))
    return [{ id: { not: "00000000-0000-0000-0000-000000000000" } }];
  const userId = identity.userId;
  const now = new Date();
  return [
    { account: { ownerUserId: userId } },
    ...(canUseManagerContext(identity)
      ? [{ account: { owner: { profile: { is: { managerUserId: userId } } } } }]
      : []),
    {
      account: {
        shares: {
          some: {
            recipientUserId: userId,
            statusCode: "ACTIVE",
            OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
          },
        },
      },
    },
    {
      shareItems: {
        some: {
          contactShare: {
            recipientUserId: userId,
            statusCode: "ACTIVE",
            OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
          },
        },
      },
    },
  ];
}

function accountEditContext(
  identity: CustomerIdentity,
): Prisma.AccountWhereInput[] {
  // `[{}]` inside an `OR` array matches nothing in Prisma, not everything —
  // this silently blocked SYSTEM_ADMIN from every account/contact this
  // bypass fed into. `{ id: { not: "00000000-0000-0000-0000-000000000000" } }` is the always-true fix.
  if (isSystemAdmin(identity))
    return [{ id: { not: "00000000-0000-0000-0000-000000000000" } }];
  const userId = identity.userId;
  const now = new Date();
  return [
    { ownerUserId: userId },
    {
      shares: {
        some: {
          recipientUserId: userId,
          statusCode: "ACTIVE",
          accessLevelCode: "COLLABORATE_EDIT",
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
      },
    },
  ];
}

function editableContactWhere(
  identity: CustomerIdentity,
): Prisma.ContactWhereInput {
  const now = new Date();
  return {
    account: { countryCode: { in: [...identity.countryCodes] } },
    OR: [
      { account: { OR: accountEditContext(identity) } },
      {
        shareItems: {
          some: {
            contactShare: {
              recipientUserId: identity.userId,
              statusCode: "ACTIVE",
              accessLevelCode: "COLLABORATE_EDIT",
              OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
            },
          },
        },
      },
    ],
  };
}

function toListItem(contact: {
  id: string;
  accountId: string;
  displayName: string;
  jobTitle: string | null;
  statusCode: string;
  rowVersion: bigint;
}): ContactListItem {
  return {
    contactId: contact.id,
    accountId: contact.accountId,
    displayName: contact.displayName,
    jobTitle: contact.jobTitle,
    statusCode: contact.statusCode,
    rowVersion: formatRowVersion(contact.rowVersion),
  };
}

/**
 * A contact is a name and a role, and optionally an email to send documents
 * to.
 */
function toDetail(contact: ContactWithDetail): ContactDetail {
  return {
    ...toListItem(contact),
    account: {
      accountId: contact.account.id,
      accountRef: contact.account.accountRef,
      canonicalName: contact.account.canonicalName,
    },
    channels: contact.channels
      .filter((channel) => channel.channelTypeCode === "EMAIL")
      .map((channel) => ({
        contactChannelId: channel.id,
        channelTypeCode: channel.channelTypeCode,
        value: channel.value,
        isPrimary: channel.isPrimary,
      })),
  };
}

function toShare(share: ContactShareWithItems): ContactShare {
  return {
    contactShareId: share.id,
    accountId: share.accountId,
    recipientUserId: share.recipientUserId,
    contactIds: share.items.map(({ contactId }) => contactId),
    accessLevelCode: share.accessLevelCode,
    expiresAt: share.expiresAt?.toISOString() ?? null,
    statusCode: share.statusCode,
    rowVersion: formatRowVersion(share.rowVersion),
  };
}

function contactOrderBy(
  sort: string,
): Prisma.ContactOrderByWithRelationInput[] {
  const [field, direction] = sort.split(":") as [string, "asc" | "desc"];
  return [{ [field]: direction }, { id: "asc" }];
}

function validatePrimaryChannels(
  channels: readonly ContactChannelInputDto[],
): void {
  const primaries = new Set<string>();
  for (const channel of channels) {
    if (!channel.isPrimary) continue;
    if (primaries.has(channel.channelTypeCode)) {
      throw new ApiProblem({ status: 422, code: "MULTIPLE_PRIMARY_CHANNELS" });
    }
    primaries.add(channel.channelTypeCode);
  }
}

function cleanOptional(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function normalizeChannel(input: ContactChannelInputDto): string {
  const value = input.value.normalize("NFKC").trim();
  if (input.channelTypeCode === "EMAIL") return value.toLocaleLowerCase("en");
  if (["PHONE", "MOBILE", "WHATSAPP"].includes(input.channelTypeCode)) {
    const leadingPlus = value.startsWith("+") ? "+" : "";
    return `${leadingPlus}${value.replace(/\D/g, "")}`;
  }
  return normalizeText(value);
}

function normalizeText(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("en");
}

function hashJson(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function formatRowVersion(value: bigint): string {
  return `"rv-${value.toString()}"`;
}

function parseRowVersion(value: string): bigint {
  const match = /^"rv-([1-9][0-9]*)"$/.exec(value);
  if (match?.[1] === undefined) {
    throw new ApiProblem({ status: 400, code: "INVALID_IF_MATCH" });
  }
  return BigInt(match[1]);
}

function requireIdempotencyKey(value: string): void {
  if (value.length < 8 || value.length > 200) {
    throw new ApiProblem({ status: 400, code: "INVALID_IDEMPOTENCY_KEY" });
  }
}

async function rememberIdempotency(
  tx: TransactionClient,
  identity: CustomerIdentity,
  operationCode: string,
  idempotencyKey: string,
  requestHash: string,
  responseResourceId: string,
): Promise<void> {
  await tx.commandIdempotency.create({
    data: {
      actorUserId: identity.userId,
      operationCode,
      idempotencyKey,
      requestHash,
      responseResourceId,
    },
  });
}
