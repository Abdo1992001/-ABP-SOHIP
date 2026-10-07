import { Inject, Injectable } from "@nestjs/common";
import { permissions } from "@abp/contracts";
import type { DatabaseClient, TransactionManager } from "@abp/database";
import {
  hasWorkspace,
  type CustomerIdentity,
} from "../customer/customer-auth.js";
import { accountAccessWhere } from "../customer/account-scope.js";
import { projectContextWhere } from "../customer/project.service.js";
import { ApiProblem } from "../platform/api-exception.filter.js";
import { AuditService } from "../platform/audit.service.js";
import {
  databaseClientToken,
  transactionManagerToken,
} from "../platform/database.providers.js";
import { EGYPT_PLACES, locate } from "./places.js";
import type { MapPlacesQuery, PinLocationDto } from "./map.dto.js";

type Money = Record<string, number>;
const add = (
  bucket: Money,
  currency: string | null | undefined,
  amount: unknown,
) => {
  const code = (currency ?? "").trim() || "—";
  const value = Number(amount);
  if (!Number.isFinite(value) || value === 0) return;
  bucket[code] = Math.round(((bucket[code] ?? 0) + value) * 100) / 100;
};

/**
 * The map: who we deal with, and where.
 *
 * Every visible customer and project is placed -- by its pin, by the district
 * or city in its address, or by its country -- with what we have done with
 * it: orders and quotations by value, the projects it is on and in what role.
 * That is what a salesperson driving to the Fifth Settlement wants to know
 * about the companies around it.
 */
@Injectable()
export class MapService {
  constructor(
    @Inject(databaseClientToken) private readonly db: DatabaseClient,
    @Inject(transactionManagerToken) private readonly txs: TransactionManager,
    private readonly audit: AuditService,
  ) {}

  async places(i: CustomerIdentity, q: MapPlacesQuery) {
    this.require(i, permissions.accountsView);
    const countries = [...i.countryCodes].filter(
      (code) => !q.countryCode || code === q.countryCode,
    );
    const [accounts, projects] = await Promise.all([
      this.db.account.findMany({
        where: {
          countryCode: { in: countries },
          recordStatusCode: "ACTIVE",
          OR: accountAccessWhere(i, "VIEW"),
        },
        select: {
          id: true,
          accountRef: true,
          canonicalName: true,
          countryCode: true,
          address: true,
          latitude: true,
          longitude: true,
          ownerUserId: true,
        },
        take: 5000,
      }),
      this.db.project.findMany({
        where: {
          countryCode: { in: countries },
          recordStatusCode: "ACTIVE",
          AND: [{ OR: projectContextWhere(i, "VIEW") }],
        },
        select: {
          id: true,
          projectRef: true,
          name: true,
          countryCode: true,
          city: true,
          region: true,
          addressText: true,
          stageCode: true,
          latitude: true,
          longitude: true,
          commercialOwnerUserId: true,
          parties: {
            where: { statusCode: "ACTIVE" },
            select: {
              accountId: true,
              roleCode: true,
              account: { select: { canonicalName: true } },
            },
          },
        },
        take: 5000,
      }),
    ]);
    const accountIds = accounts.map((row) => row.id);
    const projectIds = projects.map((row) => row.id);
    const [orders, quotations, opportunities, users] = await Promise.all([
      this.db.customerOrder.findMany({
        where: {
          accountId: { in: accountIds },
          statusCode: { not: "CANCELLED" },
        },
        select: { accountId: true, currencyCode: true, totalAmount: true },
      }),
      this.db.quotation.findMany({
        where: {
          OR: [
            { accountId: { in: accountIds } },
            { projectId: { in: projectIds } },
          ],
        },
        select: {
          accountId: true,
          projectId: true,
          currencyCode: true,
          totalAmount: true,
          statusCode: true,
        },
      }),
      this.db.opportunity.findMany({
        where: {
          accountId: { in: accountIds },
          stageCode: { notIn: ["WON", "LOST"] },
        },
        select: { accountId: true },
      }),
      this.db.appUser.findMany({
        where: {
          id: {
            in: [
              ...new Set([
                ...accounts.map((row) => row.ownerUserId),
                ...projects.map((row) => row.commercialOwnerUserId),
              ]),
            ],
          },
        },
        select: { id: true, displayName: true },
      }),
    ]);
    const nameOf = (id: string) =>
      users.find((user) => user.id === id)?.displayName ?? null;

    const projectPoints = projects.flatMap((row) => {
      const at = locate({
        latitude: row.latitude,
        longitude: row.longitude,
        countryCode: row.countryCode,
        texts: [row.addressText, row.region, row.city],
      });
      if (at === null) return [];
      const value: Money = {};
      for (const quote of quotations.filter((one) => one.projectId === row.id))
        add(value, quote.currencyCode, quote.totalAmount);
      return [
        {
          kind: "PROJECT" as const,
          id: row.id,
          ref: row.projectRef,
          name: row.name,
          countryCode: row.countryCode.trim(),
          city: row.city,
          region: row.region,
          address: row.addressText,
          stageCode: row.stageCode,
          ownerName: nameOf(row.commercialOwnerUserId),
          parties: row.parties.map((party) => ({
            accountId: party.accountId,
            accountName: party.account.canonicalName,
            roleCode: party.roleCode,
          })),
          quotedValue: value,
          quotations: quotations.filter((one) => one.projectId === row.id)
            .length,
          ...at,
        },
      ];
    });

    const accountPoints = accounts.flatMap((row) => {
      // A customer with no address of its own is where its projects are.
      const onProjects = projectPoints.filter((point) =>
        point.parties.some((party) => party.accountId === row.id),
      );
      const firstProject = onProjects.find(
        (point) => point.precision !== "COUNTRY",
      );
      const own = locate({
        latitude: row.latitude,
        longitude: row.longitude,
        countryCode: row.countryCode,
        texts: [row.address],
      });
      const at =
        own && own.precision !== "COUNTRY"
          ? own
          : firstProject
            ? {
                lat: firstProject.lat,
                lng: firstProject.lng,
                precision: "VIA_PROJECT" as const,
                placeKey: firstProject.placeKey,
              }
            : own;
      if (at === null) return [];
      const ordered: Money = {};
      const theirOrders = orders.filter((one) => one.accountId === row.id);
      for (const order of theirOrders)
        add(ordered, order.currencyCode, order.totalAmount);
      const quoted: Money = {};
      const theirQuotes = quotations.filter((one) => one.accountId === row.id);
      for (const quote of theirQuotes)
        add(quoted, quote.currencyCode, quote.totalAmount);
      const roles = [
        ...new Set(
          onProjects.flatMap((point) =>
            point.parties
              .filter((party) => party.accountId === row.id)
              .map((party) => party.roleCode),
          ),
        ),
      ];
      return [
        {
          kind: "ACCOUNT" as const,
          id: row.id,
          ref: row.accountRef,
          name: row.canonicalName,
          countryCode: row.countryCode.trim(),
          address: row.address,
          ownerName: nameOf(row.ownerUserId),
          roles,
          projects: onProjects.map((point) => ({
            id: point.id,
            name: point.name,
          })),
          orders: theirOrders.length,
          orderedValue: ordered,
          quotations: theirQuotes.length,
          quotedValue: quoted,
          openOpportunities: opportunities.filter(
            (one) => one.accountId === row.id,
          ).length,
          ...at,
        },
      ];
    });

    return {
      data: {
        accounts: accountPoints,
        projects: projectPoints,
        // Places the screen can fly to, with their Arabic names.
        places: EGYPT_PLACES.map((place) => ({
          key: place.key,
          en: place.en,
          ar: place.ar,
          lat: place.lat,
          lng: place.lng,
          governorate: place.governorate ?? null,
        })),
        canPinAccounts: this.holds(i, permissions.accountsEdit),
        canPinProjects: this.holds(i, permissions.projectsEdit),
      },
    };
  }

  /** Put a customer or a project exactly where it is -- or take its pin away. */
  async pin(i: CustomerIdentity, b: PinLocationDto) {
    const clear = b.latitude === null || b.longitude === null;
    const data = clear
      ? { latitude: null, longitude: null }
      : { latitude: b.latitude, longitude: b.longitude };
    await this.txs.run(i, async (tx) => {
      if (b.resourceTypeCode === "ACCOUNT") {
        this.require(i, permissions.accountsEdit);
        const found = await tx.account.updateMany({
          where: {
            id: b.resourceId,
            countryCode: { in: [...i.countryCodes] },
            OR: accountAccessWhere(i, "COLLABORATE_EDIT"),
          },
          data,
        });
        if (found.count !== 1) missing();
      } else {
        this.require(i, permissions.projectsEdit);
        const found = await tx.project.updateMany({
          where: {
            id: b.resourceId,
            countryCode: { in: [...i.countryCodes] },
            AND: [{ OR: projectContextWhere(i, "COLLABORATE_EDIT") }],
          },
          data,
        });
        if (found.count !== 1) missing();
      }
      await this.audit.record(tx, {
        actorUserId: i.userId,
        actorSessionId: i.sessionId,
        actionCode: clear ? "MAP_PIN_REMOVED" : "MAP_PIN_SET",
        resourceType: b.resourceTypeCode === "ACCOUNT" ? "Account" : "Project",
        resourceId: b.resourceId,
        workspace: "SALES",
        countryCode: null,
        metadata: data,
        traceId: i.traceId,
        correlationId: i.correlationId,
        source: "map-api",
      });
    });
    return {
      data: {
        resourceTypeCode: b.resourceTypeCode,
        resourceId: b.resourceId,
        ...data,
      },
    };
  }

  private holds(i: CustomerIdentity, p: string) {
    return i.permissions.has(p) && !i.deniedPermissions.has(p);
  }

  private require(i: CustomerIdentity, p: string) {
    if (!hasWorkspace(i, "SALES") || !this.holds(i, p))
      throw new ApiProblem({ status: 403, code: "FORBIDDEN" });
  }
}

function missing(): never {
  throw new ApiProblem({ status: 404, code: "RESOURCE_NOT_FOUND" });
}
