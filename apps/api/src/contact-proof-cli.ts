import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { Server } from "node:http";
import { createApiClient } from "@abp/api-client";
import { permissions } from "@abp/contracts";
import type { DatabaseClient } from "@abp/database";
import { AppModule } from "./app.module.js";
import { configureHttpApplication } from "./configure-http-app.js";
import { databaseClientToken } from "./platform/database.providers.js";

const proof = {
  ownerUserId: "73000000-0000-4000-8000-000000000001",
  ownerRoleId: "74000000-0000-4000-8000-000000000001",
  recipientUserId: "73000000-0000-4000-8000-000000000002",
  recipientRoleId: "74000000-0000-4000-8000-000000000002",
} as const;

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL_REQUIRED");
  process.env.ABP_TEST_AUTH_ENABLED = "true";
  const application = await NestFactory.create(AppModule, { logger: false });
  configureHttpApplication(application);
  await application.listen(0, "127.0.0.1");
  try {
    const database = application.get<DatabaseClient>(databaseClientToken);
    await seedProofIdentities(database);
    const address = (application.getHttpServer() as Server).address();
    assert(
      address !== null && typeof address !== "string",
      "HTTP_ADDRESS_MISSING",
    );
    const baseUrl = `http://127.0.0.1:${address.port.toString()}/api/v1`;
    const suffix = Date.now().toString();
    const owner = createApiClient({
      baseUrl,
      fetch: proofFetch(proof.ownerUserId, `contact-owner-proof-${suffix}`),
    });
    const recipient = createApiClient({
      baseUrl,
      fetch: proofFetch(
        proof.recipientUserId,
        `contact-recipient-proof-${suffix}`,
      ),
    });

    const account = await owner.POST("/accounts", {
      params: { header: { "Idempotency-Key": `contact-account-${suffix}` } },
      body: {
        canonicalName: `WS2-B Proof Customer ${suffix}`,
        countryCode: "EG",
      },
    });
    assert(
      account.response.status === 201 && account.data !== undefined,
      `ACCOUNT_CREATE_FAILED_${account.response.status.toString()}`,
    );
    const accountId = account.data.data.accountId;

    const selected = await owner.POST("/accounts/{accountId}/contacts", {
      params: {
        path: { accountId },
        header: { "Idempotency-Key": `contact-selected-${suffix}` },
      },
      body: {
        displayName: "WS2-B Selected Contact",
        jobTitle: "Commercial Manager",
        channels: [
          {
            channelTypeCode: "EMAIL",
            value: `selected-${suffix}@example.test`,
            isPrimary: true,
          },
        ],
      },
    });
    assert(
      selected.response.status === 201 && selected.data !== undefined,
      `CONTACT_CREATE_FAILED_${selected.response.status.toString()}`,
    );
    const selectedContact = selected.data.data;
    assert(
      selected.response.headers.get("etag") === selectedContact.rowVersion,
      "CONTACT_CREATE_ETAG_FAILED",
    );
    assert(
      selectedContact.account.accountId === accountId &&
        selectedContact.account.canonicalName.includes("WS2-B Proof Customer"),
      "MINIMAL_ACCOUNT_PROJECTION_FAILED",
    );
    const primaryChannel = selectedContact.channels[0];
    assert(primaryChannel !== undefined, "PRIMARY_CHANNEL_MISSING");
    assert(
      selectedContact.channels.length === 1 &&
        !("normalizedValue" in primaryChannel),
      "RESTRICTED_CHANNEL_VALUE_LEAKED",
    );

    const hidden = await owner.POST("/accounts/{accountId}/contacts", {
      params: {
        path: { accountId },
        header: { "Idempotency-Key": `contact-hidden-${suffix}` },
      },
      body: { displayName: "WS2-B Hidden Contact" },
    });
    assert(hidden.data !== undefined, "SECOND_CONTACT_CREATE_FAILED");

    const updated = await owner.PATCH("/contacts/{contactId}", {
      params: {
        path: { contactId: selectedContact.contactId },
        header: { "If-Match": selectedContact.rowVersion },
      },
      body: { jobTitle: "Senior Commercial Manager" },
    });
    assert(
      updated.response.status === 200 &&
        updated.data?.data.rowVersion === '"rv-2"',
      "CONTACT_UPDATE_FAILED",
    );
    const stale = await owner.PATCH("/contacts/{contactId}", {
      params: {
        path: { contactId: selectedContact.contactId },
        header: { "If-Match": selectedContact.rowVersion },
      },
      body: { jobTitle: "Stale Write" },
    });
    assert(stale.response.status === 412, "CONTACT_STALE_WRITE_NOT_REJECTED");

    const withPhone = await owner.POST("/contacts/{contactId}/channels", {
      params: {
        path: { contactId: selectedContact.contactId },
        header: { "Idempotency-Key": `contact-channel-${suffix}` },
      },
      body: {
        channelTypeCode: "PHONE" as "EMAIL",
        value: "+20 100 000 0000",
        isPrimary: true,
      },
    });
    assert(
      withPhone.response.status === 400,
      "CONTACT_CHANNEL_TYPE_NOT_ENFORCED",
    );

    const share = await owner.POST("/accounts/{accountId}/contact-shares", {
      params: {
        path: { accountId },
        header: { "Idempotency-Key": `contact-share-${suffix}` },
      },
      body: {
        recipientUserId: proof.recipientUserId,
        contactIds: [selectedContact.contactId],
        accessLevelCode: "VIEW",
      },
    });
    assert(
      share.response.status === 200 && share.data !== undefined,
      `CONTACT_SHARE_FAILED_${share.response.status.toString()}`,
    );
    assert(
      share.response.headers.get("etag") === share.data.data.rowVersion,
      "CONTACT_SHARE_ETAG_FAILED",
    );

    const sharedDetail = await recipient.GET("/contacts/{contactId}", {
      params: { path: { contactId: selectedContact.contactId } },
    });
    assert(
      sharedDetail.response.status === 200 &&
        sharedDetail.data?.data.account.accountId === accountId,
      "CONTACT_ONLY_PROJECTION_FAILED",
    );
    const sharedList = await recipient.GET("/accounts/{accountId}/contacts", {
      params: { path: { accountId }, query: { page: 1, limit: 25 } },
    });
    assert(
      sharedList.data?.data.length === 1 &&
        sharedList.data.data[0]?.contactId === selectedContact.contactId,
      "SELECTED_CONTACT_SHARE_BOUNDARY_FAILED",
    );
    const customerDenied = await recipient.GET("/accounts/{accountId}", {
      params: { path: { accountId } },
    });
    assert(
      customerDenied.response.status === 403 ||
        customerDenied.response.status === 404,
      "CONTACT_SHARE_OPENED_CUSTOMER_360",
    );

    const revoked = await owner.DELETE("/contact-shares/{shareId}", {
      params: {
        path: { shareId: share.data.data.contactShareId },
        header: {
          "If-Match": share.data.data.rowVersion,
          "Idempotency-Key": `contact-share-revoke-${suffix}`,
        },
      },
    });
    assert(
      revoked.response.status === 200 &&
        revoked.data?.data.statusCode === "REVOKED",
      "CONTACT_SHARE_REVOKE_FAILED",
    );
    const deniedAfterRevoke = await recipient.GET("/contacts/{contactId}", {
      params: { path: { contactId: selectedContact.contactId } },
    });
    assert(
      deniedAfterRevoke.response.status === 404,
      "CONTACT_SHARE_REVOCATION_NOT_IMMEDIATE",
    );

    const audit = await database.auditEvent.findMany({
      where: {
        OR: [
          { resourceType: "CONTACT", resourceId: selectedContact.contactId },
          {
            resourceType: "CONTACT_SHARE",
            resourceId: share.data.data.contactShareId,
          },
        ],
      },
      select: { actionCode: true, beforeSnapshot: true, afterSnapshot: true },
      orderBy: { occurredAt: "asc" },
    });
    const actions = audit.map(({ actionCode }) => actionCode);
    for (const requiredAction of [
      "CONTACT_CREATED",
      "CONTACT_UPDATED",
      "CONTACT_CHANNEL_ADDED",
      "CONTACT_SHARE_CREATED",
      "CONTACT_SHARE_REVOKED",
    ]) {
      assert(
        actions.includes(requiredAction),
        `AUDIT_${requiredAction}_MISSING`,
      );
    }
    assert(
      !JSON.stringify(audit).includes("normalizedValue"),
      "AUDIT_RESTRICTED_CHANNEL_VALUE_LEAKED",
    );
    process.stdout.write("CONTACT_SLICE_PROOF_PASSED\n");
  } finally {
    await application.close();
    delete process.env.ABP_TEST_AUTH_ENABLED;
  }
}

function proofFetch(
  userId: string,
  sessionId: string,
): typeof globalThis.fetch {
  return async (input, init) => {
    const headers = new Headers(
      input instanceof Request ? input.headers : undefined,
    );
    new Headers(init?.headers).forEach((value, key) => {
      headers.set(key, value);
    });
    headers.set("x-abp-test-user-id", userId);
    headers.set("x-abp-test-session-id", sessionId);
    return fetch(input, { ...init, headers });
  };
}

async function seedProofIdentities(database: DatabaseClient): Promise<void> {
  await database.country.upsert({
    where: { code: "EG" },
    create: { code: "EG", name: "Egypt", continentCode: "AFRICA" },
    update: { name: "Egypt", continentCode: "AFRICA", active: true },
  });
  const ownerPermissions = [
    permissions.salesWorkspaceView,
    permissions.accountsView,
    permissions.accountsCreate,
    permissions.accountsEdit,
    permissions.contactsView,
    permissions.contactsCreate,
    permissions.contactsEdit,
    permissions.contactsShare,
  ];
  const recipientPermissions = [
    permissions.salesWorkspaceView,
    permissions.contactsView,
  ];
  for (const code of [
    ...new Set([...ownerPermissions, ...recipientPermissions]),
  ]) {
    await database.permission.upsert({
      where: { code },
      create: { code, description: code },
      update: {},
    });
  }
  await upsertProofIdentity(database, {
    userId: proof.ownerUserId,
    roleId: proof.ownerRoleId,
    roleCode: "WS2B_PROOF_OWNER",
    displayName: "WS2-B Proof Owner",
    permissions: ownerPermissions,
  });
  await upsertProofIdentity(database, {
    userId: proof.recipientUserId,
    roleId: proof.recipientRoleId,
    roleCode: "WS2B_PROOF_RECIPIENT",
    displayName: "WS2-B Proof Recipient",
    permissions: recipientPermissions,
  });
}

async function upsertProofIdentity(
  database: DatabaseClient,
  input: {
    userId: string;
    roleId: string;
    roleCode: string;
    displayName: string;
    permissions: readonly string[];
  },
): Promise<void> {
  await database.role.upsert({
    where: { id: input.roleId },
    create: {
      id: input.roleId,
      code: input.roleCode,
      name: input.displayName,
      workspace: "SALES",
    },
    update: { active: true, workspace: "SALES" },
  });
  for (const permissionCode of input.permissions) {
    await database.rolePermission.upsert({
      where: {
        roleId_permissionCode: { roleId: input.roleId, permissionCode },
      },
      create: { roleId: input.roleId, permissionCode },
      update: {},
    });
  }
  await database.appUser.upsert({
    where: { id: input.userId },
    create: {
      id: input.userId,
      externalSubject: `${input.roleCode.toLowerCase()}-subject`,
      displayName: input.displayName,
      emailNormalized: `${input.roleCode.toLowerCase()}@example.test`,
    },
    update: { active: true, authStatusCode: "ACTIVE" },
  });
  await database.userProfile.upsert({
    where: { userId: input.userId },
    create: { userId: input.userId, displayName: input.displayName },
    update: { displayName: input.displayName },
  });
  await database.userRole.upsert({
    where: { userId_roleId: { userId: input.userId, roleId: input.roleId } },
    create: { userId: input.userId, roleId: input.roleId },
    update: {},
  });
  await database.userCountryAccess.upsert({
    where: { userId_countryCode: { userId: input.userId, countryCode: "EG" } },
    create: {
      userId: input.userId,
      countryCode: "EG",
      grantedBy: input.userId,
    },
    update: { statusCode: "ACTIVE", validTo: null },
  });
}

function assert(condition: boolean, code: string): asserts condition {
  if (!condition) throw new Error(code);
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exitCode = 1;
});
