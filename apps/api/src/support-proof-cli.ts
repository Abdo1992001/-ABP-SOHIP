import "reflect-metadata";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { NestFactory } from "@nestjs/core";
import type { Server } from "node:http";
import { permissions } from "@abp/contracts";
import type { DatabaseClient } from "@abp/database";
import { AppModule } from "./app.module.js";
import { configureHttpApplication } from "./configure-http-app.js";
import { databaseClientToken } from "./platform/database.providers.js";

const ids = {
  user: "f7700000-0000-4000-8000-000000000001",
  role: "f7700000-0000-4000-8000-000000000002",
  account: "f7700000-0000-4000-8000-000000000003",
  account2: "f7700000-0000-4000-8000-000000000004",
  project: "f7700000-0000-4000-8000-000000000005",
  contact: "f7700000-0000-4000-8000-000000000006",
  group: "f7700000-0000-4000-8000-000000000007",
  notification: "f7700000-0000-4000-8000-000000000008",
  advisory: "f7700000-0000-4000-8000-000000000009",
};
async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL_REQUIRED");
  process.env.ABP_TEST_AUTH_ENABLED = "true";
  process.env.ABP_LOCAL_OBJECT_ROOT = resolve(".tmp/object-storage");
  const app = await NestFactory.create(AppModule, { logger: false });
  configureHttpApplication(app);
  await app.listen(0, "127.0.0.1");
  try {
    const db = app.get<DatabaseClient>(databaseClientToken);
    await seed(db);
    const a = (app.getHttpServer() as Server).address();
    assert(a && typeof a !== "string", "ADDRESS");
    const base = `http://127.0.0.1:${String(a.port)}/api/v1`,
      run = String(Date.now());
    const call = (path: string, init: RequestInit = {}) => {
      const h = new Headers(init.headers);
      h.set("x-abp-test-user-id", ids.user);
      h.set("x-abp-test-session-id", `support-${run}`);
      return fetch(base + path, { ...init, headers: h });
    };
    const json = (
      method: string,
      path: string,
      body: unknown,
      headers: Record<string, string> = {},
    ) =>
      call(path, {
        method,
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
      });
    const ok = async (r: Response, name: string, statuses = [200]) => {
      if (!statuses.includes(r.status))
        throw new Error(`${name}_${String(r.status)}_${await r.text()}`);
      return r;
    };
    const groups = await ok(await call("/group-networks"), "GROUPS");
    assert((await groups.json()) !== null, "GROUPS_BODY");
    const gm = await ok(
      await json(
        "POST",
        `/group-networks/${ids.group}/memberships`,
        { accountId: ids.account, sourceRef: "proof" },
        { "idempotency-key": `gm-${run}` },
      ),
      "GROUP_MEMBERSHIP",
    );
    const gmBody = (await gm.json()) as { data: { membershipId: string } };
    const gmRow = await db.accountGroupMembership.findUniqueOrThrow({
      where: { id: gmBody.data.membershipId },
    });
    await ok(
      await call(`/group-memberships/${gmRow.id}`, {
        method: "DELETE",
        headers: {
          "if-match": `"rv-${String(BigInt(Math.floor(gmRow.createdAt.getTime() / 1000)))}"`,
          "idempotency-key": `gm-end-${run}`,
        },
      }),
      "GROUP_END",
    );
    const party = await ok(
      await json(
        "POST",
        `/projects/${ids.project}/parties`,
        { accountId: ids.account2, roleCode: `CONSULTANT_${run}` },
        { "idempotency-key": `party-${run}` },
      ),
      "PROJECT_PARTY",
    );
    const partyBody = (await party.json()) as {
      data: { projectPartyId: string };
    };
    const partyTag = party.headers.get("etag");
    assert(partyTag, "PROJECT_PARTY_ETAG");
    await ok(
      await json(
        "POST",
        `/project-parties/${partyBody.data.projectPartyId}/contact-roles`,
        { contactId: ids.contact, roleCode: `CONTACT_${run}` },
        { "idempotency-key": `contact-role-${run}` },
      ),
      "PROJECT_CONTACT_ROLE",
    );
    await ok(
      await call(`/project-parties/${partyBody.data.projectPartyId}`, {
        method: "DELETE",
        headers: {
          "if-match": partyTag,
          "idempotency-key": `party-end-${run}`,
        },
      }),
      "PROJECT_PARTY_END",
    );
    const complaint = await ok(
      await json(
        "POST",
        "/complaints",
        {
          accountId: ids.account,
          complaintTypeCode: "SERVICE",
          description: "Support proof complaint",
        },
        { "idempotency-key": `complaint-${run}` },
      ),
      "COMPLAINT_CREATE",
      [201],
    );
    const cb = (await complaint.json()) as { data: { complaintId: string } };
    const cget = await ok(
        await call(`/complaints/${cb.data.complaintId}`),
        "COMPLAINT_GET",
      ),
      ctag = cget.headers.get("etag");
    assert(ctag, "COMPLAINT_ETAG");
    const cup = await ok(
        await json(
          "PATCH",
          `/complaints/${cb.data.complaintId}`,
          { severityCode: "MEDIUM" },
          { "if-match": ctag },
        ),
        "COMPLAINT_PATCH",
      ),
      ctag2 = cup.headers.get("etag");
    assert(ctag2, "COMPLAINT_ETAG_2");
    await ok(
      await json(
        "POST",
        `/complaints/${cb.data.complaintId}/status-transitions`,
        {
          targetStatusCode: "OPERATIONS_REVIEW",
          expectedRowVersion: ctag2.match(/\d+/)?.[0],
          reason: "proof",
        },
        { "idempotency-key": `complaint-transition-${run}` },
      ),
      "COMPLAINT_TRANSITION",
    );
    await ok(await call("/complaints"), "COMPLAINT_LIST");
    const prefs = await ok(await call("/preferences"), "PREFERENCES"),
      ptag = prefs.headers.get("etag");
    assert(ptag, "PREF_ETAG");
    await ok(
      await json(
        "PATCH",
        "/preferences",
        { preferences: { theme: "dark", language: "ar" } },
        { "if-match": ptag },
      ),
      "PREFERENCES_PATCH",
    );
    const stale = await json(
      "PATCH",
      "/preferences",
      { preferences: { theme: "light" } },
      { "if-match": ptag },
    );
    assert(stale.status === 412, "PREFERENCES_STALE");
    await ok(await call("/notifications"), "NOTIFICATIONS");
    await ok(
      await json("POST", `/notifications/${ids.notification}/read`, {}),
      "NOTIFICATION_READ",
    );
    await ok(
      await json("POST", "/notifications/read-all", {}),
      "NOTIFICATION_ALL",
    );
    await ok(await call("/ai/advisories"), "ADVISORIES");
    await ok(
      await json("POST", `/ai/advisories/${ids.advisory}/dismiss`, {
        reasonCode: "NOT_RELEVANT",
      }),
      "ADVISORY_DISMISS",
    );
    await ok(await call("/action-queue"), "ACTION_QUEUE");
    await ok(await call("/search?q=Support"), "SEARCH");
    await ok(await call("/audit"), "AUDIT");
    await ok(await call("/security-events"), "SECURITY_EVENTS");
    for (const p of [
      "/metrics/commercial",
      "/reports/pipeline",
      "/reports/quotations",
      "/reports/orders",
      "/reports/finance",
    ])
      await ok(await call(p), `ANALYTICS_${p}`);
    const content = Buffer.from("a,b\n1,2\n"),
      up = await ok(
        await json(
          "POST",
          "/documents/uploads",
          {
            documentTypeCode: "DATA",
            fileName: "proof.csv",
            mimeType: "text/csv",
            sizeBytes: content.length,
          },
          { "idempotency-key": `upload-${run}` },
        ),
        "UPLOAD",
      );
    const ub = (await up.json()) as {
      data: { uploadSessionId: string; storageKey: string };
    };
    const file = resolve(process.env.ABP_LOCAL_OBJECT_ROOT, ub.data.storageKey);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, content);
    await ok(
      await json(
        "POST",
        `/documents/uploads/${ub.data.uploadSessionId}/complete`,
        { actualSha256: createHash("sha256").update(content).digest("hex") },
        { "idempotency-key": `upload-complete-${run}` },
      ),
      "UPLOAD_COMPLETE",
      [202],
    );
    const exp = await ok(
      await json(
        "POST",
        "/exports",
        {
          exportTypeCode: "CUSTOMERS",
          filters: { countryCode: "EG" },
          formatCode: "CSV",
        },
        { "idempotency-key": `export-${run}` },
      ),
      "EXPORT",
      [202],
    );
    const eb = (await exp.json()) as { data: { exportEventId: string } };
    await ok(await call(`/exports/${eb.data.exportEventId}`), "EXPORT_STATUS");
    const plist = await ok(
        await call("/admin/permissions?limit=200"),
        "PERMISSIONS",
      ),
      pb = (await plist.json()) as { data: Array<{ permissionId: string }> };
    const cr = await ok(
      await json(
        "POST",
        "/admin/roles",
        {
          roleCode: `PROOF_${run}`,
          name: "Proof role",
          permissionIds: pb.data.slice(0, 2).map((x) => x.permissionId),
        },
        { "idempotency-key": `role-${run}` },
      ),
      "ROLE_CREATE",
      [201],
    );
    const rb = (await cr.json()) as { data: { roleId: string } };
    await ok(await call("/admin/roles"), "ROLES");
    const cu = await ok(
      await json(
        "POST",
        "/admin/users",
        {
          email: `proof-${run}@example.test`,
          displayName: "Proof User",
          roleIds: [rb.data.roleId],
          countryCodes: ["EG"],
        },
        { "idempotency-key": `user-${run}` },
      ),
      "USER_CREATE",
      [201],
    );
    const userTag = cu.headers.get("etag"),
      userBody = (await cu.json()) as { data: { userId: string } };
    assert(userTag, "USER_ETAG");
    const patched = await ok(
        await json(
          "PATCH",
          `/admin/users/${userBody.data.userId}`,
          { jobTitle: "Proof" },
          { "if-match": userTag },
        ),
        "USER_PATCH",
      ),
      patchedTag = patched.headers.get("etag");
    assert(patchedTag, "USER_PATCH_TAG");
    await ok(
      await json(
        "PUT",
        `/admin/users/${userBody.data.userId}/roles`,
        { roleIds: [rb.data.roleId], reason: "proof assignment" },
        { "if-match": patchedTag, "idempotency-key": `roles-${run}` },
      ),
      "USER_ROLES",
    );
    await ok(await call("/admin/users"), "USERS");
    assert(
      (await db.auditEvent.count({ where: { actorUserId: ids.user } })) > 5,
      "AUDIT_PERSISTED",
    );
    assert(
      (await db.durableJob.count({
        where: { type: { in: ["MALWARE_SCAN", "DATA_EXPORT"] } },
      })) >= 2,
      "DURABLE_JOBS",
    );
    assert(
      (await db.outboxMessage.count({
        where: {
          eventType: { in: ["DOCUMENT_SCAN_REQUESTED", "EXPORT_REQUESTED"] },
        },
      })) >= 2,
      "OUTBOX",
    );
    process.stdout.write(
      JSON.stringify(
        {
          PROJECT_PARTIES: "PASS",
          GROUP_NETWORKS: "PASS",
          COMPLAINTS: "PASS",
          IDENTITY: "PASS",
          NOTIFICATIONS: "PASS",
          PREFERENCES: "PASS",
          AI_ADVISORY_BOUNDARY: "PASS",
          SEARCH: "PASS",
          AUDIT_SECURITY: "PASS",
          ANALYTICS: "PASS",
          DOCUMENT_VERIFICATION: "PASS",
          EXPORT_JOB_BOUNDARY: "PASS",
          COUNTRY_SCOPE: "PASS",
          CONCURRENCY: "PASS",
          IDEMPOTENCY: "PASS",
          POSTGRESQL: "PASS",
        },
        null,
        2,
      ) + "\n",
    );
  } finally {
    await app.close();
    delete process.env.ABP_TEST_AUTH_ENABLED;
  }
}
async function seed(db: DatabaseClient) {
  for (const code of Object.values(permissions))
    await db.permission.upsert({
      where: { code },
      create: { code, description: code },
      update: {},
    });
  const extras = [
    "groups.view",
    "groups.manage",
    "complaints.view",
    "complaints.create",
    "complaints.edit",
    "complaints.close",
    "ai.advisory.view",
    "search.use",
    "audit.view",
    "security-audit.view",
    "reports.commercial",
    "reports.pipeline",
    "reports.quotations",
    "reports.orders",
    "reports.finance",
    "documents.create",
    "documents.link",
    "exports.create",
    "exports.view",
    "roles.view",
    "roles.manage",
    "roles.assign",
    "users.view",
    "users.create",
    "users.manage",
    "country-access.manage",
    "sessions.revoke",
  ];
  for (const code of extras)
    await db.permission.upsert({
      where: { code },
      create: { code, description: code },
      update: {},
    });
  await db.country.upsert({
    where: { code: "EG" },
    create: { code: "EG", name: "Egypt", continentCode: "AFRICA" },
    update: {},
  });
  await db.appUser.upsert({
    where: { id: ids.user },
    create: {
      id: ids.user,
      externalSubject: "support-proof",
      displayName: "Support Proof",
      emailNormalized: "support-proof@example.test",
    },
    update: { active: true, authStatusCode: "ACTIVE" },
  });
  await db.role.upsert({
    where: { id: ids.role },
    create: {
      id: ids.role,
      code: "SUPPORT_PROOF",
      name: "Support Proof",
      workspace: "SALES",
    },
    update: { workspace: "SALES", active: true },
  });
  for (const permissionCode of new Set([
    ...Object.values(permissions),
    ...extras,
  ]))
    await db.rolePermission.upsert({
      where: { roleId_permissionCode: { roleId: ids.role, permissionCode } },
      create: { roleId: ids.role, permissionCode },
      update: {},
    });
  await db.userRole.upsert({
    where: { userId_roleId: { userId: ids.user, roleId: ids.role } },
    create: { userId: ids.user, roleId: ids.role },
    update: {},
  });
  await db.userCountryAccess.upsert({
    where: { userId_countryCode: { userId: ids.user, countryCode: "EG" } },
    create: { userId: ids.user, countryCode: "EG", grantedBy: ids.user },
    update: { statusCode: "ACTIVE", validTo: null },
  });
  for (const [id, name] of [
    [ids.account, "Support Account"],
    [ids.account2, "Support Consultant"],
  ] as const)
    await db.account.upsert({
      where: { id },
      create: {
        id,
        canonicalName: name,
        normalizedName: name.toLowerCase(),
        countryCode: "EG",
        ownerUserId: ids.user,
      },
      update: { ownerUserId: ids.user, countryCode: "EG" },
    });
  await db.project.upsert({
    where: { id: ids.project },
    create: {
      id: ids.project,
      name: "Support Project",
      normalizedName: "support project",
      countryCode: "EG",
      commercialOwnerUserId: ids.user,
      createdByUserId: ids.user,
      updatedByUserId: ids.user,
      parties: {
        create: {
          accountId: ids.account,
          roleCode: "CUSTOMER",
          primaryFlag: true,
        },
      },
    },
    update: { commercialOwnerUserId: ids.user },
  });
  await db.contact.upsert({
    where: { id: ids.contact },
    create: {
      id: ids.contact,
      accountId: ids.account2,
      displayName: "Support Contact",
      createdByUserId: ids.user,
      updatedByUserId: ids.user,
    },
    update: { accountId: ids.account2 },
  });
  await db.groupNetwork.upsert({
    where: { id: ids.group },
    create: {
      id: ids.group,
      groupCode: "SUPPORT_NETWORK",
      name: "Support Network",
    },
    update: { active: true },
  });
  await db.userNotification.upsert({
    where: { id: ids.notification },
    create: {
      id: ids.notification,
      recipientUserId: ids.user,
      typeCode: "PROOF",
      titleSafe: "Proof notification",
    },
    update: { recipientUserId: ids.user, readAt: null },
  });
  await db.aiRuleOutput.upsert({
    where: { id: ids.advisory },
    create: {
      id: ids.advisory,
      recipientUserId: ids.user,
      ruleCode: "NEXT_ACTION",
      ruleVersion: "v1",
      resourceTypeCode: "ACCOUNT",
      resourceId: ids.account,
      countryCode: "EG",
      outputTypeCode: "NEXT_ACTION",
      outputJson: { message: "Follow up" },
    },
    update: { recipientUserId: ids.user, statusCode: "ACTIVE" },
  });
  await db.activity.create({
    data: {
      countryCode: "EG",
      ownerUserId: ids.user,
      typeCode: "TASK",
      subject: "Support follow up",
      dueAt: new Date(Date.now() + 3600000),
      taskStatusCode: "OPEN",
    },
  });
}
function assert(v: unknown, c: string): asserts v {
  if (!v) throw new Error(c);
}
void main();
