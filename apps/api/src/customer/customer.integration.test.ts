/* eslint-disable @typescript-eslint/consistent-type-imports, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/restrict-template-expressions */
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DatabaseClient } from "@abp/database";
import { permissions } from "@abp/contracts";

const ids = {
  owner: "10000000-0000-4000-8000-000000000001",
  manager: "10000000-0000-4000-8000-000000000002",
  support: "10000000-0000-4000-8000-000000000003",
  logistics: "10000000-0000-4000-8000-000000000004",
  operations: "10000000-0000-4000-8000-000000000005",
  finance: "10000000-0000-4000-8000-000000000006",
  denied: "10000000-0000-4000-8000-000000000007",
  contactRecipient: "10000000-0000-4000-8000-000000000008",
  salesRole: "20000000-0000-4000-8000-000000000001",
  managerRole: "20000000-0000-4000-8000-000000000002",
  supportRole: "20000000-0000-4000-8000-000000000003",
  logisticsRole: "20000000-0000-4000-8000-000000000004",
  operationsRole: "20000000-0000-4000-8000-000000000005",
  financeRole: "20000000-0000-4000-8000-000000000006",
  worca: "30000000-0000-4000-8000-000000000001",
  local: "30000000-0000-4000-8000-000000000002",
  outside: "30000000-0000-4000-8000-000000000003",
  group: "40000000-0000-4000-8000-000000000001",
  membership: "50000000-0000-4000-8000-000000000001",
  share: "60000000-0000-4000-8000-000000000001",
  blockedShare: "60000000-0000-4000-8000-000000000002",
  projectShare: "60000000-0000-4000-8000-000000000003",
} as const;

describe.runIf(process.env.TEST_DATABASE_URL !== undefined)(
  "WS2-A Customer PostgreSQL integration",
  () => {
    let application: INestApplication;
    let applicationInitialized = false;
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
      applicationInitialized = true;
      database = application.get(databaseClientToken);
      await seed(database);
    }, 30_000);

    afterAll(async () => {
      if (applicationInitialized) await application.close();
      delete process.env.ABP_TEST_AUTH_ENABLED;
    });

    it("proves real persistence, scope, projection, concurrency, audit, and workspace isolation", async () => {
      const server = application.getHttpServer();
      const asUser = (userId: string) => ({ "x-abp-test-user-id": userId });

      const unauthenticated = await request(server).get("/api/v1/accounts");
      expect(unauthenticated.status).toBe(401);

      const list = await request(server)
        .get("/api/v1/accounts?archiveState=ACTIVE&limit=25")
        .set(asUser(ids.owner));
      expect(list.status).toBe(200);
      expect(
        list.body.data.map((item: { accountId: string }) => item.accountId),
      ).toEqual(expect.arrayContaining([ids.worca, ids.local]));
      expect(
        list.body.data.map((item: { accountId: string }) => item.accountId),
      ).not.toContain(ids.outside);
      expect(list.body.data[0]).not.toHaveProperty("sourceSystemId");
      expect(list.body.data[0]).not.toHaveProperty("rawName");
      expect(list.body.data[0]).not.toHaveProperty("normalizedName");

      const worca = await request(server)
        .get(`/api/v1/accounts/${ids.worca}`)
        .set(asUser(ids.owner));
      expect(worca.status).toBe(200);
      expect(worca.headers.etag).toBe(worca.body.data.rowVersion);
      expect(worca.body.data.geography).toMatchObject({
        country: { countryCode: "AU" },
        continent: "OCEANIA",
        marketScope: "GLOBAL",
      });
      expect(worca.body.data.effectiveGroupMemberships[0]).toMatchObject({
        groupCode: "ACROW_GLOBAL",
        groupName: "ACROW Global Network",
      });
      expect(worca.body.data).toMatchObject({
        contacts: [],
        opportunities: [],
        quotations: [],
        activities: [],
        erpSyncStatus: {
          statusCode: "NOT_CONFIGURED",
          totalOrders: 0,
          pendingCount: 0,
          syncedCount: 0,
          failedCount: 0,
          latestSyncedAt: null,
        },
      });
      expect(worca.body.data).not.toHaveProperty("sourceRecordKey");

      const managerView = await request(server)
        .get(`/api/v1/accounts/${ids.worca}`)
        .set(asUser(ids.manager));
      expect(managerView.status).toBe(200);

      const supportList = await request(server)
        .get("/api/v1/accounts")
        .set(asUser(ids.support));
      expect(supportList.status).toBe(200);
      expect(
        supportList.body.data.map(
          (item: { accountId: string }) => item.accountId,
        ),
      ).toEqual([ids.local]);
      const blockedShared = await request(server)
        .get(`/api/v1/accounts/${ids.worca}`)
        .set(asUser(ids.support));
      expect(blockedShared.status).toBe(404);

      for (const userId of [ids.logistics, ids.operations, ids.finance]) {
        const denied = await request(server)
          .get("/api/v1/accounts")
          .set(asUser(userId));
        expect(denied.status).toBe(403);
      }
      const explicitDeny = await request(server)
        .get("/api/v1/accounts")
        .set(asUser(ids.denied));
      expect(explicitDeny.status).toBe(403);

      const countries = await request(server)
        .get("/api/v1/reference/countries")
        .set(asUser(ids.owner));
      expect(countries.status).toBe(200);
      expect(countries.body.data).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            countryCode: "EG",
            continent: "AFRICA",
            marketScope: "LOCAL",
          }),
          expect.objectContaining({
            countryCode: "AU",
            continent: "OCEANIA",
            marketScope: "GLOBAL",
          }),
        ]),
      );

      const me = await request(server).get("/api/v1/me").set(asUser(ids.owner));
      expect(me.status).toBe(200);
      expect(me.body.data.access.countryScope).toEqual({
        countryCodes: expect.arrayContaining(["EG", "AU"]),
        enforced: true,
      });

      const outsideCreate = await request(server)
        .post("/api/v1/accounts")
        .set(asUser(ids.owner))
        .set("Idempotency-Key", "outside-create-001")
        .send({ canonicalName: "Outside Scope", countryCode: "AE" });
      expect(outsideCreate.status).toBe(403);

      const created = await request(server)
        .post("/api/v1/accounts")
        .set(asUser(ids.owner))
        .set("Idempotency-Key", "customer-create-001")
        .send({ canonicalName: "  Nile   Construction  ", countryCode: "EG" });
      expect(created.status).toBe(201);
      expect(created.headers.etag).toBe('"rv-1"');
      const accountId = created.body.data.accountId as string;

      const replay = await request(server)
        .post("/api/v1/accounts")
        .set(asUser(ids.owner))
        .set("Idempotency-Key", "customer-create-001")
        .send({ canonicalName: "  Nile   Construction  ", countryCode: "EG" });
      expect(replay.status).toBe(201);
      expect(replay.body.data.accountId).toBe(accountId);

      const raceHeaders = { ...asUser(ids.owner), "If-Match": '"rv-1"' };
      const [first, second] = await Promise.all([
        request(server)
          .patch(`/api/v1/accounts/${accountId}`)
          .set(raceHeaders)
          .send({ canonicalName: "Nile Construction A" }),
        request(server)
          .patch(`/api/v1/accounts/${accountId}`)
          .set(raceHeaders)
          .send({ canonicalName: "Nile Construction B" }),
      ]);
      expect([first.status, second.status].sort()).toEqual([200, 412]);
      const conflict = first.status === 412 ? first : second;
      expect(conflict.body.error.conflict).toMatchObject({
        currentRowVersion: '"rv-2"',
        expectedRowVersion: '"rv-1"',
      });

      const current = first.status === 200 ? first : second;
      const archived = await request(server)
        .post(`/api/v1/accounts/${accountId}/archive`)
        .set(asUser(ids.owner))
        .set("If-Match", current.body.data.rowVersion)
        .set("Idempotency-Key", "customer-archive-001")
        .send({ reason: "Duplicate governed customer" });
      expect(archived.status).toBe(200);
      expect(archived.body.data.recordStatusCode).toBe("ARCHIVED");
      expect(archived.headers.etag).toBe('"rv-3"');

      const active = await request(server)
        .get("/api/v1/accounts?archiveState=ACTIVE")
        .set(asUser(ids.owner));
      expect(
        active.body.data.map((item: { accountId: string }) => item.accountId),
      ).not.toContain(accountId);
      const archiveOnly = await request(server)
        .get("/api/v1/accounts?archiveState=ARCHIVED")
        .set(asUser(ids.owner));
      expect(
        archiveOnly.body.data.map(
          (item: { accountId: string }) => item.accountId,
        ),
      ).toContain(accountId);

      const noDelete = await request(server)
        .delete(`/api/v1/accounts/${accountId}`)
        .set(asUser(ids.owner));
      expect(noDelete.status).toBe(404);

      const audit = await database.auditEvent.findMany({
        where: { resourceType: "ACCOUNT", resourceId: accountId },
        orderBy: { occurredAt: "asc" },
      });
      expect(audit.map(({ actionCode }) => actionCode)).toEqual([
        "ACCOUNT_CREATED",
        "ACCOUNT_UPDATED",
        "ACCOUNT_ARCHIVED",
      ]);
      expect(JSON.stringify(audit)).not.toContain("sourceRecordKey");
    });

    it("proves the WS2-B Contact slice, contact-only sharing, concurrency, and audit", async () => {
      const server = application.getHttpServer();
      const asUser = (userId: string) => ({ "x-abp-test-user-id": userId });

      const created = await request(server)
        .post(`/api/v1/accounts/${ids.worca}/contacts`)
        .set(asUser(ids.owner))
        .set("Idempotency-Key", "contact-create-001")
        .send({
          displayName: "Jane Citizen",
          jobTitle: "Commercial Director",
          channels: [
            {
              channelTypeCode: "EMAIL",
              value: " Jane.Citizen@Example.TEST ",
              isPrimary: true,
            },
          ],
        });
      expect(created.status).toBe(201);
      expect(created.headers.etag).toBe('"rv-1"');
      expect(created.body.data).toMatchObject({
        account: {
          accountId: ids.worca,
          accountRef: "ACC-WORCA",
          canonicalName: "WORCA",
        },
        displayName: "Jane Citizen",
        rowVersion: '"rv-1"',
      });
      expect(created.body.data.channels).toHaveLength(1);

      const withNumber = await request(server)
        .post(`/api/v1/accounts/${ids.worca}/contacts`)
        .set(asUser(ids.owner))
        .set("Idempotency-Key", "contact-create-phone")
        .send({
          displayName: "Number Holder",
          channels: [{ channelTypeCode: "MOBILE", value: "+20 100 000 0000" }],
        });
      expect(withNumber.status).toBe(400);
      expect(JSON.stringify(created.body.data)).not.toContain(
        "normalizedValue",
      );
      const contactId = created.body.data.contactId as string;

      const replay = await request(server)
        .post(`/api/v1/accounts/${ids.worca}/contacts`)
        .set(asUser(ids.owner))
        .set("Idempotency-Key", "contact-create-001")
        .send({
          displayName: "Jane Citizen",
          jobTitle: "Commercial Director",
          channels: [
            {
              channelTypeCode: "EMAIL",
              value: " Jane.Citizen@Example.TEST ",
              isPrimary: true,
            },
          ],
        });
      expect(replay.status).toBe(201);
      expect(replay.body.data.contactId).toBe(contactId);

      const second = await request(server)
        .post(`/api/v1/accounts/${ids.worca}/contacts`)
        .set(asUser(ids.owner))
        .set("Idempotency-Key", "contact-create-002")
        .send({ displayName: "Other Contact" });
      expect(second.status).toBe(201);

      const beforeShare = await request(server)
        .get(`/api/v1/contacts/${contactId}`)
        .set(asUser(ids.contactRecipient));
      expect(beforeShare.status).toBe(404);
      const accountStillPrivate = await request(server)
        .get(`/api/v1/accounts/${ids.worca}`)
        .set(asUser(ids.contactRecipient));
      expect(accountStillPrivate.status).toBe(404);

      const blockedByRecipientCountry = await request(server)
        .post(`/api/v1/accounts/${ids.worca}/contact-shares`)
        .set(asUser(ids.owner))
        .set("Idempotency-Key", "contact-share-country-block")
        .send({
          recipientUserId: ids.support,
          contactIds: [contactId],
          accessLevelCode: "VIEW",
        });
      expect(blockedByRecipientCountry.status).toBe(422);

      const shared = await request(server)
        .post(`/api/v1/accounts/${ids.worca}/contact-shares`)
        .set(asUser(ids.owner))
        .set("Idempotency-Key", "contact-share-001")
        .send({
          recipientUserId: ids.contactRecipient,
          contactIds: [contactId],
          accessLevelCode: "COLLABORATE_EDIT",
        });
      expect(shared.status).toBe(200);
      expect(shared.headers.etag).toBe('"rv-1"');
      expect(shared.body.data).toMatchObject({
        accountId: ids.worca,
        recipientUserId: ids.contactRecipient,
        contactIds: [contactId],
        rowVersion: '"rv-1"',
      });
      const shareId = shared.body.data.contactShareId as string;

      const contactOnly = await request(server)
        .get(`/api/v1/contacts/${contactId}`)
        .set(asUser(ids.contactRecipient));
      expect(contactOnly.status).toBe(200);
      expect(contactOnly.body.data.account).toEqual({
        accountId: ids.worca,
        accountRef: "ACC-WORCA",
        canonicalName: "WORCA",
      });
      expect(contactOnly.body.data.account).not.toHaveProperty("countryCode");
      expect(
        contactOnly.body.data.channels.map(
          (channel: { channelTypeCode: string }) => channel.channelTypeCode,
        ),
      ).toEqual(["EMAIL"]);
      const stillNoCustomer360 = await request(server)
        .get(`/api/v1/accounts/${ids.worca}`)
        .set(asUser(ids.contactRecipient));
      expect(stillNoCustomer360.status).toBe(404);

      const selectedOnly = await request(server)
        .get(`/api/v1/accounts/${ids.worca}/contacts`)
        .set(asUser(ids.contactRecipient));
      expect(selectedOnly.status).toBe(200);
      expect(
        selectedOnly.body.data.map(
          (item: { contactId: string }) => item.contactId,
        ),
      ).toEqual([contactId]);
      expect(selectedOnly.body.data[0]).not.toHaveProperty("channels");
      const parentTamper = await request(server)
        .get(`/api/v1/accounts/${ids.local}/contacts`)
        .set(asUser(ids.contactRecipient));
      expect(parentTamper.status).toBe(200);
      expect(parentTamper.body.data).toEqual([]);

      // The directory across every customer obeys the same contact-only grant.
      const directoryShared = await request(server)
        .get("/api/v1/contacts")
        .set(asUser(ids.contactRecipient));
      expect(directoryShared.status).toBe(200);
      expect(
        directoryShared.body.data.map(
          (item: { contactId: string }) => item.contactId,
        ),
      ).toEqual([contactId]);
      expect(directoryShared.body.data[0]).toMatchObject({
        accountName: "WORCA",
        accountRef: "ACC-WORCA",
        displayName: "Jane Citizen",
      });
      expect(directoryShared.body.data[0].primaryChannel).toEqual({
        channelTypeCode: "EMAIL",
        value: expect.stringContaining("@"),
      });
      const directorySearch = await request(server)
        .get("/api/v1/contacts")
        .query({ search: "citizen" })
        .set(asUser(ids.owner));
      expect(directorySearch.status).toBe(200);
      expect(
        directorySearch.body.data.map(
          (item: { contactId: string }) => item.contactId,
        ),
      ).toEqual([contactId]);

      const raceHeaders = {
        ...asUser(ids.contactRecipient),
        "If-Match": contactOnly.body.data.rowVersion as string,
      };
      const [first, conflicting] = await Promise.all([
        request(server)
          .patch(`/api/v1/contacts/${contactId}`)
          .set(raceHeaders)
          .send({ jobTitle: "Regional Commercial Director" }),
        request(server)
          .patch(`/api/v1/contacts/${contactId}`)
          .set(raceHeaders)
          .send({ jobTitle: "Country Commercial Director" }),
      ]);
      expect([first.status, conflicting.status].sort()).toEqual([200, 412]);
      const updated = first.status === 200 ? first : conflicting;

      const withChannel = await request(server)
        .post(`/api/v1/contacts/${contactId}/channels`)
        .set(asUser(ids.owner))
        .set("Idempotency-Key", "contact-channel-add-001")
        .send({
          channelTypeCode: "EMAIL",
          value: "jane.office@example.test",
          isPrimary: false,
        });
      expect(withChannel.status).toBe(200);
      expect(withChannel.body.data.channels).toHaveLength(2);
      const linkedIn = withChannel.body.data.channels.find(
        (channel: { value: string }) =>
          channel.value === "jane.office@example.test",
      );
      expect(linkedIn).toBeDefined();

      const removed = await request(server)
        .delete(
          `/api/v1/contact-channels/${linkedIn.contactChannelId as string}`,
        )
        .set(asUser(ids.owner))
        .set("If-Match", withChannel.body.data.rowVersion as string)
        .set("Idempotency-Key", "contact-channel-remove-001");
      expect(removed.status).toBe(200);
      expect(removed.body.data.channels).toHaveLength(1);
      expect(removed.body.data.rowVersion).not.toBe(
        updated.body?.data?.rowVersion,
      );

      for (const userId of [ids.logistics, ids.operations, ids.finance]) {
        const denied = await request(server)
          .get(`/api/v1/accounts/${ids.local}/contacts`)
          .set(asUser(userId));
        expect(denied.status).toBe(403);
        const deniedDirectory = await request(server)
          .get("/api/v1/contacts")
          .set(asUser(userId));
        expect(deniedDirectory.status).toBe(403);
      }
      const explicitDeny = await request(server)
        .get(`/api/v1/accounts/${ids.worca}/contacts`)
        .set(asUser(ids.denied));
      expect(explicitDeny.status).toBe(403);

      const revoked = await request(server)
        .delete(`/api/v1/contact-shares/${shareId}`)
        .set(asUser(ids.owner))
        .set("If-Match", shared.body.data.rowVersion as string)
        .set("Idempotency-Key", "contact-share-revoke-001");
      expect(revoked.status).toBe(200);
      expect(revoked.body.data).toMatchObject({
        success: true,
        statusCode: "REVOKED",
      });
      expect(revoked.body).not.toHaveProperty("analyticsMetadata");

      const immediatelyRevoked = await request(server)
        .get(`/api/v1/contacts/${contactId}`)
        .set(asUser(ids.contactRecipient));
      expect(immediatelyRevoked.status).toBe(404);

      const contactAudit = await database.auditEvent.findMany({
        where: {
          OR: [
            { resourceType: "CONTACT", resourceId: contactId },
            { resourceType: "CONTACT_SHARE", resourceId: shareId },
          ],
        },
        orderBy: { occurredAt: "asc" },
      });
      expect(contactAudit.map(({ actionCode }) => actionCode)).toEqual(
        expect.arrayContaining([
          "CONTACT_CREATED",
          "CONTACT_UPDATED",
          "CONTACT_CHANNEL_ADDED",
          "CONTACT_CHANNEL_REMOVED",
          "CONTACT_SHARE_CREATED",
          "CONTACT_SHARE_REVOKED",
        ]),
      );
      expect(JSON.stringify(contactAudit)).not.toContain("normalizedValue");
    });

    it("proves WS2-C Project geography, context, concurrency, archive guards, and audit", async () => {
      const server = application.getHttpServer();
      const asUser = (userId: string) => ({ "x-abp-test-user-id": userId });
      const createBody = {
        name: "Riyadh Metro Commercial Project",
        countryCode: "SA",
        city: "Riyadh",
        region: "Riyadh",
        primaryAccountId: ids.local,
        primaryRoleCode: "CONTRACTOR",
      };
      const created = await request(server)
        .post("/api/v1/projects")
        .set(asUser(ids.owner))
        .set("Idempotency-Key", "project-create-001")
        .send(createBody);
      expect(created.status).toBe(201);
      expect(created.headers.etag).toBe('"rv-1"');
      expect(created.body.data).toMatchObject({
        name: createBody.name,
        geography: {
          country: { countryCode: "SA", displayName: "Saudi Arabia" },
          continent: "ASIA",
          marketScope: "LOCAL",
        },
        rowVersion: '"rv-1"',
        recordStatusCode: "ACTIVE",
      });
      expect(created.body.data).not.toHaveProperty("normalizedName");
      expect(created.body.data.parties).toEqual([
        expect.objectContaining({
          account: expect.objectContaining({ accountId: ids.local }),
          roleCode: "CONTRACTOR",
          primaryFlag: true,
        }),
      ]);
      const projectId = created.body.data.projectId as string;

      const replay = await request(server)
        .post("/api/v1/projects")
        .set(asUser(ids.owner))
        .set("Idempotency-Key", "project-create-001")
        .send(createBody);
      expect(replay.status).toBe(201);
      expect(replay.body.data.projectId).toBe(projectId);

      const customerVisible = await request(server)
        .get(`/api/v1/accounts/${ids.local}`)
        .set(asUser(ids.support));
      expect(customerVisible.status).toBe(200);
      const projectCountryDenied = await request(server)
        .get(`/api/v1/projects/${projectId}`)
        .set(asUser(ids.support));
      expect(projectCountryDenied.status).toBe(404);

      const managerVisible = await request(server)
        .get(`/api/v1/projects/${projectId}`)
        .set(asUser(ids.manager));
      expect(managerVisible.status).toBe(200);
      const sharedContextVisible = await request(server)
        .get(`/api/v1/projects/${projectId}`)
        .set(asUser(ids.contactRecipient));
      expect(sharedContextVisible.status).toBe(200);
      const customerStillCountryDenied = await request(server)
        .get(`/api/v1/accounts/${ids.local}`)
        .set(asUser(ids.contactRecipient));
      expect(customerStillCountryDenied.status).toBe(404);

      const customerProjects = await request(server)
        .get(`/api/v1/projects?accountId=${ids.local}&archiveState=ACTIVE`)
        .set(asUser(ids.owner));
      expect(customerProjects.status).toBe(200);
      expect(
        customerProjects.body.data.map(
          (project: { projectId: string }) => project.projectId,
        ),
      ).toContain(projectId);
      const parentTamper = await request(server)
        .get(`/api/v1/projects?accountId=${ids.worca}&archiveState=ACTIVE`)
        .set(asUser(ids.owner));
      expect(parentTamper.status).toBe(200);
      expect(
        parentTamper.body.data.map(
          (project: { projectId: string }) => project.projectId,
        ),
      ).not.toContain(projectId);

      for (const userId of [ids.logistics, ids.operations, ids.finance]) {
        const isolated = await request(server)
          .get(`/api/v1/projects/${projectId}`)
          .set(asUser(userId));
        expect(isolated.status).toBe(403);
      }
      const explicitDeny = await request(server)
        .get(`/api/v1/projects/${projectId}`)
        .set(asUser(ids.denied));
      expect(explicitDeny.status).toBe(403);

      const raceHeaders = {
        ...asUser(ids.owner),
        "If-Match": created.body.data.rowVersion as string,
      };
      const [first, conflicting] = await Promise.all([
        request(server)
          .patch(`/api/v1/projects/${projectId}`)
          .set(raceHeaders)
          .send({ city: "Riyadh North" }),
        request(server)
          .patch(`/api/v1/projects/${projectId}`)
          .set(raceHeaders)
          .send({ city: "Riyadh South" }),
      ]);
      expect([first.status, conflicting.status].sort()).toEqual([200, 412]);
      const current = await request(server)
        .get(`/api/v1/projects/${projectId}`)
        .set(asUser(ids.owner));
      expect(current.status).toBe(200);
      expect(current.body.data.rowVersion).toBe('"rv-2"');

      const activeWorkId = "91000000-0000-4000-8000-000000000001";
      await database.projectWorkReference.create({
        data: {
          projectId,
          workTypeCode: "OPPORTUNITY",
          workId: activeWorkId,
        },
      });
      const blockedArchive = await request(server)
        .post(`/api/v1/projects/${projectId}/archive`)
        .set(asUser(ids.owner))
        .set("If-Match", current.body.data.rowVersion as string)
        .set("Idempotency-Key", "project-archive-blocked")
        .send({ reason: "Project work completed" });
      expect(blockedArchive.status).toBe(409);
      expect(blockedArchive.body.error.code).toBe("PROJECT_HAS_ACTIVE_WORK");
      await database.projectWorkReference.update({
        where: {
          workTypeCode_workId: {
            workTypeCode: "OPPORTUNITY",
            workId: activeWorkId,
          },
        },
        data: { statusCode: "RELEASED" },
      });
      const archived = await request(server)
        .post(`/api/v1/projects/${projectId}/archive`)
        .set(asUser(ids.owner))
        .set("If-Match", current.body.data.rowVersion as string)
        .set("Idempotency-Key", "project-archive-001")
        .send({ reason: "Project work completed" });
      expect(archived.status).toBe(200);
      expect(archived.headers.etag).toBe('"rv-3"');
      expect(archived.body.data.recordStatusCode).toBe("ARCHIVED");
      expect(await database.project.count({ where: { id: projectId } })).toBe(
        1,
      );

      const audit = await database.auditEvent.findMany({
        where: { resourceType: "PROJECT", resourceId: projectId },
        orderBy: { occurredAt: "asc" },
      });
      expect(audit.map(({ actionCode }) => actionCode)).toEqual(
        expect.arrayContaining([
          "PROJECT_CREATED",
          "PROJECT_UPDATED",
          "PROJECT_ARCHIVED",
        ]),
      );
      expect(JSON.stringify(audit)).not.toContain("normalizedName");
      expect(JSON.stringify(audit)).toContain("Project work completed");
    });

    it("proves WS2-D opportunity pipeline, governed lookups, country scope, concurrency, WON reversal, and audit", async () => {
      const server = application.getHttpServer();
      const asUser = (userId: string) => ({ "x-abp-test-user-id": userId });
      const now = new Date("2026-08-21T00:00:00.000Z");
      await database.opportunityStagePolicy.createMany({
        data: [
          {
            stageCode: "NEW_LEAD",
            defaultProbabilityPct: "10",
            effectiveFrom: now,
          },
          {
            stageCode: "HOT_LEAD",
            defaultProbabilityPct: "50",
            effectiveFrom: now,
          },
          {
            stageCode: "WON",
            defaultProbabilityPct: "100",
            effectiveFrom: now,
          },
          { stageCode: "LOST", defaultProbabilityPct: "0", effectiveFrom: now },
        ],
      });
      await database.opportunityLostReason.create({
        data: {
          lostReasonCode: "TEST_APPROVED",
          displayName: "Approved integration-test reason",
          effectiveFrom: now,
        },
      });

      const createBody = {
        title: "New Cairo tower — column formwork",
        accountId: ids.local,
        noProjectReasonCode: "DISCOVERY_NOT_YET_PROJECT",
        estimatedValue: "125000.00",
        currencyCode: "USD",
        expectedCloseDate: "2026-12-31",
      };
      const created = await request(server)
        .post("/api/v1/opportunities")
        .set(asUser(ids.owner))
        .set("Idempotency-Key", "opportunity-create-001")
        .send(createBody);
      expect(created.status).toBe(201);
      expect(created.headers.etag).toBe('"rv-1"');
      expect(created.body.data).toMatchObject({
        title: "New Cairo tower — column formwork",
        accountId: ids.local,
        countryCode: "EG",
        projectId: null,
        noProjectReasonCode: "DISCOVERY_NOT_YET_PROJECT",
        stageCode: "NEW_LEAD",
        probabilityPct: "10",
        probabilitySourceCode: "STAGE_DEFAULT",
      });
      const opportunityId = created.body.data.opportunityId as string;

      const noReason = await request(server)
        .post("/api/v1/opportunities")
        .set(asUser(ids.owner))
        .set("Idempotency-Key", "opportunity-create-002")
        .send({ title: "Deal with no project reason", accountId: ids.local });
      expect(noReason.status).toBe(422);
      expect(noReason.body.error.code).toBe("NO_PROJECT_REASON_REQUIRED");

      // A deal without a name is the thing the title column exists to stop.
      const noTitle = await request(server)
        .post("/api/v1/opportunities")
        .set(asUser(ids.owner))
        .set("Idempotency-Key", "opportunity-create-003")
        .send({
          accountId: ids.local,
          noProjectReasonCode: "DISCOVERY_NOT_YET_PROJECT",
        });
      // The title is required by the request itself, so a missing one is a
      // malformed request, like any other missing field -- not a business rule.
      expect(noTitle.status).toBe(400);
      expect(noTitle.body.error.code).toBe("VALIDATION_ERROR");

      const policies = await request(server)
        .get("/api/v1/reference/opportunity-stage-policies")
        .set(asUser(ids.owner));
      expect(policies.status).toBe(200);
      expect(policies.body.data).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            stageCode: "NEW_LEAD",
            defaultProbabilityPct: "10",
          }),
        ]),
      );
      const reasons = await request(server)
        .get("/api/v1/reference/opportunity-lost-reasons")
        .set(asUser(ids.owner));
      expect(reasons.status).toBe(200);
      expect(reasons.body.data).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ lostReasonCode: "TEST_APPROVED" }),
        ]),
      );

      const countryDenied = await request(server)
        .get(`/api/v1/opportunities/${opportunityId}`)
        .set(asUser(ids.contactRecipient));
      expect(countryDenied.status).toBe(404);
      for (const userId of [ids.logistics, ids.operations, ids.finance]) {
        const isolated = await request(server)
          .get(`/api/v1/opportunities/${opportunityId}`)
          .set(asUser(userId));
        expect(isolated.status).toBe(403);
      }
      const explicitDeny = await request(server)
        .get(`/api/v1/opportunities/${opportunityId}`)
        .set(asUser(ids.denied));
      expect(explicitDeny.status).toBe(403);

      const overridden = await request(server)
        .post(`/api/v1/opportunities/${opportunityId}/probability-overrides`)
        .set(asUser(ids.owner))
        .set("If-Match", created.body.data.rowVersion as string)
        .set("Idempotency-Key", "opportunity-override-001")
        .send({
          probabilityPct: "60",
          reason: "Qualified scope confirmed",
          sourceMetadata: {
            sourceCode: "SALES_DISCOVERY",
            reference: "DISC-101",
          },
        });
      expect(overridden.status).toBe(200);
      expect(overridden.headers.etag).toBe('"rv-2"');
      expect(overridden.body.data).toMatchObject({
        probabilityPct: "60",
        probabilitySourceCode: "MANUAL_OVERRIDE",
      });

      const [first, conflicting] = await Promise.all([
        request(server)
          .patch(`/api/v1/opportunities/${opportunityId}`)
          .set(asUser(ids.owner))
          .set("If-Match", overridden.body.data.rowVersion as string)
          .send({ expectedCloseDate: "2027-01-31" }),
        request(server)
          .patch(`/api/v1/opportunities/${opportunityId}`)
          .set(asUser(ids.owner))
          .set("If-Match", overridden.body.data.rowVersion as string)
          .send({ expectedCloseDate: "2027-02-28" }),
      ]);
      expect([first.status, conflicting.status].sort()).toEqual([200, 412]);
      const current = first.status === 200 ? first : conflicting;
      const currentTag = current.headers.etag as string;

      const won = await request(server)
        .post(`/api/v1/opportunities/${opportunityId}/stage-transitions`)
        .set(asUser(ids.owner))
        .set("If-Match", currentTag)
        .set("Idempotency-Key", "opportunity-won-001")
        .send({ targetStageCode: "WON" });
      expect(won.status).toBe(200);
      expect(won.body.data).toMatchObject({
        stageCode: "WON",
        probabilityPct: "100",
        wonValueSnapshot: "125000",
      });
      expect(won.body.data.wonSnapshots).toHaveLength(1);

      const reopened = await request(server)
        .post(`/api/v1/opportunities/${opportunityId}/stage-transitions`)
        .set(asUser(ids.owner))
        .set("If-Match", won.headers.etag as string)
        .set("Idempotency-Key", "opportunity-reopen-001")
        .send({ targetStageCode: "HOT_LEAD" });
      expect(reopened.status).toBe(200);
      expect(reopened.body.data.stageCode).toBe("HOT_LEAD");
      expect(reopened.body.data.wonSnapshots).toHaveLength(1);
      expect(reopened.body.data.stageHistory).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ eventCode: "WON_REVERSED" }),
        ]),
      );

      const missingLostReason = await request(server)
        .post(`/api/v1/opportunities/${opportunityId}/stage-transitions`)
        .set(asUser(ids.owner))
        .set("If-Match", reopened.headers.etag as string)
        .set("Idempotency-Key", "opportunity-lost-invalid")
        .send({ targetStageCode: "LOST" });
      expect(missingLostReason.status).toBe(422);
      expect(missingLostReason.body.error.code).toBe(
        "ACTIVE_LOST_REASON_REQUIRED",
      );
      const lost = await request(server)
        .post(`/api/v1/opportunities/${opportunityId}/stage-transitions`)
        .set(asUser(ids.owner))
        .set("If-Match", reopened.headers.etag as string)
        .set("Idempotency-Key", "opportunity-lost-001")
        .send({ targetStageCode: "LOST", lostReasonCode: "TEST_APPROVED" });
      expect(lost.status).toBe(200);
      expect(lost.body.data).toMatchObject({
        stageCode: "LOST",
        lostReasonCode: "TEST_APPROVED",
        probabilityPct: "0",
      });

      const audit = await database.auditEvent.findMany({
        where: { resourceType: "OPPORTUNITY", resourceId: opportunityId },
        orderBy: { occurredAt: "asc" },
      });
      expect(audit.map(({ actionCode }) => actionCode)).toEqual(
        expect.arrayContaining([
          "OPPORTUNITY_CREATED",
          "OPPORTUNITY_PROBABILITY_OVERRIDDEN",
          "OPPORTUNITY_UPDATED",
          "OPPORTUNITY_STAGE_CHANGED",
        ]),
      );
      expect(JSON.stringify(audit)).toContain("Qualified scope confirmed");
    });

    it("proves WS2-E activities: PostgreSQL persistence, country scope, ETag race, audit, and workspace denial", async () => {
      const server = application.getHttpServer();
      const asUser = (userId: string) => ({ "x-abp-test-user-id": userId });
      const createBody = {
        typeCode: "FOLLOW_UP",
        subject: "Confirm commercial scope",
        occurredAt: "2026-08-21T09:00:00.000Z",
        scheduledAt: "2026-08-22T09:00:00.000Z",
        dueAt: "2026-08-22T10:00:00.000Z",
        links: [
          {
            resourceTypeCode: "ACCOUNT",
            resourceId: ids.worca,
            isPrimary: true,
          },
        ],
      };
      const created = await request(server)
        .post("/api/v1/activities")
        .set(asUser(ids.owner))
        .set("Idempotency-Key", "activity-create-001")
        .send(createBody);
      expect(created.status).toBe(201);
      expect(created.headers.etag).toBe('"rv-1"');
      expect(created.body.data).toMatchObject({
        countryCode: "AU",
        occurredAt: createBody.occurredAt,
        scheduledAt: createBody.scheduledAt,
        taskStatusCode: "OPEN",
      });
      const activityId = created.body.data.activityId as string;

      const replay = await request(server)
        .post("/api/v1/activities")
        .set(asUser(ids.owner))
        .set("Idempotency-Key", "activity-create-001")
        .send(createBody);
      expect(replay.status).toBe(201);
      expect(replay.body.data.activityId).toBe(activityId);
      expect(await database.activity.count({ where: { id: activityId } })).toBe(
        1,
      );

      const scopedOut = await request(server)
        .get(`/api/v1/activities/${activityId}`)
        .set(asUser(ids.support));
      expect(scopedOut.status).toBe(404);
      for (const userId of [ids.logistics, ids.operations, ids.finance]) {
        expect(
          (
            await request(server)
              .get(`/api/v1/activities/${activityId}`)
              .set(asUser(userId))
          ).status,
        ).toBe(403);
      }
      const list = await request(server)
        .get("/api/v1/activities?limit=25")
        .set(asUser(ids.owner));
      expect(list.status).toBe(200);
      expect(
        list.body.data.map((x: { activityId: string }) => x.activityId),
      ).toContain(activityId);

      const raceHeaders = {
        ...asUser(ids.owner),
        "If-Match": created.headers.etag as string,
        "Idempotency-Key": "activity-cancel-001",
      };
      const [cancelled, staleUpdate] = await Promise.all([
        request(server)
          .post(`/api/v1/activities/${activityId}/cancel`)
          .set(raceHeaders)
          .send({ reason: "No longer required" }),
        request(server)
          .patch(`/api/v1/activities/${activityId}`)
          .set({
            ...asUser(ids.owner),
            "If-Match": created.headers.etag,
          })
          .send({ subject: "stale" }),
      ]);
      expect([cancelled.status, staleUpdate.status].sort()).toEqual([200, 412]);
      const afterRace = await request(server)
        .get(`/api/v1/activities/${activityId}`)
        .set(asUser(ids.owner));
      const final =
        afterRace.body.data.taskStatusCode === "CANCELLED"
          ? afterRace
          : await request(server)
              .post(`/api/v1/activities/${activityId}/cancel`)
              .set(asUser(ids.owner))
              .set("If-Match", afterRace.headers.etag ?? "")
              .set("Idempotency-Key", "activity-cancel-002")
              .send({ reason: "No longer required" });
      expect(final.status).toBe(200);
      expect(final.body.data.taskStatusCode).toBe("CANCELLED");
      const audit = await database.auditEvent.findMany({
        where: { resourceType: "ACTIVITY", resourceId: activityId },
      });
      expect(audit.map((x) => x.actionCode)).toEqual(
        expect.arrayContaining(["ACTIVITY_CREATED", "ACTIVITY_CANCELLED"]),
      );
    });

    it("governs customer shares with country scope, audit, ETag, race protection, and manager authority", async () => {
      const server = application.getHttpServer();
      const asUser = (userId: string) => ({ "x-abp-test-user-id": userId });
      const created = await request(server)
        .post("/api/v1/accounts")
        .set(asUser(ids.owner))
        .set("Idempotency-Key", "customer-share-account-001")
        .send({ canonicalName: "Share Governance Fixture", countryCode: "EG" });
      expect(created.status).toBe(201);
      const accountId = created.body.data.accountId as string;

      const rejectedRecipient = await request(server)
        .post(`/api/v1/accounts/${accountId}/shares`)
        .set(asUser(ids.owner))
        .set("Idempotency-Key", "customer-share-country-deny")
        .send({
          recipientUserId: ids.contactRecipient,
          shareScopeCode: "CUSTOMER_CONTACTS",
          accessLevelCode: "VIEW",
        });
      expect(rejectedRecipient.status).toBe(422);

      const shared = await request(server)
        .post(`/api/v1/accounts/${accountId}/shares`)
        .set(asUser(ids.owner))
        .set("Idempotency-Key", "customer-share-create-001")
        .send({
          recipientUserId: ids.support,
          shareScopeCode: "CUSTOMER_CONTACTS",
          accessLevelCode: "VIEW",
        });
      expect(shared.status).toBe(200);
      expect(shared.headers.etag).toBe('"rv-1"');
      const shareId = shared.body.data.customerShareId as string;

      const visibleToRecipient = await request(server)
        .get(`/api/v1/accounts/${accountId}`)
        .set(asUser(ids.support));
      expect(visibleToRecipient.status).toBe(200);

      const listedByManager = await request(server)
        .get(`/api/v1/accounts/${accountId}/shares`)
        .set(asUser(ids.manager));
      expect(listedByManager.status).toBe(200);
      expect(listedByManager.body.data).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            customerShareId: shareId,
            rowVersion: '"rv-1"',
          }),
        ]),
      );

      const revokeHeaders = {
        ...asUser(ids.manager),
        "If-Match": shared.body.data.rowVersion as string,
      };
      const [first, second] = await Promise.all([
        request(server)
          .delete(`/api/v1/customer-shares/${shareId}`)
          .set(revokeHeaders)
          .set("Idempotency-Key", "customer-share-revoke-a")
          .send(),
        request(server)
          .delete(`/api/v1/customer-shares/${shareId}`)
          .set(revokeHeaders)
          .set("Idempotency-Key", "customer-share-revoke-b")
          .send(),
      ]);
      expect([first.status, second.status].sort()).toEqual([200, 412]);
      expect((first.status === 200 ? first : second).headers.etag).toBe(
        '"rv-2"',
      );
      const revokedAccess = await request(server)
        .get(`/api/v1/accounts/${accountId}`)
        .set(asUser(ids.support));
      expect(revokedAccess.status).toBe(404);
      const audit = await database.auditEvent.findMany({
        where: { resourceType: "CUSTOMER_SHARE", resourceId: shareId },
      });
      expect(audit.map((entry) => entry.actionCode)).toEqual(
        expect.arrayContaining([
          "CUSTOMER_SHARE_CREATED",
          "CUSTOMER_SHARE_REVOKED",
        ]),
      );
    });

    it("transfers ownership atomically, notifies through outbox, and rejects stale writes", async () => {
      const server = application.getHttpServer();
      const asUser = (userId: string) => ({ "x-abp-test-user-id": userId });
      const created = await request(server)
        .post("/api/v1/accounts")
        .set(asUser(ids.owner))
        .set("Idempotency-Key", "ownership-transfer-account")
        .send({ canonicalName: "Transfer Fixture", countryCode: "EG" });
      expect(created.status).toBe(201);
      const accountId = created.body.data.accountId as string;

      const transferred = await request(server)
        .post(`/api/v1/accounts/${accountId}/transfer-ownership`)
        .set(asUser(ids.owner))
        .set("Idempotency-Key", "ownership-transfer-001")
        .send({
          targetUserId: ids.manager,
          expectedRowVersion: created.body.data.rowVersion,
        });
      expect(transferred.status).toBe(200);
      expect(transferred.headers.etag).toBe('"rv-2"');
      expect(transferred.body.data.ownerUserId).toBe(ids.manager);

      const stale = await request(server)
        .post(`/api/v1/accounts/${accountId}/transfer-ownership`)
        .set(asUser(ids.manager))
        .set("Idempotency-Key", "ownership-transfer-stale")
        .send({ targetUserId: ids.owner, expectedRowVersion: '"rv-1"' });
      expect(stale.status).toBe(412);

      const [audit, outbox] = await Promise.all([
        database.auditEvent.findMany({
          where: { resourceType: "ACCOUNT", resourceId: accountId },
        }),
        database.outboxMessage.findFirst({
          where: {
            eventType: "CUSTOMER_OWNERSHIP_TRANSFERRED",
            aggregateId: accountId,
          },
        }),
      ]);
      expect(audit.map((entry) => entry.actionCode)).toContain(
        "ACCOUNT_OWNERSHIP_TRANSFERRED",
      );
      expect(outbox?.payload).toMatchObject({
        previousOwnerUserId: ids.owner,
        targetUserId: ids.manager,
        notificationOnly: true,
      });
    });

    it("detects duplicates and lets only a Sales Manager execute an atomic merge", async () => {
      const server = application.getHttpServer();
      const asUser = (userId: string) => ({ "x-abp-test-user-id": userId });
      const [master, source] = await Promise.all([
        request(server)
          .post("/api/v1/accounts")
          .set(asUser(ids.owner))
          .set("Idempotency-Key", "merge-master-create")
          .send({ canonicalName: "Merge Master", countryCode: "EG" }),
        request(server)
          .post("/api/v1/accounts")
          .set(asUser(ids.owner))
          .set("Idempotency-Key", "merge-source-create")
          .send({ canonicalName: "Merge Source", countryCode: "EG" }),
      ]);
      expect([master.status, source.status]).toEqual([201, 201]);
      const masterId = master.body.data.accountId as string;
      const sourceId = source.body.data.accountId as string;
      const duplicate = await request(server)
        .post("/api/v1/accounts/duplicate-check")
        .set(asUser(ids.owner))
        .send({ companyName: "Merge Master" });
      expect(duplicate.status).toBe(200);
      expect(duplicate.body.data).toMatchObject({
        potentialDuplicate: true,
        action: "REQUEST_REVIEW",
        accessibleMatches: [expect.objectContaining({ accountId: masterId })],
      });

      const preview = await request(server)
        .post(`/api/v1/accounts/${masterId}/merge-preview`)
        .set(asUser(ids.manager))
        .send({ sourceAccountId: sourceId });
      expect(preview.status).toBe(200);
      expect(preview.body.data.blockingIssues).toEqual([]);

      const ownerDenied = await request(server)
        .post(`/api/v1/accounts/${masterId}/merge`)
        .set(asUser(ids.owner))
        .set("Idempotency-Key", "merge-owner-denied")
        .send({
          sourceAccountId: sourceId,
          masterExpectedRowVersion: master.body.data.rowVersion,
          sourceExpectedRowVersion: source.body.data.rowVersion,
        });
      expect(ownerDenied.status).toBe(403);

      const merged = await request(server)
        .post(`/api/v1/accounts/${masterId}/merge`)
        .set(asUser(ids.manager))
        .set("Idempotency-Key", "merge-manager-001")
        .send({
          sourceAccountId: sourceId,
          masterExpectedRowVersion: master.body.data.rowVersion,
          sourceExpectedRowVersion: source.body.data.rowVersion,
        });
      expect(merged.status).toBe(200);
      expect(merged.headers.etag).toBe('"rv-2"');
      const sourceAfter = await database.account.findUniqueOrThrow({
        where: { id: sourceId },
      });
      expect(sourceAfter.recordStatusCode).toBe("ARCHIVED");
      const audit = await database.auditEvent.findMany({
        where: {
          resourceType: "ACCOUNT",
          resourceId: { in: [masterId, sourceId] },
        },
      });
      expect(audit.map((entry) => entry.actionCode)).toEqual(
        expect.arrayContaining([
          "ACCOUNT_MERGED_IN",
          "ACCOUNT_MERGED_ARCHIVED",
        ]),
      );
    });

    it("rejects a revoked persisted session on the next direct API request", async () => {
      const server = application.getHttpServer();
      const sessionId = "test-step3-revoked-session";
      const before = await request(server).get("/api/v1/accounts").set({
        "x-abp-test-user-id": ids.owner,
        "x-abp-test-session-id": sessionId,
      });
      expect(before.status).toBe(200);
      await database.appSession.update({
        where: { id: sessionId },
        data: { statusCode: "REVOKED", revokedAt: new Date() },
      });
      const after = await request(server).get("/api/v1/accounts").set({
        "x-abp-test-user-id": ids.owner,
        "x-abp-test-session-id": sessionId,
      });
      expect(after.status).toBe(401);
    });
  },
);

async function seed(database: DatabaseClient): Promise<void> {
  await database.$executeRawUnsafe(`TRUNCATE TABLE
    command_idempotency, outbox_messages, activity_reminders, activity_history, activity_links, activities,
    opportunity_won_snapshots, opportunity_probability_overrides,
    opportunity_stage_transitions, opportunities, opportunity_lost_reasons,
    opportunity_stage_policies, contact_share_items, contact_shares, contact_channels,
    contacts, account_group_memberships, group_networks,
    customer_shares, accounts, user_permission_overrides, user_profiles,
    user_roles, role_permissions, permissions, roles, user_country_access,
    audit_events, app_users, countries RESTART IDENTITY CASCADE`);

  await database.country.createMany({
    data: [
      { code: "EG", name: "Egypt", continentCode: "AFRICA" },
      { code: "AU", name: "Australia", continentCode: "OCEANIA" },
      { code: "AE", name: "United Arab Emirates", continentCode: "ASIA" },
      { code: "SA", name: "Saudi Arabia", continentCode: "ASIA" },
    ],
  });

  const permissionCodes = Object.values(permissions);
  await database.permission.createMany({
    data: permissionCodes.map((code) => ({ code, description: code })),
  });
  const roles = [
    {
      id: ids.salesRole,
      code: "SALES_USER",
      name: "Sales User",
      workspace: "SALES",
    },
    {
      id: ids.managerRole,
      code: "SALES_MANAGER",
      name: "Sales Manager",
      workspace: "SALES",
    },
    {
      id: ids.supportRole,
      code: "SALES_SUPPORT",
      name: "Sales Support",
      workspace: "SALES",
    },
    {
      id: ids.logisticsRole,
      code: "LOGISTICS_PLANNER",
      name: "Logistics",
      workspace: "LOGISTICS",
    },
    {
      id: ids.operationsRole,
      code: "OPERATIONS",
      name: "Operations",
      workspace: "OPERATIONS",
    },
    {
      id: ids.financeRole,
      code: "FINANCE",
      name: "Finance",
      workspace: "FINANCE",
    },
  ];
  await database.role.createMany({ data: roles });
  const allAccountPermissions = [
    permissions.salesWorkspaceView,
    permissions.accountsView,
    permissions.accountsCreate,
    permissions.accountsEdit,
    permissions.accountsArchive,
    permissions.accountsShare,
    permissions.accountsTransfer,
    permissions.contactsView,
    permissions.contactsCreate,
    permissions.contactsEdit,
    permissions.contactsShare,
    permissions.projectsView,
    permissions.projectsCreate,
    permissions.projectsEdit,
    permissions.projectsArchive,
    permissions.opportunitiesView,
    permissions.opportunitiesCreate,
    permissions.opportunitiesEdit,
    permissions.opportunitiesProbabilityOverride,
    permissions.activitiesView,
    permissions.activitiesCreate,
    permissions.activitiesEdit,
    permissions.activitiesCancel,
  ];
  await database.rolePermission.createMany({
    data: [
      ...allAccountPermissions.map((permissionCode) => ({
        roleId: ids.salesRole,
        permissionCode,
      })),
      ...[
        permissions.salesWorkspaceView,
        permissions.salesManagementView,
        permissions.accountsView,
        permissions.accountsShare,
        permissions.accountsTransfer,
        permissions.accountsMerge,
        permissions.accountsMergeApprove,
        permissions.contactsView,
        permissions.projectsView,
        permissions.projectsEdit,
        permissions.projectsArchive,
        permissions.opportunitiesView,
        permissions.opportunitiesEdit,
        permissions.opportunitiesProbabilityOverride,
      ].map((permissionCode) => ({ roleId: ids.managerRole, permissionCode })),
      ...[
        permissions.salesWorkspaceView,
        permissions.salesSupportAct,
        permissions.accountsView,
        permissions.accountsCreate,
        permissions.accountsEdit,
        permissions.contactsView,
        permissions.contactsCreate,
        permissions.contactsEdit,
        permissions.projectsView,
        permissions.projectsEdit,
        permissions.opportunitiesView,
        permissions.opportunitiesCreate,
        permissions.opportunitiesEdit,
        permissions.activitiesView,
      ].map((permissionCode) => ({ roleId: ids.supportRole, permissionCode })),
      { roleId: ids.logisticsRole, permissionCode: permissions.logisticsPlan },
      {
        roleId: ids.operationsRole,
        permissionCode: permissions.operationsWorkspaceView,
      },
      { roleId: ids.financeRole, permissionCode: permissions.financeFxView },
    ],
  });

  const users = [
    ids.owner,
    ids.manager,
    ids.support,
    ids.logistics,
    ids.operations,
    ids.finance,
    ids.denied,
    ids.contactRecipient,
  ];
  await database.appUser.createMany({
    data: users.map((id, index) => ({
      id,
      externalSubject: `test-subject-${index}`,
      displayName: `Test User ${index}`,
      emailNormalized: `test${index}@example.test`,
    })),
  });
  await database.userProfile.createMany({
    data: users.map((userId, index) => ({
      userId,
      displayName: `Test User ${index}`,
      ...(userId === ids.owner ? { managerUserId: ids.manager } : {}),
    })),
  });
  await database.userRole.createMany({
    data: [
      { userId: ids.owner, roleId: ids.salesRole },
      { userId: ids.manager, roleId: ids.managerRole },
      { userId: ids.support, roleId: ids.supportRole },
      { userId: ids.logistics, roleId: ids.logisticsRole },
      { userId: ids.operations, roleId: ids.operationsRole },
      { userId: ids.finance, roleId: ids.financeRole },
      { userId: ids.denied, roleId: ids.salesRole },
      { userId: ids.contactRecipient, roleId: ids.supportRole },
    ],
  });
  await database.userCountryAccess.createMany({
    data: [
      ...[ids.owner, ids.manager, ids.denied].flatMap((userId) => [
        { userId, countryCode: "EG", grantedBy: ids.manager },
        { userId, countryCode: "AU", grantedBy: ids.manager },
        { userId, countryCode: "SA", grantedBy: ids.manager },
      ]),
      { userId: ids.support, countryCode: "EG", grantedBy: ids.manager },
      { userId: ids.logistics, countryCode: "EG", grantedBy: ids.manager },
      { userId: ids.operations, countryCode: "EG", grantedBy: ids.manager },
      { userId: ids.finance, countryCode: "EG", grantedBy: ids.manager },
      {
        userId: ids.contactRecipient,
        countryCode: "AU",
        grantedBy: ids.manager,
      },
      {
        userId: ids.contactRecipient,
        countryCode: "SA",
        grantedBy: ids.manager,
      },
    ],
  });
  await database.userPermissionOverride.create({
    data: {
      userId: ids.denied,
      permissionCode: permissions.accountsView,
      effectCode: "DENY",
      reason: "Explicit denial proof",
    },
  });
  await database.userPermissionOverride.create({
    data: {
      userId: ids.denied,
      permissionCode: permissions.projectsView,
      effectCode: "DENY",
      reason: "Explicit project denial proof",
    },
  });
  await database.userPermissionOverride.create({
    data: {
      userId: ids.denied,
      permissionCode: permissions.contactsView,
      effectCode: "DENY",
      reason: "Explicit contact denial proof",
    },
  });
  await database.userPermissionOverride.create({
    data: {
      userId: ids.denied,
      permissionCode: permissions.opportunitiesView,
      effectCode: "DENY",
      reason: "Explicit opportunity denial proof",
    },
  });

  await database.account.createMany({
    data: [
      {
        id: ids.worca,
        accountRef: "ACC-WORCA",
        customerNumber: "773309",
        rawName: "WORCA",
        canonicalName: "WORCA",
        normalizedName: "worca",
        countryCode: "AU",
        ownerUserId: ids.owner,
        createdByUserId: ids.owner,
        updatedByUserId: ids.owner,
        sourceRecordKey: "restricted-source-key",
      },
      {
        id: ids.local,
        accountRef: "ACC-LOCAL",
        canonicalName: "Cairo Customer",
        normalizedName: "cairo customer",
        countryCode: "EG",
        ownerUserId: ids.owner,
        createdByUserId: ids.owner,
        updatedByUserId: ids.owner,
      },
      {
        id: ids.outside,
        accountRef: "ACC-OUTSIDE",
        canonicalName: "Outside Customer",
        normalizedName: "outside customer",
        countryCode: "AE",
        ownerUserId: ids.owner,
        createdByUserId: ids.owner,
        updatedByUserId: ids.owner,
      },
    ],
  });
  await database.groupNetwork.create({
    data: {
      id: ids.group,
      groupCode: "ACROW_GLOBAL",
      name: "ACROW Global Network",
      groupTypeCode: "COMPANY_NETWORK",
    },
  });
  await database.accountGroupMembership.create({
    data: {
      id: ids.membership,
      accountId: ids.worca,
      groupNetworkId: ids.group,
      sourceRef: "governed-worca-fixture",
      createdByUserId: ids.owner,
    },
  });
  await database.customerShare.createMany({
    data: [
      {
        id: ids.share,
        accountId: ids.local,
        ownerUserIdSnapshot: ids.owner,
        recipientUserId: ids.support,
        shareScopeCode: "ACCOUNT",
        accessLevelCode: "COLLABORATE_EDIT",
        createdByUserId: ids.owner,
      },
      {
        id: ids.blockedShare,
        accountId: ids.worca,
        ownerUserIdSnapshot: ids.owner,
        recipientUserId: ids.support,
        shareScopeCode: "ACCOUNT",
        accessLevelCode: "COLLABORATE_EDIT",
        createdByUserId: ids.owner,
      },
      {
        id: ids.projectShare,
        accountId: ids.local,
        ownerUserIdSnapshot: ids.owner,
        recipientUserId: ids.contactRecipient,
        shareScopeCode: "ACCOUNT",
        accessLevelCode: "COLLABORATE_EDIT",
        createdByUserId: ids.owner,
      },
    ],
  });
}
