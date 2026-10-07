import { Inject, Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import { permissions } from "@abp/contracts";
import {
  Prisma,
  type DatabaseClient,
  type TransactionClient,
  type TransactionManager,
} from "@abp/database";
import {
  canUseManagerContext,
  hasWorkspace,
  isSystemAdmin,
  type CustomerIdentity,
} from "../customer/customer-auth.js";
import { accountAccessWhere } from "../customer/account-scope.js";
import { ApiProblem } from "../platform/api-exception.filter.js";
import { AuditService } from "../platform/audit.service.js";
import {
  databaseClientToken,
  transactionManagerToken,
} from "../platform/database.providers.js";
import { stageDueAt } from "../support/complaint-flow.js";
import { notify } from "../support/notify.js";
import {
  canFollowUp,
  complaintSeverity,
  dialable,
  needsComplaint,
  normaliseReference,
  satisfaction,
} from "./feedback-rules.js";
import type {
  FeedbackFollowUpDto,
  FeedbackLinkDto,
  FeedbackListQuery,
  SubmitFeedbackDto,
} from "./feedback.dto.js";

type Match = {
  accountId: string | null;
  customerOrderId: string | null;
  quotationId: string | null;
  productId: string | null;
  salespersonUserId: string | null;
  countryCode: string | null;
};
const NO_MATCH: Match = {
  accountId: null,
  customerOrderId: null,
  quotationId: null,
  productId: null,
  salespersonUserId: null,
  countryCode: null,
};

/**
 * Customer feedback: given on a public page without an account, matched to
 * the customer by what they quote, followed up by their salesperson.
 *
 * The public side never says what a reference matched -- a stranger typing
 * order numbers must not learn whose they are. It answers with a reference
 * number to quote back, and that is all.
 */
@Injectable()
export class FeedbackService {
  constructor(
    @Inject(databaseClientToken) private readonly db: DatabaseClient,
    @Inject(transactionManagerToken) private readonly txs: TransactionManager,
    private readonly audit: AuditService,
  ) {}

  async submit(b: SubmitFeedbackDto, source: string) {
    if (b.website?.trim()) {
      // A bot filled the hidden field. Answer as if accepted, keep nothing.
      return {
        data: {
          feedbackRef: "FB-000000",
          receivedAt: new Date().toISOString(),
        },
      };
    }
    const phone = b.phone?.trim() || null;
    const email = b.email?.trim().toLowerCase() || null;
    if (phone === null && email === null) rule("FEEDBACK_CONTACT_REQUIRED");
    const match = await this.match(
      b.referenceTypeCode,
      b.referenceText,
      phone,
      email,
    );
    const critical = b.isCritical === true;
    const rating = b.rating ?? null;
    const raise = needsComplaint({ kindCode: b.kindCode, critical, rating });
    return this.db.$transaction(async (tx) => {
      const row = await tx.customerFeedback.create({
        data: {
          kindCode: b.kindCode,
          topicCode: b.topicCode ?? "OTHER",
          rating,
          isCritical: critical,
          referenceTypeCode: b.referenceTypeCode,
          referenceText: b.referenceText.trim(),
          ...match,
          contactName: b.contactName.trim(),
          companyName: blank(b.companyName),
          jobTitle: blank(b.jobTitle),
          phone,
          email,
          preferredChannelCode: b.preferredChannelCode ?? null,
          consentToContact: b.consentToContact !== false,
          message: b.message.trim(),
          sourceHash: hash(source).slice(0, 32),
        },
      });
      let complaintId: string | null = null;
      if (raise && match.accountId !== null)
        complaintId = await this.openComplaint(tx, row.id);
      await this.tell(tx, row.id, critical || raise);
      return {
        data: {
          feedbackRef: row.feedbackRef,
          receivedAt: row.createdAt.toISOString(),
          // Whether someone will call back; never what was matched.
          followUp: row.consentToContact,
          escalated: complaintId !== null,
        },
      };
    });
  }

  async list(i: CustomerIdentity, q: FeedbackListQuery) {
    this.require(i, permissions.feedbackView);
    const offset = (q.page - 1) * q.limit;
    const where: Prisma.CustomerFeedbackWhereInput = {
      AND: [
        this.scope(i),
        q.status ? { statusCode: q.status } : {},
        q.kind ? { kindCode: q.kind } : {},
        q.critical === "true" ? { isCritical: true } : {},
        q.mine === "true" ? { salespersonUserId: i.userId } : {},
        q.unmatched === "true" ? { accountId: null } : {},
        q.accountId ? { accountId: q.accountId } : {},
        q.search
          ? {
              OR: [
                { feedbackRef: { contains: q.search, mode: "insensitive" } },
                { contactName: { contains: q.search, mode: "insensitive" } },
                { companyName: { contains: q.search, mode: "insensitive" } },
                { referenceText: { contains: q.search, mode: "insensitive" } },
                { message: { contains: q.search, mode: "insensitive" } },
              ],
            }
          : {},
      ],
    };
    const [total, rows] = await this.db.$transaction([
      this.db.customerFeedback.count({ where }),
      this.db.customerFeedback.findMany({
        where,
        include: { account: { select: { canonicalName: true } } },
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        skip: offset,
        take: q.limit,
      }),
    ]);
    const names = await this.names(rows.map((row) => row.salespersonUserId));
    return {
      data: rows.map((row) => dto(row, names)),
      meta: {
        page: q.page,
        offset,
        limit: q.limit,
        total,
        hasNext: offset + rows.length < total,
      },
    };
  }

  /** Satisfaction and the state of the inbox, over the last 90 days. */
  async summary(i: CustomerIdentity) {
    this.require(i, permissions.feedbackView);
    const since = new Date(Date.now() - 90 * 86_400_000);
    const rows = await this.db.customerFeedback.findMany({
      where: { AND: [this.scope(i), { createdAt: { gte: since } }] },
      select: {
        rating: true,
        kindCode: true,
        statusCode: true,
        isCritical: true,
        accountId: true,
        createdAt: true,
      },
      take: 20_000,
    });
    const byKind = Object.fromEntries(
      ["SATISFACTION", "PROBLEM", "SUGGESTION", "QUESTION"].map((kind) => [
        kind,
        rows.filter((row) => row.kindCode === kind).length,
      ]),
    );
    const weeks = Array.from({ length: 13 }, (_, index) => {
      const end = Date.now() - (12 - index) * 7 * 86_400_000;
      const start = end - 7 * 86_400_000;
      const inWeek = rows.filter(
        (row) =>
          row.createdAt.getTime() > start && row.createdAt.getTime() <= end,
      );
      return {
        weekEnding: new Date(end).toISOString().slice(0, 10),
        responses: inWeek.length,
        average: satisfaction(inWeek.map((row) => row.rating)).average,
      };
    });
    return {
      data: {
        since: since.toISOString().slice(0, 10),
        total: rows.length,
        ...satisfaction(rows.map((row) => row.rating)),
        byKind,
        open: rows.filter((row) => row.statusCode !== "CLOSED").length,
        newCount: rows.filter((row) => row.statusCode === "NEW").length,
        criticalOpen: rows.filter(
          (row) => row.isCritical && row.statusCode !== "CLOSED",
        ).length,
        unmatched: rows.filter((row) => row.accountId === null).length,
        weeks,
      },
    };
  }

  async get(i: CustomerIdentity, id: string) {
    this.require(i, permissions.feedbackView);
    const row = await this.find(this.db, i, id);
    const names = await this.names([
      row.salespersonUserId,
      row.followedUpByUserId,
    ]);
    const [order, quotation, product, complaint] = await Promise.all([
      row.customerOrderId
        ? this.db.customerOrder.findUnique({
            where: { id: row.customerOrderId },
            select: { orderRef: true },
          })
        : null,
      row.quotationId
        ? this.db.quotation.findUnique({
            where: { id: row.quotationId },
            select: { quotationRef: true },
          })
        : null,
      row.productId
        ? this.db.product.findUnique({
            where: { id: row.productId },
            select: { canonicalDescription: true, skuCode: true },
          })
        : null,
      row.complaintId
        ? this.db.complaint.findUnique({
            where: { id: row.complaintId },
            select: { complaintRef: true, statusCode: true },
          })
        : null,
    ]);
    const manage = this.holds(i, permissions.feedbackManage);
    return {
      data: {
        ...dto(row, names),
        orderRef: order?.orderRef ?? null,
        quotationRef: quotation?.quotationRef ?? null,
        productName: product
          ? `${product.skuCode ?? ""} ${product.canonicalDescription}`.trim()
          : null,
        complaintRef: complaint?.complaintRef ?? null,
        complaintStatusCode: complaint?.statusCode ?? null,
        followedUpByName: row.followedUpByUserId
          ? (names.get(row.followedUpByUserId) ?? null)
          : null,
        allowedFollowUps: manage
          ? ["ACKNOWLEDGED", "CONTACTED", "CLOSED"].filter((to) =>
              canFollowUp(row.statusCode, to),
            )
          : [],
        canLink: manage && row.accountId === null,
        canOpenComplaint:
          manage && row.accountId !== null && row.complaintId === null,
      },
      etag: etag(row.rowVersion),
    };
  }

  async followUp(i: CustomerIdentity, id: string, b: FeedbackFollowUpDto) {
    this.require(i, permissions.feedbackManage);
    return this.txs
      .run(i, async (tx) => {
        const row = await this.find(tx, i, id);
        if (row.rowVersion !== BigInt(b.expectedRowVersion)) precondition();
        if (!canFollowUp(row.statusCode, b.targetStatusCode))
          rule("FEEDBACK_FOLLOW_UP_INVALID");
        if (
          b.targetStatusCode === "CLOSED" &&
          (blank(b.note) ?? row.followUpNote) === null
        )
          rule("FEEDBACK_CLOSE_NOTE_REQUIRED");
        const moved = await tx.customerFeedback.updateMany({
          where: { id, rowVersion: row.rowVersion },
          data: {
            statusCode: b.targetStatusCode,
            ...(blank(b.note) ? { followUpNote: blank(b.note) } : {}),
            followedUpByUserId: i.userId,
            followedUpAt: new Date(),
            rowVersion: { increment: 1 },
            updatedAt: new Date(),
          },
        });
        if (moved.count !== 1) precondition();
        await this.record(tx, i, "CUSTOMER_FEEDBACK_FOLLOWED_UP", id, {
          from: row.statusCode,
          to: b.targetStatusCode,
        });
      })
      .then(() => this.get(i, id));
  }

  /** Tie feedback that matched nothing to its customer, and escalate it if asked. */
  async link(i: CustomerIdentity, id: string, b: FeedbackLinkDto) {
    this.require(i, permissions.feedbackManage);
    await this.txs.run(i, async (tx) => {
      const row = await this.find(tx, i, id);
      if (row.rowVersion !== BigInt(b.expectedRowVersion)) precondition();
      const account = await tx.account.findFirst({
        where: {
          id: b.accountId,
          countryCode: { in: [...i.countryCodes] },
          OR: accountAccessWhere(i, "VIEW"),
        },
        select: { id: true, ownerUserId: true, countryCode: true },
      });
      if (!account) missing("ACCOUNT_NOT_FOUND");
      const moved = await tx.customerFeedback.updateMany({
        where: { id, rowVersion: row.rowVersion },
        data: {
          accountId: account.id,
          countryCode: account.countryCode,
          salespersonUserId: row.salespersonUserId ?? account.ownerUserId,
          rowVersion: { increment: 1 },
          updatedAt: new Date(),
        },
      });
      if (moved.count !== 1) precondition();
      if (b.openComplaint === true && row.complaintId === null)
        await this.openComplaint(tx, id);
      await this.record(tx, i, "CUSTOMER_FEEDBACK_LINKED", id, {
        accountId: account.id,
        openComplaint: b.openComplaint === true,
      });
    });
    return this.get(i, id);
  }

  // ── matching and routing ─────────────────────────────────────────────────

  private async match(
    type: string,
    text: string,
    phone: string | null,
    email: string | null,
  ): Promise<Match> {
    const ref = normaliseReference(text);
    const exact = { equals: ref, mode: "insensitive" as const };
    const tryOrder = async (): Promise<Match | null> => {
      const order = await this.db.customerOrder.findFirst({
        where: { OR: [{ orderRef: exact }, { customerPoNumber: exact }] },
        include: { account: { select: { ownerUserId: true } } },
      });
      if (order)
        return {
          accountId: order.accountId,
          customerOrderId: order.id,
          quotationId: order.quotationId,
          productId: null,
          salespersonUserId: order.ownerUserId,
          countryCode: order.countryCode,
        };
      const erp = await this.db.eRPOrder.findFirst({
        where: {
          OR: [{ orderNumberRaw: exact }, { sourceOrderKey: exact }],
          accountId: { not: null },
        },
        select: { accountId: true, countryCode: true },
      });
      if (erp?.accountId) return this.fromAccount(erp.accountId);
      return null;
    };
    const tryQuotation = async (): Promise<Match | null> => {
      const quotation = await this.db.quotation.findFirst({
        where: { quotationRef: exact },
        select: {
          id: true,
          accountId: true,
          ownerUserId: true,
          countryCode: true,
        },
      });
      if (!quotation) return null;
      const order = await this.db.customerOrder.findUnique({
        where: { quotationId: quotation.id },
        select: { id: true },
      });
      return {
        accountId: quotation.accountId,
        customerOrderId: order?.id ?? null,
        quotationId: quotation.id,
        productId: null,
        salespersonUserId: quotation.ownerUserId,
        countryCode: quotation.countryCode,
      };
    };
    const tryItem = async (): Promise<Match | null> => {
      const product = await this.db.product.findFirst({
        where: { OR: [{ skuCode: exact }, { barcode: exact }] },
        select: { id: true },
      });
      return product ? { ...NO_MATCH, productId: product.id } : null;
    };
    const byReference =
      type === "ORDER"
        ? await tryOrder()
        : type === "QUOTATION" || type === "PROFORMA"
          ? await tryQuotation()
          : type === "ITEM_CODE"
            ? await tryItem()
            : ((await tryOrder()) ??
              (await tryQuotation()) ??
              (await tryItem()));
    if (byReference?.accountId) return byReference;
    // The reference alone did not say who they are; a contact we know might.
    const viaContact = await this.byContact(phone, email);
    if (viaContact)
      return { ...viaContact, productId: byReference?.productId ?? null };
    return byReference ?? NO_MATCH;
  }

  private async byContact(
    phone: string | null,
    email: string | null,
  ): Promise<Match | null> {
    const values: string[] = [];
    if (email) values.push(email);
    const dial = dialable(phone);
    if (dial) values.push(dial, dial.replace(/^\+/, ""));
    if (values.length === 0) return null;
    const channel = await this.db.contactChannel.findFirst({
      where: { normalizedValue: { in: values } },
      select: { contact: { select: { accountId: true } } },
    });
    return channel ? this.fromAccount(channel.contact.accountId) : null;
  }

  private async fromAccount(accountId: string): Promise<Match> {
    const account = await this.db.account.findUnique({
      where: { id: accountId },
      select: { ownerUserId: true, countryCode: true },
    });
    return {
      ...NO_MATCH,
      accountId,
      salespersonUserId: account?.ownerUserId ?? null,
      countryCode: account?.countryCode ?? null,
    };
  }

  /** Open a complaint from feedback, on the complaint route's first stage. */
  private async openComplaint(tx: TransactionClient, feedbackId: string) {
    const row = await tx.customerFeedback.findUniqueOrThrow({
      where: { id: feedbackId },
    });
    if (row.accountId === null) return null;
    const account = await tx.account.findUniqueOrThrow({
      where: { id: row.accountId },
      select: { ownerUserId: true, countryCode: true },
    });
    const owner = row.salespersonUserId ?? account.ownerUserId;
    const severity = complaintSeverity({
      critical: row.isCritical,
      rating: row.rating,
    });
    const now = new Date();
    const contact = [row.contactName, row.companyName, row.phone, row.email]
      .filter(Boolean)
      .join(" · ");
    const complaint = await tx.complaint.create({
      data: {
        accountId: row.accountId,
        countryCode: account.countryCode,
        customerOrderId: row.customerOrderId,
        productId: row.productId,
        complaintTypeCode: row.topicCode,
        channelCode: "MESSAGE",
        severityCode: severity,
        ownerUserId: owner,
        assigneeUserId: owner,
        description: `${row.message}\n\n— ${row.feedbackRef} (${row.referenceText}) · ${contact}`,
        stageEnteredAt: now,
        stageDueAt: stageDueAt({
          stage: "OPEN",
          enteredAt: now,
          severityCode: severity,
        }),
      },
    });
    await tx.complaintEvent.create({
      data: {
        complaintId: complaint.id,
        eventCode: "LOGGED",
        toStatusCode: "OPEN",
        note: `From customer feedback ${row.feedbackRef}`,
        actorUserId: owner,
      },
    });
    await tx.customerFeedback.update({
      where: { id: feedbackId },
      data: { complaintId: complaint.id, rowVersion: { increment: 1 } },
    });
    return complaint.id;
  }

  /** The salesperson hears about it; with nobody to tell, the sales managers do. */
  private async tell(
    tx: TransactionClient,
    feedbackId: string,
    urgent: boolean,
  ) {
    const row = await tx.customerFeedback.findUniqueOrThrow({
      where: { id: feedbackId },
    });
    const recipients = row.salespersonUserId
      ? [row.salespersonUserId]
      : (
          await tx.appUser.findMany({
            where: {
              active: true,
              roles: { some: { role: { code: "SALES_MANAGER" } } },
            },
            select: { id: true },
          })
        ).map((user) => user.id);
    const stars = row.rating === null ? "" : ` · ${"★".repeat(row.rating)}`;
    for (const recipientUserId of recipients)
      await notify(tx, {
        recipientUserId,
        typeCode: urgent ? "CRITICAL_FEEDBACK" : "CUSTOMER_FEEDBACK",
        titleSafe: urgent
          ? `Critical feedback from ${row.companyName ?? row.contactName}`
          : `Feedback from ${row.companyName ?? row.contactName}${stars}`,
        bodySafe: row.message.slice(0, 180),
        resourceTypeCode: "CUSTOMER_FEEDBACK",
        resourceId: row.id,
      });
  }

  // ── helpers ──────────────────────────────────────────────────────────────

  /**
   * Who sees which feedback: a salesperson their own customers' and what is
   * routed to them; a manager or admin everything in their countries,
   * including what matched no one and still needs a home.
   */
  private scope(i: CustomerIdentity): Prisma.CustomerFeedbackWhereInput {
    const countries = {
      OR: [{ countryCode: null }, { countryCode: { in: [...i.countryCodes] } }],
    };
    if (isSystemAdmin(i) || canUseManagerContext(i)) return countries;
    return {
      AND: [
        countries,
        {
          OR: [
            { salespersonUserId: i.userId },
            { account: { OR: accountAccessWhere(i, "VIEW") } },
          ],
        },
      ],
    };
  }

  private async find(
    db: DatabaseClient | TransactionClient,
    i: CustomerIdentity,
    id: string,
  ) {
    const row = await db.customerFeedback.findFirst({
      where: { AND: [{ id }, this.scope(i)] },
      include: { account: { select: { canonicalName: true } } },
    });
    if (!row) missing("FEEDBACK_NOT_FOUND");
    return row;
  }

  private async names(ids: (string | null)[]) {
    const wanted = [
      ...new Set(ids.filter((id): id is string => typeof id === "string")),
    ];
    if (wanted.length === 0) return new Map<string, string>();
    const users = await this.db.appUser.findMany({
      where: { id: { in: wanted } },
      select: { id: true, displayName: true },
    });
    return new Map(users.map((user) => [user.id, user.displayName]));
  }

  private holds(i: CustomerIdentity, p: string) {
    return i.permissions.has(p) && !i.deniedPermissions.has(p);
  }

  private require(i: CustomerIdentity, p: string) {
    if (
      !hasWorkspace(i, "SALES") &&
      !hasWorkspace(i, "LOGISTICS") &&
      !hasWorkspace(i, "RND")
    )
      throw new ApiProblem({ status: 403, code: "FORBIDDEN" });
    if (!this.holds(i, p))
      throw new ApiProblem({ status: 403, code: "FORBIDDEN" });
  }

  private record(
    tx: TransactionClient,
    i: CustomerIdentity,
    actionCode: string,
    id: string,
    metadata: Record<string, unknown>,
  ) {
    return this.audit.record(tx, {
      actorUserId: i.userId,
      actorSessionId: i.sessionId,
      actionCode,
      resourceType: "CustomerFeedback",
      resourceId: id,
      workspace: "SALES",
      countryCode: null,
      metadata,
      traceId: i.traceId,
      correlationId: i.correlationId,
      source: "feedback-api",
    });
  }
}

type FeedbackRow = Prisma.CustomerFeedbackGetPayload<{
  include: { account: { select: { canonicalName: true } } };
}>;

function dto(row: FeedbackRow, names: Map<string, string>) {
  const dial = dialable(row.phone);
  return {
    feedbackId: row.id,
    feedbackRef: row.feedbackRef,
    kindCode: row.kindCode,
    topicCode: row.topicCode,
    rating: row.rating,
    isCritical: row.isCritical,
    referenceTypeCode: row.referenceTypeCode,
    referenceText: row.referenceText,
    accountId: row.accountId,
    accountName: row.account?.canonicalName ?? null,
    customerOrderId: row.customerOrderId,
    quotationId: row.quotationId,
    productId: row.productId,
    salespersonUserId: row.salespersonUserId,
    salespersonName: row.salespersonUserId
      ? (names.get(row.salespersonUserId) ?? null)
      : null,
    contactName: row.contactName,
    companyName: row.companyName,
    jobTitle: row.jobTitle,
    phone: row.phone,
    phoneDial: dial,
    whatsappLink: dial ? `https://wa.me/${dial.replace(/^\+/, "")}` : null,
    email: row.email,
    preferredChannelCode: row.preferredChannelCode,
    consentToContact: row.consentToContact,
    message: row.message,
    statusCode: row.statusCode,
    complaintId: row.complaintId,
    followUpNote: row.followUpNote,
    followedUpAt: row.followedUpAt?.toISOString() ?? null,
    rowVersion: row.rowVersion.toString(),
    createdAt: row.createdAt.toISOString(),
  };
}

function blank(value: string | null | undefined): string | null {
  const text = value?.trim() ?? "";
  return text === "" ? null : text;
}
function hash(v: unknown) {
  return createHash("sha256").update(JSON.stringify(v)).digest("hex");
}
function etag(v: bigint) {
  return `"${v.toString()}"`;
}
function missing(code: string): never {
  throw new ApiProblem({ status: 404, code });
}
function precondition(): never {
  throw new ApiProblem({ status: 412, code: "ROW_VERSION_MISMATCH" });
}
function rule(code: string): never {
  throw new ApiProblem({ status: 422, code });
}
