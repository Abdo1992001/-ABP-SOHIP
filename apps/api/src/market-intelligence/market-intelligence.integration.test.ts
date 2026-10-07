/* eslint-disable @typescript-eslint/consistent-type-imports, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { DatabaseClient } from "@abp/database";
import { permissions } from "@abp/contracts";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ids = {
  owner: "f3000000-0000-4000-8000-000000000001",
  portal: "f3000000-0000-4000-8000-000000000002",
  salesRole: "f3100000-0000-4000-8000-000000000001",
  portalRole: "f3100000-0000-4000-8000-000000000002",
  account: "f3200000-0000-4000-8000-000000000001",
  outsideSignal: "f3300000-0000-4000-8000-000000000001",
} as const;

describe.runIf(process.env.TEST_DATABASE_URL !== undefined)(
  "commercial intelligence PostgreSQL integration",
  () => {
    let application: INestApplication;
    let database: DatabaseClient;

    beforeAll(async () => {
      process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
      process.env.ABP_TEST_AUTH_ENABLED = "true";
      const loadBuilt = async <T>(relativePath: string): Promise<T> =>
        import(
          /* @vite-ignore */ new URL(
            `../../dist/${relativePath}`,
            import.meta.url,
          ).href
        ) as Promise<T>;
      const { AppModule } =
        await loadBuilt<typeof import("../app.module.js")>("app.module.js");
      const { configureHttpApplication } = await loadBuilt<
        typeof import("../configure-http-app.js")
      >("configure-http-app.js");
      const { databaseClientToken } = await loadBuilt<
        typeof import("../platform/database.providers.js")
      >("platform/database.providers.js");
      const module = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();
      application = module.createNestApplication();
      configureHttpApplication(application);
      await application.init();
      database = application.get(databaseClientToken);
      await seed(database);
    }, 120_000);

    afterAll(async () => {
      await application.close();
      delete process.env.ABP_TEST_AUTH_ENABLED;
    });

    it("enforces evidence classification and country scope", async () => {
      const server = application.getHttpServer();
      const actor = { "x-abp-test-user-id": ids.owner };
      await request(server)
        .post("/api/v1/market-signals")
        .set(actor)
        .send({
          title: "Unverified claim",
          sourceName: "Unknown source",
          publishedDate: "2026-09-01",
          retrievedDate: "2026-09-02",
          evidence: "Claim has not been verified.",
          verificationCode: "UNVERIFIED",
          classificationCode: "FACT",
          countryCode: "EG",
        })
        .expect(422);

      const valid = await request(server)
        .post("/api/v1/market-signals")
        .set(actor)
        .send({
          title: "Verified tender",
          sourceName: "Tender bulletin",
          publishedDate: "2026-09-01",
          retrievedDate: "2026-09-02",
          evidence: "A signed public tender notice was retrieved and reviewed.",
          verificationCode: "VERIFIED",
          classificationCode: "FACT",
          countryCode: "EG",
        })
        .expect(201);
      expect(valid.body.data.evidenceHash).toMatch(/^[a-f0-9]{64}$/);

      const list = await request(server)
        .get("/api/v1/market-signals")
        .set(actor)
        .expect(200);
      expect(list.body.data.map((row: { id: string }) => row.id)).not.toContain(
        ids.outsideSignal,
      );
    });

    it("prepares a reviewed prospect draft without creating a customer", async () => {
      const server = application.getHttpServer();
      const actor = { "x-abp-test-user-id": ids.owner };
      const prospect = await request(server)
        .post("/api/v1/target-accounts")
        .set(actor)
        .send({
          companyName: "Prospective Civil Works",
          countryCode: "EG",
          rationale: "Qualified research lead for a future drainage package.",
        })
        .expect(201);
      const before = await database.account.count();
      const prepared = await request(server)
        .post(
          `/api/v1/target-accounts/${String(prospect.body.data.id)}/prepare-customer`,
        )
        .set(actor)
        .expect(200);
      expect(prepared.body.data).toMatchObject({
        requiresConfirmation: true,
        createsBusinessRecord: false,
      });
      expect(await database.account.count()).toBe(before);
    });

    it("routes a portal repeat request to the owner without creating an order or opportunity", async () => {
      const server = application.getHttpServer();
      const beforeOrders = await database.eRPOrder.count();
      const beforeOpportunities = await database.opportunity.count();
      const created = await request(server)
        .post("/api/v1/repeat-business-requests")
        .set({ "x-abp-test-user-id": ids.portal })
        .send({
          accountId: ids.account,
          subject: "Additional drainage package",
          description:
            "Please ask the commercial owner to prepare a quotation discussion.",
        })
        .expect(201);
      expect(created.body.data).toMatchObject({
        accountId: ids.account,
        assignedOwnerUserId: ids.owner,
        statusCode: "SUBMITTED",
      });
      expect(await database.eRPOrder.count()).toBe(beforeOrders);
      expect(await database.opportunity.count()).toBe(beforeOpportunities);
      expect(
        await database.userNotification.count({
          where: {
            recipientUserId: ids.owner,
            resourceId: created.body.data.id as string,
            typeCode: "REPEAT_BUSINESS_REQUEST",
          },
        }),
      ).toBe(1);
    });
  },
);

async function seed(database: DatabaseClient) {
  await database.targetAccount.deleteMany({
    where: { companyName: "Prospective Civil Works", countryCode: "EG" },
  });
  for (const [code, name, continentCode] of [
    ["EG", "Egypt", "AFRICA"],
    ["SA", "Saudi Arabia", "ASIA"],
  ] as const) {
    await database.country.upsert({
      where: { code },
      create: { code, name, continentCode },
      update: {},
    });
  }
  for (const [id, username, roleCode] of [
    [ids.owner, "intelligence.owner", "INTELLIGENCE_TEST_SALES"],
    [ids.portal, "intelligence.portal", "CUSTOMER_PORTAL_USER"],
  ] as const) {
    await database.appUser.upsert({
      where: { id },
      create: {
        id,
        externalSubject: `intelligence-test:${id}`,
        usernameNormalized: username,
        emailNormalized: `${username}@test.local`,
        displayName: username,
      },
      update: { active: true, authStatusCode: "ACTIVE" },
    });
    await database.userCountryAccess.upsert({
      where: { userId_countryCode: { userId: id, countryCode: "EG" } },
      create: { userId: id, countryCode: "EG", grantedBy: ids.owner },
      update: { statusCode: "ACTIVE", validTo: null },
    });
    const roleId = id === ids.owner ? ids.salesRole : ids.portalRole;
    const role = await database.role.upsert({
      where: { id: roleId },
      create: {
        id: roleId,
        code: roleCode,
        name: roleCode,
        workspace: "SALES",
      },
      update: { active: true },
    });
    const grants =
      id === ids.owner
        ? [
            permissions.marketIntelligenceView,
            permissions.marketIntelligenceManage,
            permissions.targetAccountsView,
            permissions.targetAccountsManage,
            permissions.targetAccountsPrepare,
            permissions.repeatBusinessView,
            permissions.repeatBusinessManage,
          ]
        : [permissions.repeatBusinessView, permissions.repeatBusinessCreate];
    for (const code of grants) {
      await database.permission.upsert({
        where: { code },
        create: { code, description: code },
        update: {},
      });
      await database.rolePermission.upsert({
        where: {
          roleId_permissionCode: { roleId: role.id, permissionCode: code },
        },
        create: { roleId: role.id, permissionCode: code },
        update: {},
      });
    }
    await database.userRole.upsert({
      where: { userId_roleId: { userId: id, roleId: role.id } },
      create: { userId: id, roleId: role.id },
      update: {},
    });
  }
  await database.account.upsert({
    where: { id: ids.account },
    create: {
      id: ids.account,
      canonicalName: "Repeat Business Test Customer",
      normalizedName: "repeat business test customer",
      countryCode: "EG",
      ownerUserId: ids.owner,
      createdByUserId: ids.owner,
      updatedByUserId: ids.owner,
    },
    update: { ownerUserId: ids.owner },
  });
  await database.marketSignal.upsert({
    where: { id: ids.outsideSignal },
    create: {
      id: ids.outsideSignal,
      title: "Outside scope signal",
      sourceName: "Test",
      publishedDate: new Date("2026-09-01"),
      retrievedDate: new Date("2026-09-02"),
      evidence: "Verified outside-scope evidence.",
      evidenceHash: "0".repeat(64),
      verificationCode: "VERIFIED",
      classificationCode: "FACT",
      countryCode: "SA",
      createdByUserId: ids.owner,
    },
    update: {},
  });
}
