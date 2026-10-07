import { createHash } from "node:crypto";
import { accountAccessWhere } from "../customer/account-scope.js";
import { Inject, Injectable } from "@nestjs/common";
import { permissions } from "@abp/contracts";
import { Prisma, type DatabaseClient } from "@abp/database";
import type { CustomerIdentity } from "../customer/customer-auth.js";
import { ApiProblem } from "../platform/api-exception.filter.js";
import { databaseClientToken } from "../platform/database.providers.js";
import type {
  ArchiveSegmentDto,
  AsOfQuery,
  AssignSegmentDto,
  ClientBindingDto,
  CommercialStateDto,
  CrPageQuery,
  CreateSegmentDto,
  DeliveryCalendarQuery,
  CreateShipmentDto,
  DeliverShipmentDto,
  DispatchShipmentDto,
  PortalComplaintDto,
  ProvisionClientIdentityDto,
  ShipmentCorrectionDto,
  ShipmentMilestoneDto,
  ShipmentPodDto,
} from "./cr001.dto.js";
import { dateFromHandover } from "../orders/receivable-sync.js";
import {
  allDelivered,
  isNextStep,
  nextAction,
  normaliseUnits,
} from "./shipment-flow.js";

export type ExternalPortalIdentity = {
  externalClientIdentityId: string;
  issuer: string;
  subject: string;
  accountIds: readonly string[];
  traceId: string;
  correlationId: string;
};

@Injectable()
export class Cr001Service {
  constructor(
    @Inject(databaseClientToken) private readonly db: DatabaseClient,
  ) {}

  async segments(identity: CustomerIdentity, query: CrPageQuery) {
    this.require(identity, permissions.customerSegmentsView);
    const where = {
      ...(query.status ? { statusCode: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              {
                code: { contains: query.search, mode: "insensitive" as const },
              },
              {
                displayNameEn: {
                  contains: query.search,
                  mode: "insensitive" as const,
                },
              },
              {
                displayNameAr: {
                  contains: query.search,
                  mode: "insensitive" as const,
                },
              },
            ],
          }
        : {}),
    };
    const [total, rows] = await this.db.$transaction([
      this.db.customerSegmentDefinition.count({ where }),
      this.db.customerSegmentDefinition.findMany({
        where,
        skip: query.offset,
        take: query.limit,
        orderBy: [{ statusCode: "asc" }, { code: "asc" }],
      }),
    ]);
    return page(rows.map(segment), query, total);
  }

  async createSegment(identity: CustomerIdentity, body: CreateSegmentDto) {
    this.require(identity, permissions.customerSegmentsManage);
    const row = await this.db.customerSegmentDefinition.create({
      data: {
        code: body.code.trim().toUpperCase(),
        displayNameEn: body.displayNameEn.trim(),
        displayNameAr: body.displayNameAr.trim(),
        createdByUserId: identity.userId,
      },
    });
    await this.audit(
      identity,
      "CUSTOMER_SEGMENT_CREATED",
      "CUSTOMER_SEGMENT",
      row.id,
      segment(row),
    );
    return { data: segment(row), etag: tag(row.rowVersion) };
  }

  async archiveSegment(
    identity: CustomerIdentity,
    id: string,
    body: ArchiveSegmentDto,
  ) {
    this.require(identity, permissions.customerSegmentsManage);
    const expected = BigInt(body.expectedRowVersion);
    const changed = await this.db.customerSegmentDefinition.updateMany({
      where: { id, rowVersion: expected, statusCode: "ACTIVE" },
      data: {
        statusCode: "ARCHIVED",
        archivedAt: new Date(),
        archivedByUserId: identity.userId,
        rowVersion: { increment: 1 },
      },
    });
    if (changed.count !== 1) precondition();
    const row = await this.db.customerSegmentDefinition.findUniqueOrThrow({
      where: { id },
    });
    await this.audit(
      identity,
      "CUSTOMER_SEGMENT_ARCHIVED",
      "CUSTOMER_SEGMENT",
      id,
      segment(row),
    );
    return { data: segment(row), etag: tag(row.rowVersion) };
  }

  async accountSegments(identity: CustomerIdentity, accountId: string) {
    this.require(identity, permissions.customerSegmentsView);
    await this.account(identity, accountId);
    const rows = await this.db.customerSegmentAssignment.findMany({
      where: { accountId },
      orderBy: [{ effectiveFrom: "desc" }, { id: "desc" }],
    });
    const definitions = await this.db.customerSegmentDefinition.findMany({
      where: { id: { in: rows.map((row) => row.segmentId) } },
    });
    const byId = new Map(definitions.map((row) => [row.id, row]));
    return {
      data: rows.map((row) => assignment(row, byId.get(row.segmentId))),
    };
  }

  async assignSegment(
    identity: CustomerIdentity,
    accountId: string,
    body: AssignSegmentDto,
  ) {
    this.require(identity, permissions.customerSegmentsAssign);
    const account = await this.account(identity, accountId);
    const definition = await this.db.customerSegmentDefinition.findFirst({
      where: { id: body.segmentId, statusCode: "ACTIVE" },
    });
    if (!definition) missing("CUSTOMER_SEGMENT_NOT_ACTIVE");
    const effectiveFrom = new Date(body.effectiveFrom);
    const row = await this.db.$transaction(async (tx) => {
      await tx.customerSegmentAssignment.updateMany({
        where: {
          accountId,
          effectiveTo: null,
          effectiveFrom: { lt: effectiveFrom },
        },
        data: { effectiveTo: effectiveFrom },
      });
      const current = await tx.customerSegmentAssignment.findFirst({
        where: { accountId, effectiveTo: null },
      });
      if (current) conflict("CUSTOMER_SEGMENT_EFFECTIVE_OVERLAP");
      return tx.customerSegmentAssignment.create({
        data: {
          accountId,
          segmentId: definition.id,
          effectiveFrom,
          sourceCode: body.sourceCode ?? "MANUAL",
          sourceReference: body.sourceReference ?? null,
          createdByUserId: identity.userId,
        },
      });
    });
    await this.audit(
      identity,
      "CUSTOMER_SEGMENT_ASSIGNED",
      "ACCOUNT",
      accountId,
      {
        ...assignment(row, definition),
        countryCode: account.countryCode.trim(),
      },
    );
    return { data: assignment(row, definition) };
  }

  async transitionCommercial(
    identity: CustomerIdentity,
    quotationId: string,
    body: CommercialStateDto,
  ) {
    this.require(identity, permissions.quotationsEdit);
    const quote = await this.db.quotation.findFirst({
      where: {
        id: quotationId,
        countryCode: { in: [...identity.countryCodes] },
        statusCode: "SENT",
      },
    });
    if (!quote) missing("QUOTATION_NOT_FOUND");
    if (quote.rowVersion !== BigInt(body.expectedRowVersion)) precondition();
    if (
      !new Set(["SUBMITTED", "UNDER_NEGOTIATION"]).has(
        quote.commercialStateCode,
      )
    )
      rule("QUOTATION_NOT_SUBMITTED");
    if (quote.commercialStateCode === body.targetStateCode)
      return { data: quotationState(quote), etag: tag(quote.rowVersion) };
    const updated = await this.db.$transaction(async (tx) => {
      const changed = await tx.quotation.updateMany({
        where: {
          id: quotationId,
          rowVersion: quote.rowVersion,
          statusCode: "SENT",
        },
        data: {
          commercialStateCode: body.targetStateCode,
          rowVersion: { increment: 1 },
        },
      });
      if (changed.count !== 1) precondition();
      const row = await tx.quotation.findUniqueOrThrow({
        where: { id: quotationId },
      });
      await tx.quotationCommercialStateEvent.create({
        data: {
          quotationId,
          fromStateCode: quote.commercialStateCode,
          toStateCode: body.targetStateCode,
          actorUserId: identity.userId,
          quotationRowVersion: row.rowVersion,
          reason: body.reason ?? null,
        },
      });
      return row;
    });
    await this.audit(
      identity,
      "QUOTATION_COMMERCIAL_STATE_CHANGED",
      "QUOTATION",
      quotationId,
      quotationState(updated),
    );
    return { data: quotationState(updated), etag: tag(updated.rowVersion) };
  }

  async shipments(identity: CustomerIdentity, query: CrPageQuery) {
    this.require(identity, permissions.shipmentsView);
    const accountOrders = query.accountId
      ? await Promise.all([
          this.db.eRPOrder.findMany({
            where: {
              accountId: query.accountId,
              countryCode: { in: [...identity.countryCodes] },
            },
            select: { id: true },
          }),
          this.db.customerOrder.findMany({
            where: {
              accountId: query.accountId,
              countryCode: { in: [...identity.countryCodes] },
            },
            select: { id: true },
          }),
        ])
      : undefined;
    const where: Prisma.ShipmentWhereInput = {
      ...(accountOrders
        ? {
            OR: [
              { erpOrderId: { in: accountOrders[0].map((order) => order.id) } },
              {
                customerOrderId: {
                  in: accountOrders[1].map((order) => order.id),
                },
              },
            ],
          }
        : {}),
      ...(query.customerOrderId
        ? { customerOrderId: query.customerOrderId }
        : {}),
      countryCode: { in: [...identity.countryCodes] },
      ...(query.status ? { milestoneCode: query.status } : {}),
      ...(query.search
        ? {
            shipmentRef: {
              contains: query.search,
              mode: "insensitive" as const,
            },
          }
        : {}),
    };
    const [total, rows] = await this.db.$transaction([
      this.db.shipment.count({ where }),
      this.db.shipment.findMany({
        where,
        skip: query.offset,
        take: query.limit,
        orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      }),
    ]);
    const context = await this.shipmentContext(rows);
    return page(
      rows.map((row) => ({ ...shipment(row), ...context(row) })),
      query,
      total,
    );
  }

  async shipment(identity: CustomerIdentity, id: string) {
    this.require(identity, permissions.shipmentsView);
    const row = await this.db.shipment.findFirst({
      where: { id, countryCode: { in: [...identity.countryCodes] } },
    });
    if (!row) missing("SHIPMENT_NOT_FOUND");
    const history = await this.db.shipmentMilestoneEvent.findMany({
      where: { shipmentId: id },
      orderBy: [{ recordedAt: "asc" }, { id: "asc" }],
    });
    const context = await this.shipmentContext([row]);
    const canWork =
      identity.permissions.has(permissions.shipmentsEdit) &&
      !identity.deniedPermissions.has(permissions.shipmentsEdit);
    return {
      data: {
        ...shipment(row),
        ...context(row),
        nextAction: canWork
          ? nextAction(row.transportModeCode, row.milestoneCode)
          : null,
        history: history.map(event),
      },
      etag: tag(row.rowVersion),
    };
  }

  async createShipment(
    identity: CustomerIdentity,
    key: string,
    body: CreateShipmentDto,
  ) {
    this.require(identity, permissions.shipmentsCreate);
    requireKey(key);
    if (!body.erpOrderId === !body.customerOrderId)
      rule("SHIPMENT_ORDER_REQUIRED");
    let countryCode: string;
    if (body.erpOrderId) {
      const order = await this.db.eRPOrder.findFirst({
        where: {
          id: body.erpOrderId,
          countryCode: { in: [...identity.countryCodes] },
        },
      });
      if (!order?.countryCode) missing("ERP_ORDER_NOT_FOUND");
      countryCode = order.countryCode;
    } else {
      const order = await this.db.customerOrder.findFirst({
        where: {
          id: body.customerOrderId ?? "",
          countryCode: { in: [...identity.countryCodes] },
          account: { OR: accountAccessWhere(identity, "VIEW") },
        },
      });
      if (!order) missing("CUSTOMER_ORDER_NOT_FOUND");
      // Nothing ships before the customer has confirmed, or after the order
      // is finished with.
      if (!["CONFIRMED", "IN_PRODUCTION", "READY"].includes(order.statusCode))
        rule("ORDER_NOT_SHIPPABLE");
      countryCode = order.countryCode;
    }
    const requestHash = hash(body);
    const replay = await this.replay(
      identity,
      "SHIPMENT_CREATE",
      key,
      requestHash,
    );
    if (replay) return this.shipment(identity, replay);
    const occurred = new Date(body.businessOccurredAt);
    const units = normaliseUnits(body.loadPlan?.units ?? []);
    const row = await this.db.$transaction(async (tx) => {
      const created = await tx.shipment.create({
        data: {
          erpOrderId: body.erpOrderId ?? null,
          customerOrderId: body.customerOrderId ?? null,
          transportModeCode:
            body.transportModeCode ??
            (body.customerOrderId ? "LOCAL_TRUCK" : "SEA_CONTAINER"),
          plannedDispatchDate: body.plannedDispatchDate
            ? new Date(body.plannedDispatchDate.slice(0, 10))
            : null,
          expectedDeliveryDate: body.expectedDeliveryDate
            ? new Date(body.expectedDeliveryDate.slice(0, 10))
            : null,
          ...(body.loadPlan
            ? {
                loadPlan: {
                  units: units.map((unit) => ({ ...unit })),
                  totalWeightKg: body.loadPlan.totalWeightKg ?? null,
                  note: body.loadPlan.note?.trim() || null,
                },
              }
            : {}),
          countryCode,
          createdByUserId: identity.userId,
          updatedByUserId: identity.userId,
        },
      });
      await tx.shipmentMilestoneEvent.create({
        data: {
          shipmentId: created.id,
          fromMilestoneCode: null,
          toMilestoneCode: "READY_FOR_DELIVERY",
          businessOccurredAt: occurred,
          actorUserId: identity.userId,
          newSnapshot: shipmentSnapshot(created),
        },
      });
      await remember(
        tx,
        identity,
        "SHIPMENT_CREATE",
        key,
        requestHash,
        created.id,
      );
      return created;
    });
    await this.audit(
      identity,
      "SHIPMENT_CREATED",
      "SHIPMENT",
      row.id,
      shipment(row),
    );
    return this.shipment(identity, row.id);
  }

  /**
   * What is leaving and arriving, day by day: planned dispatches, expected
   * deliveries, what actually went and arrived, and the dates customers asked
   * for. A date that has passed without the thing happening is late.
   */
  async deliveryCalendar(
    identity: CustomerIdentity,
    query: DeliveryCalendarQuery,
  ) {
    this.require(identity, permissions.shipmentsView);
    const from = new Date(`${query.from}T00:00:00Z`);
    const to = new Date(`${query.to}T23:59:59Z`);
    if (!(from <= to) || to.getTime() - from.getTime() > 100 * 86_400_000)
      rule("CALENDAR_RANGE_INVALID");
    const inRange = { gte: from, lte: to };
    const countries = { in: [...identity.countryCodes] };
    const [shipments, orders] = await Promise.all([
      this.db.shipment.findMany({
        where: {
          countryCode: countries,
          OR: [
            { plannedDispatchDate: inRange },
            { expectedDeliveryDate: inRange },
            { dispatchedAt: inRange },
            { deliveredAt: inRange },
          ],
        },
        take: 2000,
      }),
      this.db.customerOrder.findMany({
        where: {
          countryCode: countries,
          account: { OR: accountAccessWhere(identity, "VIEW") },
          requestedDeliveryDate: inRange,
          statusCode: { notIn: ["DRAFT", "CANCELLED"] },
        },
        include: { account: { select: { canonicalName: true } } },
        take: 2000,
      }),
    ]);
    const context = await this.shipmentContext(shipments);
    const today = new Date().toISOString().slice(0, 10);
    const day = (value: Date | null) =>
      value === null ? null : value.toISOString().slice(0, 10);
    const within = (date: string | null): date is string =>
      date !== null && date >= query.from && date <= query.to;
    const delivered = (code: string) =>
      code === "DELIVERED" || code === "POD_RECEIVED";
    const events: Record<string, unknown>[] = [];
    for (const row of shipments) {
      const base = {
        shipmentId: row.id,
        shipmentRef: row.shipmentRef,
        milestoneCode: row.milestoneCode,
        transportModeCode: row.transportModeCode,
        customerOrderId: row.customerOrderId,
        ...context(row),
      };
      const planned = day(row.plannedDispatchDate);
      if (within(planned) && row.dispatchedAt === null)
        events.push({
          ...base,
          date: planned,
          kindCode: "PLANNED_DISPATCH",
          late: planned < today,
        });
      const dispatched = day(row.dispatchedAt);
      if (within(dispatched))
        events.push({
          ...base,
          date: dispatched,
          kindCode: "DISPATCHED",
          late: false,
        });
      const expected = day(row.expectedDeliveryDate);
      if (within(expected) && !delivered(row.milestoneCode))
        events.push({
          ...base,
          date: expected,
          kindCode: "EXPECTED_DELIVERY",
          late: expected < today,
        });
      const arrived = day(row.deliveredAt);
      if (within(arrived))
        events.push({
          ...base,
          date: arrived,
          kindCode: "DELIVERED",
          late: false,
          deliveryConditionCode: row.deliveryConditionCode,
        });
    }
    for (const order of orders) {
      const requested = day(order.requestedDeliveryDate);
      if (!within(requested)) continue;
      const done = ["HANDED_OVER", "CLOSED"].includes(order.statusCode);
      events.push({
        date: requested,
        kindCode: "REQUESTED_BY_CUSTOMER",
        customerOrderId: order.id,
        orderRef: order.orderRef,
        orderStatusCode: order.statusCode,
        accountId: order.accountId,
        accountName: order.account.canonicalName,
        late: !done && requested < today,
      });
    }
    events.sort((a, b) => String(a.date).localeCompare(String(b.date)));
    return { data: { from: query.from, to: query.to, today, events } };
  }

  async advanceShipment(
    identity: CustomerIdentity,
    id: string,
    key: string,
    body: ShipmentMilestoneDto,
  ) {
    this.require(identity, permissions.shipmentsEdit);
    requireKey(key);
    const before = await this.scopedShipment(identity, id);
    if (before.rowVersion !== BigInt(body.expectedRowVersion)) precondition();
    // The next step on this shipment's own route: a truck has no vessel.
    if (
      !isNextStep(
        before.transportModeCode,
        before.milestoneCode,
        body.milestoneCode,
      )
    )
      rule("SHIPMENT_TRANSITION_INVALID");
    if (body.milestoneCode === "VESSEL_DEPARTED" && !body.blDate)
      rule("BL_DATE_REQUIRED");
    if (
      body.milestoneCode === "ARRIVED_AT_PORT_OF_DISCHARGE" &&
      (!body.portOfDischarge?.trim() || !body.actualArrivalAt)
    )
      rule("PORT_AND_ARRIVAL_REQUIRED");
    const requestHash = hash({ id, body });
    const replay = await this.replay(
      identity,
      "SHIPMENT_MILESTONE",
      key,
      requestHash,
    );
    if (replay) return this.shipment(identity, replay);
    const updated = await this.db.$transaction(async (tx) => {
      const changed = await tx.shipment.updateMany({
        where: { id, rowVersion: before.rowVersion },
        data: {
          milestoneCode: body.milestoneCode,
          ...(body.blDate ? { blDate: new Date(body.blDate) } : {}),
          ...(body.portOfDischarge
            ? { portOfDischarge: body.portOfDischarge.trim() }
            : {}),
          ...(body.actualArrivalAt
            ? { actualArrivalAt: new Date(body.actualArrivalAt) }
            : {}),
          updatedByUserId: identity.userId,
          rowVersion: { increment: 1 },
        },
      });
      if (changed.count !== 1) precondition();
      const row = await tx.shipment.findUniqueOrThrow({ where: { id } });
      await tx.shipmentMilestoneEvent.create({
        data: {
          shipmentId: id,
          fromMilestoneCode: before.milestoneCode,
          toMilestoneCode: row.milestoneCode,
          businessOccurredAt: new Date(body.businessOccurredAt),
          actorUserId: identity.userId,
          previousSnapshot: shipmentSnapshot(before),
          newSnapshot: shipmentSnapshot(row),
        },
      });
      await remember(tx, identity, "SHIPMENT_MILESTONE", key, requestHash, id);
      return row;
    });
    await this.audit(
      identity,
      "SHIPMENT_MILESTONE_RECORDED",
      "SHIPMENT",
      id,
      shipment(updated),
    );
    return { data: shipment(updated), etag: tag(updated.rowVersion) };
  }

  async correctShipment(
    identity: CustomerIdentity,
    id: string,
    key: string,
    body: ShipmentCorrectionDto,
  ) {
    this.require(identity, permissions.shipmentsEdit);
    requireKey(key);
    const before = await this.scopedShipment(identity, id);
    if (before.rowVersion !== BigInt(body.expectedRowVersion)) precondition();
    const requestHash = hash({ id, body });
    const replay = await this.replay(
      identity,
      "SHIPMENT_CORRECTION",
      key,
      requestHash,
    );
    if (replay) return this.shipment(identity, replay);
    const updated = await this.db.$transaction(async (tx) => {
      const changed = await tx.shipment.updateMany({
        where: { id, rowVersion: before.rowVersion },
        data: {
          blDate:
            body.blDate === undefined
              ? before.blDate
              : body.blDate
                ? new Date(body.blDate)
                : null,
          portOfDischarge:
            body.portOfDischarge === undefined
              ? before.portOfDischarge
              : body.portOfDischarge?.trim() || null,
          actualArrivalAt:
            body.actualArrivalAt === undefined
              ? before.actualArrivalAt
              : body.actualArrivalAt
                ? new Date(body.actualArrivalAt)
                : null,
          updatedByUserId: identity.userId,
          rowVersion: { increment: 1 },
        },
      });
      if (changed.count !== 1) precondition();
      const row = await tx.shipment.findUniqueOrThrow({ where: { id } });
      await tx.shipmentMilestoneEvent.create({
        data: {
          shipmentId: id,
          eventTypeCode: "CORRECTION",
          fromMilestoneCode: before.milestoneCode,
          toMilestoneCode: before.milestoneCode,
          businessOccurredAt: new Date(body.businessOccurredAt),
          actorUserId: identity.userId,
          previousSnapshot: shipmentSnapshot(before),
          newSnapshot: shipmentSnapshot(row),
          reason: body.reason.trim(),
        },
      });
      await remember(tx, identity, "SHIPMENT_CORRECTION", key, requestHash, id);
      return row;
    });
    await this.audit(identity, "SHIPMENT_CORRECTED", "SHIPMENT", id, {
      reason: body.reason,
      current: shipment(updated),
    });
    return { data: shipment(updated), etag: tag(updated.rowVersion) };
  }

  /**
   * Who has portal access, and to which customers.
   *
   * There were three endpoints to create, bind and revoke a client identity
   * and none to read one back, so the screen could grant access but never show
   * what access existed. An administrator cannot revoke a binding they cannot
   * see.
   */
  async listClientIdentities(identity: CustomerIdentity, query: CrPageQuery) {
    this.require(identity, permissions.usersManage);
    const [total, rows] = await this.db.$transaction([
      this.db.externalClientIdentity.count(),
      this.db.externalClientIdentity.findMany({
        skip: query.offset,
        take: query.limit,
        orderBy: [{ provisionedAt: "desc" }, { id: "asc" }],
        select: {
          id: true,
          issuer: true,
          subject: true,
          displayName: true,
          emailNormalized: true,
          statusCode: true,
          provisionedAt: true,
          rowVersion: true,
        },
      }),
    ]);
    // The two tables carry no Prisma relation, so the bindings and the
    // customer names they point at are fetched and joined here -- the same
    // shape this file already uses for orders and their lines.
    const bindings = await this.db.clientCustomerBinding.findMany({
      where: { externalClientIdentityId: { in: rows.map((row) => row.id) } },
      orderBy: { validFrom: "desc" },
      select: {
        id: true,
        externalClientIdentityId: true,
        accountId: true,
        statusCode: true,
        validFrom: true,
        validTo: true,
        rowVersion: true,
      },
    });
    const accounts = await this.db.account.findMany({
      where: { id: { in: bindings.map((item) => item.accountId) } },
      select: { id: true, canonicalName: true },
    });
    const nameOf = new Map(accounts.map((row) => [row.id, row.canonicalName]));
    return page(
      rows.map((row) => {
        const own = bindings.filter(
          (item) => item.externalClientIdentityId === row.id,
        );
        return {
          ...clientIdentity(row),
          provisionedAt: row.provisionedAt.toISOString(),
          // The count is what the list column shows; the bindings themselves
          // are what the detail panel needs in order to revoke one.
          activeBindingCount: own.filter((item) => item.statusCode === "ACTIVE")
            .length,
          bindings: own.map((item) => ({
            ...binding(item),
            accountName: nameOf.get(item.accountId) ?? null,
          })),
        };
      }),
      query,
      total,
    );
  }

  async provision(
    identity: CustomerIdentity,
    body: ProvisionClientIdentityDto,
  ) {
    this.require(identity, permissions.usersManage);
    const row = await this.db.externalClientIdentity.create({
      data: {
        issuer: body.issuer.trim(),
        subject: body.subject.trim(),
        displayName: body.displayName?.trim() ?? null,
        emailNormalized: body.email?.trim().toLowerCase() ?? null,
        provisionedByUserId: identity.userId,
      },
    });
    await this.audit(
      identity,
      "CLIENT_IDENTITY_PROVISIONED",
      "EXTERNAL_CLIENT_IDENTITY",
      row.id,
      { issuer: row.issuer, subject: row.subject, statusCode: row.statusCode },
    );
    return { data: clientIdentity(row), etag: tag(row.rowVersion) };
  }

  async bind(
    identity: CustomerIdentity,
    clientId: string,
    body: ClientBindingDto,
  ) {
    this.require(identity, permissions.usersManage);
    const client = await this.db.externalClientIdentity.findFirst({
      where: { id: clientId, statusCode: "ACTIVE" },
    });
    if (!client) missing("CLIENT_IDENTITY_NOT_FOUND");
    await this.account(identity, body.accountId);
    const row = await this.db.clientCustomerBinding.create({
      data: {
        externalClientIdentityId: clientId,
        accountId: body.accountId,
        validFrom: body.validFrom ? new Date(body.validFrom) : new Date(),
        createdByUserId: identity.userId,
      },
    });
    await this.audit(
      identity,
      "CLIENT_CUSTOMER_BOUND",
      "CLIENT_CUSTOMER_BINDING",
      row.id,
      { clientId, accountId: body.accountId },
    );
    return { data: binding(row), etag: tag(row.rowVersion) };
  }

  async revokeBinding(
    identity: CustomerIdentity,
    bindingId: string,
    expected: bigint,
  ) {
    this.require(identity, permissions.usersManage);
    const changed = await this.db.clientCustomerBinding.updateMany({
      where: { id: bindingId, rowVersion: expected, statusCode: "ACTIVE" },
      data: {
        statusCode: "REVOKED",
        validTo: new Date(),
        revokedAt: new Date(),
        revokedByUserId: identity.userId,
        rowVersion: { increment: 1 },
      },
    });
    if (changed.count !== 1) precondition();
    const row = await this.db.clientCustomerBinding.findUniqueOrThrow({
      where: { id: bindingId },
    });
    await this.audit(
      identity,
      "CLIENT_CUSTOMER_BINDING_REVOKED",
      "CLIENT_CUSTOMER_BINDING",
      bindingId,
      binding(row),
    );
    return { data: binding(row), etag: tag(row.rowVersion) };
  }

  portalContext(identity: ExternalPortalIdentity) {
    return this.db.account
      .findMany({
        where: {
          id: { in: [...identity.accountIds] },
          recordStatusCode: "ACTIVE",
        },
        select: {
          id: true,
          accountRef: true,
          canonicalName: true,
          countryCode: true,
        },
        orderBy: { canonicalName: "asc" },
      })
      .then((rows) => ({
        data: rows.map((row) => ({
          accountId: row.id,
          accountRef: row.accountRef,
          displayName: row.canonicalName,
          countryCode: row.countryCode.trim(),
        })),
      }));
  }

  async portalOrders(
    identity: ExternalPortalIdentity,
    accountId: string,
    query: CrPageQuery,
  ) {
    portalAccount(identity, accountId);
    const where = { accountId, dqStatusCode: { not: "DATA_CONFLICT" } };
    const [total, rows] = await this.db.$transaction([
      this.db.eRPOrder.count({ where }),
      this.db.eRPOrder.findMany({
        where,
        skip: query.offset,
        take: query.limit,
        orderBy: [{ orderDate: "desc" }, { id: "asc" }],
        select: {
          id: true,
          sourceOrderKey: true,
          orderDate: true,
          statusCode: true,
          countryCode: true,
        },
      }),
    ]);
    const lines = await this.db.eRPOrderLine.findMany({
      where: {
        erpOrderId: { in: rows.map((row) => row.id) },
        dqStatusCode: { not: "DATA_CONFLICT" },
      },
      select: {
        erpOrderId: true,
        productId: true,
        qtyBooked: true,
        qtyShipped: true,
        qtyRemaining: true,
      },
    });
    return page(
      rows.map((row) => ({
        erpOrderId: row.id,
        orderReference: row.sourceOrderKey,
        orderDate: row.orderDate?.toISOString().slice(0, 10) ?? null,
        statusCode: row.statusCode,
        countryCode: row.countryCode?.trim() ?? null,
        lines: lines
          .filter((line) => line.erpOrderId === row.id)
          .map((line) => ({
            productId: line.productId,
            orderedQty: line.qtyBooked.toString(),
            shippedQty: line.qtyShipped.toString(),
            remainingQty: line.qtyRemaining?.toString() ?? null,
          })),
      })),
      query,
      total,
    );
  }

  async portalShipments(
    identity: ExternalPortalIdentity,
    accountId: string,
    query: CrPageQuery,
  ) {
    portalAccount(identity, accountId);
    const [orders, customerOrders] = await Promise.all([
      this.db.eRPOrder.findMany({
        where: { accountId },
        select: { id: true },
      }),
      this.db.customerOrder.findMany({
        where: { accountId },
        select: { id: true },
      }),
    ]);
    const where: Prisma.ShipmentWhereInput = {
      OR: [
        { erpOrderId: { in: orders.map((row) => row.id) } },
        { customerOrderId: { in: customerOrders.map((row) => row.id) } },
      ],
    };
    const [total, rows] = await this.db.$transaction([
      this.db.shipment.count({ where }),
      this.db.shipment.findMany({
        where,
        skip: query.offset,
        take: query.limit,
        orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      }),
    ]);
    return page(rows.map(portalShipment), query, total);
  }

  async portalComplaints(
    identity: ExternalPortalIdentity,
    accountId: string,
    query: CrPageQuery,
  ) {
    portalAccount(identity, accountId);
    const where = { accountId };
    const [total, rows] = await this.db.$transaction([
      this.db.complaint.count({ where }),
      this.db.complaint.findMany({
        where,
        skip: query.offset,
        take: query.limit,
        orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      }),
    ]);
    return page(rows.map(portalComplaint), query, total);
  }

  async createPortalComplaint(
    identity: ExternalPortalIdentity,
    accountId: string,
    body: PortalComplaintDto,
  ) {
    portalAccount(identity, accountId);
    const account = await this.db.account.findFirst({
      where: { id: accountId, recordStatusCode: "ACTIVE" },
    });
    if (!account) missing("CUSTOMER_NOT_FOUND");
    if (
      body.productId &&
      !(await this.db.product.findFirst({
        where: { id: body.productId, recordStatusCode: "ACTIVE" },
      }))
    )
      missing("PRODUCT_NOT_FOUND");
    const row = await this.db.complaint.create({
      data: {
        accountId,
        countryCode: account.countryCode,
        complaintTypeCode: body.complaintTypeCode,
        description: body.description.trim(),
        productId: body.productId ?? null,
        ownerUserId: account.ownerUserId,
      },
    });
    await this.db.auditEvent.create({
      data: {
        actionCode: "PORTAL_COMPLAINT_CREATED",
        resourceType: "COMPLAINT",
        resourceId: row.id,
        workspace: "CLIENT_PORTAL",
        countryCode: account.countryCode,
        metadata: {
          externalClientIdentityId: identity.externalClientIdentityId,
          accountId,
        },
        traceId: identity.traceId,
        correlationId: identity.correlationId,
        source: "client-portal-api",
      },
    });
    return { data: portalComplaint(row) };
  }

  async researchSizes(identity: CustomerIdentity, query: AsOfQuery) {
    this.require(identity, permissions.researchView);
    const asOf = query.asOf ? new Date(query.asOf) : new Date();
    const countries = [...identity.countryCodes];
    const rows = await this.db.$queryRaw<
      {
        productId: string;
        skuCode: string | null;
        thicknessMm: Prisma.Decimal | null;
        widthMm: Prisma.Decimal | null;
        lengthMm: Prisma.Decimal | null;
        requestedQty: Prisma.Decimal;
        quotationCount: bigint;
      }[]
    >`
      SELECT p.product_id AS "productId", p.sku_code AS "skuCode", p.thickness_mm AS "thicknessMm",
             p.width_mm AS "widthMm", p.length_mm AS "lengthMm",
             SUM(ql.qty) AS "requestedQty", COUNT(DISTINCT q.quotation_id) AS "quotationCount"
      FROM quotation_lines ql
      JOIN quotations q ON q.quotation_id = ql.quotation_id
      JOIN products p ON p.product_id = ql.product_id
      WHERE q.status_code = 'SENT'
        AND q.commercial_state_code IN ('SUBMITTED','UNDER_NEGOTIATION')
        AND q.first_submitted_at <= ${asOf}
        AND q.country_code IN (${Prisma.join(countries)})
      GROUP BY p.product_id, p.sku_code, p.thickness_mm, p.width_mm, p.length_mm
      ORDER BY SUM(ql.qty) DESC, p.product_id
      OFFSET ${query.offset} LIMIT ${query.limit}`;
    return {
      data: rows.map((row) => ({
        productId: row.productId,
        skuCode: row.skuCode,
        thicknessMm: row.thicknessMm?.toString() ?? null,
        widthMm: row.widthMm?.toString() ?? null,
        lengthMm: row.lengthMm?.toString() ?? null,
        totalRequestedQuantity: row.requestedQty.toString(),
        distinctOfficialQuotationCount: Number(row.quotationCount),
      })),
      meta: {
        offset: query.offset,
        limit: query.limit,
        asOf: asOf.toISOString(),
        countryCodes: countries,
        customerIdentityOmitted: true,
      },
    };
  }

  async marketScopeAsOf(countryCode: string | null, asOf: Date) {
    if (!countryCode)
      return { classification: "UNCLASSIFIED", ruleVersion: null };
    const rule = await this.db.geographyClassificationRule.findFirst({
      where: {
        countryCode,
        effectiveFrom: { lte: asOf },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: asOf } }],
      },
      orderBy: { effectiveFrom: "desc" },
    });
    return rule
      ? { classification: rule.classification, ruleVersion: rule.versionCode }
      : { classification: "GLOBAL", ruleVersion: "PRE-CR001-DEFAULT" };
  }

  /**
   * The customer this request is about, if the caller may reach it.
   *
   * This carried its own copy of the access policy, and the copy had dropped
   * the administrator, the manager and the access level -- so the segments
   * panel on the customer screen answered 404 for everyone except the record's
   * own owner. It reads the one policy now; see account-scope.ts.
   */
  private async account(identity: CustomerIdentity, accountId: string) {
    const row = await this.db.account.findFirst({
      where: {
        id: accountId,
        countryCode: { in: [...identity.countryCodes] },
        OR: accountAccessWhere(identity, "VIEW"),
      },
    });
    if (!row) missing("ACCOUNT_NOT_FOUND");
    return row;
  }
  /** The truck or the container leaves, with what identifies it. */
  async dispatchShipment(
    identity: CustomerIdentity,
    id: string,
    key: string,
    body: DispatchShipmentDto,
  ) {
    const vehicle = body.vehicleRef?.trim() || null;
    const container = body.containerNo?.trim() || null;
    return this.executeShipment(identity, id, key, "SHIPMENT_DISPATCH", body, {
      to: "SHIPPED",
      occurredAt: body.dispatchedAt,
      check: () => {
        // Something has to say which truck or which box went.
        if (!vehicle && !container) rule("VEHICLE_OR_CONTAINER_REQUIRED");
      },
      data: {
        dispatchedAt: new Date(body.dispatchedAt),
        vehicleRef: vehicle,
        containerNo: container,
        sealNo: body.sealNo?.trim() || null,
        driverName: body.driverName?.trim() || null,
        driverPhone: body.driverPhone?.trim() || null,
        ...(body.expectedDeliveryDate
          ? {
              expectedDeliveryDate: new Date(
                body.expectedDeliveryDate.slice(0, 10),
              ),
            }
          : {}),
      },
      action: "SHIPMENT_DISPATCHED",
    });
  }

  /** The customer takes the goods; when the last load lands, the order is handed over. */
  async deliverShipment(
    identity: CustomerIdentity,
    id: string,
    key: string,
    body: DeliverShipmentDto,
  ) {
    const notes = body.deliveryNotes?.trim() || null;
    return this.executeShipment(identity, id, key, "SHIPMENT_DELIVER", body, {
      to: "DELIVERED",
      occurredAt: body.deliveredAt,
      check: () => {
        if (body.deliveryConditionCode !== "GOOD" && !notes)
          rule("DELIVERY_NOTES_REQUIRED");
        if (new Date(body.deliveredAt).getTime() > Date.now() + 5 * 60_000)
          rule("DELIVERY_DATE_IN_FUTURE");
      },
      data: {
        deliveredAt: new Date(body.deliveredAt),
        receivedByName: body.receivedByName.trim(),
        deliveryConditionCode: body.deliveryConditionCode,
        deliveryNotes: notes,
      },
      action: "SHIPMENT_DELIVERED",
      after: async (tx, row) => {
        if (row.customerOrderId)
          await this.handOverIfDelivered(
            tx,
            identity,
            row.customerOrderId,
            row.shipmentRef,
            new Date(body.deliveredAt),
          );
      },
    });
  }

  /** The signed delivery note is back: the delivery is proven. */
  async shipmentPod(
    identity: CustomerIdentity,
    id: string,
    key: string,
    body: ShipmentPodDto,
  ) {
    const reference = body.podReference?.trim() || null;
    return this.executeShipment(identity, id, key, "SHIPMENT_POD", body, {
      to: "POD_RECEIVED",
      occurredAt: body.podReceivedAt,
      check: async () => {
        if (!reference && !body.podDocumentId) rule("POD_EVIDENCE_REQUIRED");
        if (body.podDocumentId) {
          const document = await this.db.documentMetadata.findFirst({
            where: { id: body.podDocumentId },
            select: { id: true },
          });
          if (!document) missing("POD_DOCUMENT_NOT_FOUND");
        }
      },
      data: {
        podReceivedAt: new Date(body.podReceivedAt),
        podReference: reference,
        podDocumentId: body.podDocumentId ?? null,
      },
      action: "SHIPMENT_POD_RECEIVED",
    });
  }

  /** One step along the route, recorded the same way for every step. */
  private async executeShipment(
    identity: CustomerIdentity,
    id: string,
    key: string,
    operationCode: string,
    body: { expectedRowVersion: string },
    step: {
      to: string;
      occurredAt: string;
      check: () => void | Promise<void>;
      data: Prisma.ShipmentUpdateManyMutationInput;
      action: string;
      after?: (
        tx: Prisma.TransactionClient,
        row: Prisma.ShipmentGetPayload<object>,
      ) => Promise<void>;
    },
  ) {
    this.require(identity, permissions.shipmentsEdit);
    requireKey(key);
    const requestHash = hash({ id, body });
    const replay = await this.replay(identity, operationCode, key, requestHash);
    if (replay) return this.shipment(identity, replay);
    const before = await this.scopedShipment(identity, id);
    if (before.rowVersion !== BigInt(body.expectedRowVersion)) precondition();
    if (!isNextStep(before.transportModeCode, before.milestoneCode, step.to))
      rule("SHIPMENT_TRANSITION_INVALID");
    await step.check();
    const updated = await this.db.$transaction(async (tx) => {
      const changed = await tx.shipment.updateMany({
        where: { id, rowVersion: before.rowVersion },
        data: {
          ...step.data,
          milestoneCode: step.to,
          updatedByUserId: identity.userId,
          rowVersion: { increment: 1 },
        },
      });
      if (changed.count !== 1) precondition();
      const row = await tx.shipment.findUniqueOrThrow({ where: { id } });
      await tx.shipmentMilestoneEvent.create({
        data: {
          shipmentId: id,
          fromMilestoneCode: before.milestoneCode,
          toMilestoneCode: step.to,
          businessOccurredAt: new Date(step.occurredAt),
          actorUserId: identity.userId,
          previousSnapshot: shipmentSnapshot(before),
          newSnapshot: shipmentSnapshot(row),
        },
      });
      if (step.after) await step.after(tx, row);
      await remember(tx, identity, operationCode, key, requestHash, id);
      return row;
    });
    await this.audit(identity, step.action, "SHIPMENT", id, shipment(updated));
    return this.shipment(identity, id);
  }

  /**
   * When every shipment of a READY order has been delivered, the order has
   * been handed over -- on the day the last load was delivered, which also
   * starts the clock on its "days after delivery" installments. An order not
   * yet marked ready is left for a person to move: a delivery against an
   * order still in production is a partial one.
   */
  private async handOverIfDelivered(
    tx: Prisma.TransactionClient,
    identity: CustomerIdentity,
    customerOrderId: string,
    shipmentRef: string,
    deliveredAt: Date,
  ) {
    const order = await tx.customerOrder.findUnique({
      where: { id: customerOrderId },
    });
    if (order?.statusCode !== "READY") return;
    const shipments = await tx.shipment.findMany({
      where: { customerOrderId },
      select: { milestoneCode: true },
    });
    if (!allDelivered(shipments.map((one) => one.milestoneCode))) return;
    const moved = await tx.customerOrder.updateMany({
      where: { id: order.id, rowVersion: order.rowVersion },
      data: {
        statusCode: "HANDED_OVER",
        handedOverAt: deliveredAt,
        handedOverByUserId: identity.userId,
        rowVersion: { increment: 1 },
        updatedAt: new Date(),
      },
    });
    if (moved.count !== 1) precondition();
    await tx.customerOrderEvent.create({
      data: {
        customerOrderId: order.id,
        eventCode: "STATUS_CHANGED",
        fromStatusCode: "READY",
        toStatusCode: "HANDED_OVER",
        note: `Delivered — ${shipmentRef}`,
        details: { shipmentRef, automatic: true },
        actorUserId: identity.userId,
      },
    });
    await dateFromHandover(tx, order.id, deliveredAt);
  }

  /** The order and customer a shipment belongs to, for showing it. */
  private async shipmentContext(rows: Prisma.ShipmentGetPayload<object>[]) {
    const customerOrderIds = [
      ...new Set(
        rows
          .map((row) => row.customerOrderId)
          .filter((value): value is string => value !== null),
      ),
    ];
    const erpOrderIds = [
      ...new Set(
        rows
          .map((row) => row.erpOrderId)
          .filter((value): value is string => value !== null),
      ),
    ];
    const [customerOrders, erpOrders] = await Promise.all([
      customerOrderIds.length === 0
        ? []
        : this.db.customerOrder.findMany({
            where: { id: { in: customerOrderIds } },
            select: {
              id: true,
              orderRef: true,
              quotationId: true,
              statusCode: true,
              accountId: true,
              account: { select: { canonicalName: true } },
            },
          }),
      erpOrderIds.length === 0
        ? []
        : this.db.eRPOrder.findMany({
            where: { id: { in: erpOrderIds } },
            select: { id: true, orderNumberRaw: true, sourceOrderKey: true },
          }),
    ]);
    return (row: Prisma.ShipmentGetPayload<object>) => {
      const order = customerOrders.find(
        (one) => one.id === row.customerOrderId,
      );
      const erp = erpOrders.find((one) => one.id === row.erpOrderId);
      return {
        orderRef:
          order?.orderRef ?? erp?.orderNumberRaw ?? erp?.sourceOrderKey ?? null,
        orderStatusCode: order?.statusCode ?? null,
        quotationId: order?.quotationId ?? null,
        accountId: order?.accountId ?? null,
        accountName: order?.account.canonicalName ?? null,
      };
    };
  }

  private scopedShipment(identity: CustomerIdentity, id: string) {
    return this.db.shipment
      .findFirst({
        where: { id, countryCode: { in: [...identity.countryCodes] } },
      })
      .then((row) => row ?? missing("SHIPMENT_NOT_FOUND"));
  }
  private require(identity: CustomerIdentity, permission: string) {
    if (
      identity.deniedPermissions.has(permission) ||
      !identity.permissions.has(permission)
    )
      forbidden();
  }
  private replay(
    identity: CustomerIdentity,
    operationCode: string,
    key: string,
    requestHash: string,
  ) {
    return this.db.commandIdempotency
      .findUnique({
        where: {
          actorUserId_operationCode_idempotencyKey: {
            actorUserId: identity.userId,
            operationCode,
            idempotencyKey: key,
          },
        },
      })
      .then((row) => {
        if (row && row.requestHash !== requestHash)
          conflict("IDEMPOTENCY_KEY_REUSED");
        return row?.responseResourceId ?? null;
      });
  }
  private audit(
    identity: CustomerIdentity,
    actionCode: string,
    resourceType: string,
    resourceId: string,
    after: unknown,
  ) {
    return this.db.auditEvent.create({
      data: {
        actorUserId: identity.userId,
        actorSessionId: identity.sessionId,
        actionCode,
        resourceType,
        resourceId,
        workspace: "CR001",
        afterSnapshot: after as Prisma.InputJsonValue,
        traceId: identity.traceId,
        correlationId: identity.correlationId,
        source: "cr001-api",
      },
    });
  }
}

const page = <T>(data: T[], q: CrPageQuery, total: number) => ({
  data,
  meta: {
    offset: q.offset,
    limit: q.limit,
    total,
    hasNext: q.offset + data.length < total,
  },
});
const tag = (v: bigint) => `"rv-${v.toString()}"`;
const hash = (v: unknown) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
const segment = (x: {
  id: string;
  code: string;
  displayNameEn: string;
  displayNameAr: string;
  statusCode: string;
  rowVersion: bigint;
  createdAt: Date;
  archivedAt: Date | null;
}) => ({
  segmentId: x.id,
  code: x.code,
  displayNameEn: x.displayNameEn,
  displayNameAr: x.displayNameAr,
  statusCode: x.statusCode,
  rowVersion: x.rowVersion.toString(),
  createdAt: x.createdAt.toISOString(),
  archivedAt: x.archivedAt?.toISOString() ?? null,
});
const assignment = (
  x: {
    id: string;
    accountId: string;
    segmentId: string;
    effectiveFrom: Date;
    effectiveTo: Date | null;
    sourceCode: string;
    sourceReference: string | null;
  },
  d?: { code: string; displayNameEn: string; displayNameAr: string },
) => ({
  assignmentId: x.id,
  accountId: x.accountId,
  segmentId: x.segmentId,
  segmentCode: d?.code ?? null,
  displayNameEn: d?.displayNameEn ?? null,
  displayNameAr: d?.displayNameAr ?? null,
  effectiveFrom: x.effectiveFrom.toISOString(),
  effectiveTo: x.effectiveTo?.toISOString() ?? null,
  sourceCode: x.sourceCode,
  sourceReference: x.sourceReference,
});
const quotationState = (x: {
  id: string;
  quotationRef: string;
  statusCode: string;
  commercialStateCode: string;
  firstSubmittedAt: Date | null;
  rowVersion: bigint;
}) => ({
  quotationId: x.id,
  quotationRef: x.quotationRef,
  documentState: x.statusCode,
  commercialState: x.commercialStateCode,
  firstSubmittedAt: x.firstSubmittedAt?.toISOString() ?? null,
  rowVersion: x.rowVersion.toString(),
});
const shipment = (x: Prisma.ShipmentGetPayload<object>) => ({
  shipmentId: x.id,
  shipmentRef: x.shipmentRef,
  erpOrderId: x.erpOrderId,
  customerOrderId: x.customerOrderId,
  countryCode: x.countryCode.trim(),
  transportModeCode: x.transportModeCode,
  milestoneCode: x.milestoneCode,
  plannedDispatchDate:
    x.plannedDispatchDate?.toISOString().slice(0, 10) ?? null,
  expectedDeliveryDate:
    x.expectedDeliveryDate?.toISOString().slice(0, 10) ?? null,
  loadPlan: x.loadPlan ?? null,
  vehicleRef: x.vehicleRef,
  containerNo: x.containerNo,
  sealNo: x.sealNo,
  driverName: x.driverName,
  driverPhone: x.driverPhone,
  dispatchedAt: x.dispatchedAt?.toISOString() ?? null,
  blDate: x.blDate?.toISOString().slice(0, 10) ?? null,
  portOfDischarge: x.portOfDischarge,
  actualArrivalAt: x.actualArrivalAt?.toISOString() ?? null,
  deliveredAt: x.deliveredAt?.toISOString() ?? null,
  receivedByName: x.receivedByName,
  deliveryConditionCode: x.deliveryConditionCode,
  deliveryNotes: x.deliveryNotes,
  podReceivedAt: x.podReceivedAt?.toISOString() ?? null,
  podReference: x.podReference,
  podDocumentId: x.podDocumentId,
  rowVersion: x.rowVersion.toString(),
  createdAt: x.createdAt.toISOString(),
  updatedAt: x.updatedAt.toISOString(),
});
/** The same, as a JSON value for the milestone history. */
const shipmentSnapshot = (
  x: Prisma.ShipmentGetPayload<object>,
): Prisma.InputJsonValue => {
  const { loadPlan, ...rest } = shipment(x);
  return { ...rest, loadPlan: (loadPlan ?? null) as Prisma.InputJsonValue };
};
const portalShipment = (x: Parameters<typeof shipment>[0]) => {
  const s = shipment(x);
  return {
    shipmentId: s.shipmentId,
    shipmentRef: s.shipmentRef,
    erpOrderId: s.erpOrderId,
    milestoneCode: s.milestoneCode,
    blDate: s.blDate,
    portOfDischarge: s.portOfDischarge,
    actualArrivalAt: s.actualArrivalAt,
  };
};
const event = (x: {
  id: string;
  eventTypeCode: string;
  fromMilestoneCode: string | null;
  toMilestoneCode: string;
  businessOccurredAt: Date;
  recordedAt: Date;
  reason: string | null;
}) => ({
  eventId: x.id,
  eventTypeCode: x.eventTypeCode,
  fromMilestoneCode: x.fromMilestoneCode,
  toMilestoneCode: x.toMilestoneCode,
  businessOccurredAt: x.businessOccurredAt.toISOString(),
  recordedAt: x.recordedAt.toISOString(),
  reason: x.reason,
});
const portalComplaint = (x: {
  id: string;
  complaintRef: string;
  accountId: string;
  productId: string | null;
  complaintTypeCode: string;
  statusCode: string;
  description: string;
  resolution: string | null;
  createdAt: Date;
  updatedAt: Date;
}) => ({
  complaintId: x.id,
  complaintRef: x.complaintRef,
  accountId: x.accountId,
  productId: x.productId,
  complaintTypeCode: x.complaintTypeCode,
  statusCode: x.statusCode,
  description: x.description,
  resolution: x.resolution,
  createdAt: x.createdAt.toISOString(),
  updatedAt: x.updatedAt.toISOString(),
});
const clientIdentity = (x: {
  id: string;
  issuer: string;
  subject: string;
  displayName: string | null;
  emailNormalized: string | null;
  statusCode: string;
  rowVersion: bigint;
}) => ({
  clientIdentityId: x.id,
  issuer: x.issuer,
  subject: x.subject,
  displayName: x.displayName,
  email: x.emailNormalized,
  statusCode: x.statusCode,
  rowVersion: x.rowVersion.toString(),
});
const binding = (x: {
  id: string;
  externalClientIdentityId: string;
  accountId: string;
  statusCode: string;
  validFrom: Date;
  validTo: Date | null;
  rowVersion: bigint;
}) => ({
  bindingId: x.id,
  clientIdentityId: x.externalClientIdentityId,
  accountId: x.accountId,
  statusCode: x.statusCode,
  validFrom: x.validFrom.toISOString(),
  validTo: x.validTo?.toISOString() ?? null,
  rowVersion: x.rowVersion.toString(),
});
function portalAccount(i: ExternalPortalIdentity, id: string) {
  if (!i.accountIds.includes(id)) missing("PORTAL_RESOURCE_NOT_FOUND");
}
function requireKey(key: string) {
  if (!key || key.length > 200) bad("IDEMPOTENCY_KEY_REQUIRED");
}
async function remember(
  tx: Prisma.TransactionClient,
  i: CustomerIdentity,
  operationCode: string,
  key: string,
  requestHash: string,
  responseResourceId: string,
) {
  await tx.commandIdempotency.create({
    data: {
      actorUserId: i.userId,
      operationCode,
      idempotencyKey: key,
      requestHash,
      responseResourceId,
    },
  });
}
function bad(code: string): never {
  throw new ApiProblem({ status: 400, code });
}
function forbidden(): never {
  throw new ApiProblem({ status: 403, code: "FORBIDDEN" });
}
function missing(code: string): never {
  throw new ApiProblem({ status: 404, code });
}
function conflict(code: string): never {
  throw new ApiProblem({ status: 409, code });
}
function precondition(): never {
  throw new ApiProblem({ status: 412, code: "ROW_VERSION_MISMATCH" });
}
function rule(code: string): never {
  throw new ApiProblem({ status: 422, code });
}
