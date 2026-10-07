/* eslint-disable @typescript-eslint/consistent-type-imports, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { DatabaseClient } from "@abp/database";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const userA = "f2000000-0000-4000-8000-000000000001";
const userB = "f2000000-0000-4000-8000-000000000002";
const userC = "f2000000-0000-4000-8000-000000000003";

describe.runIf(process.env.TEST_DATABASE_URL !== undefined)(
  "local messages PostgreSQL authorization integration",
  () => {
    let application: INestApplication;
    let database: DatabaseClient;

    beforeAll(async () => {
      process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
      process.env.ABP_TEST_AUTH_ENABLED = "true";
      process.env.ABP_LOCAL_OBJECT_ROOT = "storage/test-messages";
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
      for (const [id, name] of [
        [userA, "Message User A"],
        [userB, "Message User B"],
        [userC, "Message User C"],
      ] as const) {
        await database.appUser.upsert({
          where: { id },
          update: { active: true, authStatusCode: "ACTIVE" },
          create: {
            id,
            externalSubject: `message-test:${id}`,
            displayName: name,
            emailNormalized: `${id.slice(-1)}@message.test`,
          },
        });
      }
    }, 120_000);

    afterAll(async () => {
      if (database) {
        await database.conversation.deleteMany({
          where: { createdByUserId: { in: [userA, userB, userC] } },
        });
        await database.appUser.deleteMany({
          where: { id: { in: [userA, userB, userC] } },
        });
      }
      await application?.close();
      delete process.env.ABP_TEST_AUTH_ENABLED;
    });

    it("supports DM, reaction, read state and authorized search", async () => {
      const server = application.getHttpServer();
      const asUser = (id: string) => ({ "x-abp-test-user-id": id });
      const created = await request(server)
        .post("/api/v1/conversations")
        .set(asUser(userA))
        .send({ typeCode: "DM", participantUserIds: [userB] })
        .expect(201);
      const conversationId = created.body.data.conversationId as string;
      const sent = await request(server)
        .post(`/api/v1/conversations/${conversationId}/messages`)
        .set(asUser(userA))
        .send({ body: "Production messages are local." })
        .expect(201);
      const messageId = sent.body.data.messageId as string;
      await request(server)
        .post(`/api/v1/messages/${messageId}/reactions`)
        .set(asUser(userB))
        .send({ emoji: "👍" })
        .expect(200);
      await request(server)
        .post(`/api/v1/conversations/${conversationId}/read`)
        .set(asUser(userB))
        .expect(200);
      const search = await request(server)
        .get("/api/v1/messages/search?q=Production")
        .set(asUser(userB))
        .expect(200);
      expect(
        search.body.data.map((item: { messageId: string }) => item.messageId),
      ).toContain(messageId);
    });

    it("denies conversation, message, reply and attachment IDOR", async () => {
      const server = application.getHttpServer();
      const asUser = (id: string) => ({ "x-abp-test-user-id": id });
      const created = await request(server)
        .post("/api/v1/conversations")
        .set(asUser(userB))
        .send({
          typeCode: "DM",
          participantUserIds: [userC],
          businessContextType: "ACCOUNT",
          businessContextId: "30000000-0000-4000-8000-000000000001",
        })
        .expect(201);
      const conversationId = created.body.data.conversationId as string;
      const attachment = await request(server)
        .post(`/api/v1/conversations/${conversationId}/attachments`)
        .set(asUser(userB))
        .send({
          fileName: "private.txt",
          contentType: "text/plain",
          contentBase64: Buffer.from("private").toString("base64"),
        })
        .expect(201);
      const attachmentId = attachment.body.data.attachmentId as string;
      const sent = await request(server)
        .post(`/api/v1/conversations/${conversationId}/messages`)
        .set(asUser(userB))
        .send({ body: "Conversation B private", attachmentIds: [attachmentId] })
        .expect(201);
      const messageId = sent.body.data.messageId as string;

      await request(server)
        .get(`/api/v1/conversations/${conversationId}`)
        .set(asUser(userA))
        .expect(404);
      await request(server)
        .get(`/api/v1/messages/${messageId}`)
        .set(asUser(userA))
        .expect(404);
      await request(server)
        .post(`/api/v1/conversations/${conversationId}/messages`)
        .set(asUser(userA))
        .send({ body: "Unauthorized reply" })
        .expect(404);
      await request(server)
        .get(`/api/v1/message-attachments/${attachmentId}/download`)
        .set(asUser(userA))
        .expect(404);
      const search = await request(server)
        .get("/api/v1/messages/search?q=Conversation")
        .set(asUser(userA))
        .expect(200);
      expect(search.body.data).toEqual([]);
    });
  },
);
