import { createHash, randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createPrismaClient } from "../../packages/database/dist/index.js";
import { permissions } from "../../packages/contracts/dist/index.js";
import { hashPassword } from "../../apps/api/src/security/password.service.js";

/**
 * Creates the isolated, repeatable UAT tenant. Passwords are generated at
 * runtime and are intentionally only printed once at the end of the run.
 */
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL_REQUIRED");
const db = createPrismaClient(databaseUrl);
const UAT = "uat";
const ownerId = uuid("00000001", 1);
const now = new Date("2026-09-08T08:00:00.000Z");

type UserSpec = {
  username: string;
  email: string;
  displayName: string;
  role: string;
  workspace: string;
  countries: string[];
  manager?: string;
  mfaRequired?: boolean;
};

const userSpecs: UserSpec[] = [
  {
    username: "uat.admin",
    email: "uat.admin@abp.local",
    displayName: "ABP UAT — System Admin",
    role: "SYSTEM_ADMIN",
    workspace: "ADMIN",
    countries: ["EG", "SA", "AE"],
  },
  {
    username: "uat.sales.manager",
    email: "uat.sales.manager@abp.local",
    displayName: "ABP UAT — Sales Manager",
    role: "SALES_MANAGER",
    workspace: "SALES",
    countries: ["EG", "SA", "AE"],
  },
  {
    username: "uat.sales.user",
    email: "uat.sales.user@abp.local",
    displayName: "ABP UAT — Sales User",
    role: "SALES_USER",
    workspace: "SALES",
    countries: ["EG"],
    manager: "uat.sales.manager",
  },
  {
    username: "uat.sales.user.b",
    email: "uat.sales.user.b@abp.local",
    displayName: "ABP UAT — Sales User B",
    role: "SALES_USER",
    workspace: "SALES",
    countries: ["SA"],
    manager: "uat.sales.manager",
  },
  {
    username: "uat.sales.support",
    email: "uat.sales.support@abp.local",
    displayName: "ABP UAT — Sales Support",
    role: "SALES_SUPPORT",
    workspace: "SALES",
    countries: ["EG", "SA", "AE"],
  },
  {
    username: "uat.logistics",
    email: "uat.logistics@abp.local",
    displayName: "ABP UAT — Logistics",
    role: "LOGISTICS",
    workspace: "LOGISTICS",
    countries: ["EG", "SA", "AE"],
  },
  {
    username: "uat.operations",
    email: "uat.operations@abp.local",
    displayName: "ABP UAT — Operations",
    role: "OPERATIONS",
    workspace: "OPERATIONS",
    countries: ["EG", "SA", "AE"],
  },
  {
    username: "uat.finance",
    email: "uat.finance@abp.local",
    displayName: "ABP UAT — Finance",
    role: "FINANCE",
    workspace: "FINANCE",
    countries: ["EG", "SA", "AE"],
  },
  {
    username: "uat.portal.customer",
    email: "uat.portal.customer@abp.local",
    displayName: "ABP UAT — Customer Portal",
    role: "CUSTOMER_PORTAL_USER",
    workspace: "SALES",
    countries: ["EG"],
    mfaRequired: true,
  },
];

const rolePermissionPatterns: Record<string, (code: string) => boolean> = {
  SYSTEM_ADMIN: () => true,
  SALES_MANAGER: (code) =>
    /^(sales\.|accounts\.|contacts\.|projects\.|opportunities\.|activities\.|catalog\.|quotations\.|quotation\.approve|approvals\.|pricing\.(view|approve|policy\.view)|documents\.|search\.|reports\.(commercial|pipeline|quotations|orders)|targets\.|ai\.advisory\.view|logistics\.(view|plan)|complaints\.|customer-segments\.(view|assign)|market-intelligence\.|target-markets\.|target-accounts\.|competitors\.|watchlist\.|repeat-business\.)/.test(
      code,
    ),
  SALES_USER: (code) =>
    /^(sales\.workspace\.view|accounts\.|contacts\.|projects\.|opportunities\.|activities\.|catalog\.view|quotations\.|approvals\.view|pricing\.view|documents\.view|search\.use|reports\.(commercial|pipeline|quotations)|logistics\.plan|market-intelligence\.view|target-markets\.view|target-accounts\.(view|manage|prepare)|competitors\.view|watchlist\.|repeat-business\.(view|manage))/.test(
      code,
    ),
  SALES_SUPPORT: (code) =>
    /^(sales\.|accounts\.view|contacts\.|projects\.view|documents\.|imports\.|data-quality\.|reconciliation\.|search\.)/.test(
      code,
    ),
  LOGISTICS: (code) =>
    /^(logistics\.|shipments\.|sales-orders\.view|imports\.source\.view|search\.|documents\.view)/.test(
      code,
    ),
  OPERATIONS: (code) =>
    /^(operations\.|capacity\.|catalog\.view|products\.|reports\.|search\.)/.test(
      code,
    ),
  FINANCE: (code) =>
    /^(finance\.|payments\.|cheques\.|returns\.|reports\.finance|search\.|documents\.view)/.test(
      code,
    ),
  CUSTOMER_PORTAL_USER: (code) =>
    /^(repeat-business\.(view|create)|documents\.view)$/.test(code),
};

function uuid(group: string, n: number): string {
  return `${group.padEnd(8, "0")}-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

function temporaryPassword(): string {
  const alphabet =
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*";
  const bytes = randomBytes(24);
  let value = "Aa1!";
  for (const byte of bytes) value += alphabet[byte % alphabet.length];
  return value;
}

async function ensureReferenceData() {
  for (const [code, name, continentCode] of [
    ["EG", "Egypt", "AFRICA"],
    ["SA", "Saudi Arabia", "ASIA"],
    ["AE", "United Arab Emirates", "ASIA"],
  ] as const)
    await db.country.upsert({
      where: { code },
      create: { code, name, continentCode },
      update: { name, continentCode, active: true },
    });
  for (const code of Object.values(permissions))
    await db.permission.upsert({
      where: { code },
      create: { code, description: code },
      update: {},
    });
}

async function ensureUsers(): Promise<{
  users: Map<string, string>;
  passwords: Map<string, string>;
}> {
  const users = new Map<string, string>();
  const passwords = new Map<string, string>();
  const permissionCodes = Object.values(permissions);
  for (const [index, spec] of userSpecs.entries()) {
    const id = uuid("00000001", index + 1);
    const password = temporaryPassword();
    const role = await db.role.upsert({
      where: { code: spec.role },
      create: {
        code: spec.role,
        name: spec.role.replaceAll("_", " "),
        workspace: spec.workspace,
      },
      update: {
        name: spec.role.replaceAll("_", " "),
        workspace: spec.workspace,
        active: true,
      },
    });
    const allowed = permissionCodes.filter(rolePermissionPatterns[spec.role]);
    await db.rolePermission.deleteMany({
      where: {
        roleId: role.id,
        ...(allowed.length > 0 ? { permissionCode: { notIn: allowed } } : {}),
      },
    });
    for (const permissionCode of allowed)
      await db.rolePermission.upsert({
        where: { roleId_permissionCode: { roleId: role.id, permissionCode } },
        create: { roleId: role.id, permissionCode },
        update: {},
      });
    const existing = await db.appUser.findUnique({
      where: { usernameNormalized: spec.username },
    });
    const user = await db.appUser.upsert({
      where: { id },
      create: {
        id,
        externalSubject: `${UAT}:${spec.username}`,
        usernameNormalized: spec.username,
        emailNormalized: spec.email,
        displayName: spec.displayName,
        authProvider: "LOCAL",
        authStatusCode: "ACTIVE",
        active: true,
        passwordHash: await hashPassword(password),
        passwordChangedAt: now,
        mustChangePassword: true,
        mfaRequired: spec.mfaRequired ?? true,
        mfaEnabled: false,
      },
      update: {
        usernameNormalized: spec.username,
        emailNormalized: spec.email,
        displayName: spec.displayName,
        authProvider: "LOCAL",
        authStatusCode: "ACTIVE",
        active: true,
        passwordHash: await hashPassword(password),
        passwordChangedAt: now,
        mustChangePassword: true,
        mfaRequired: spec.mfaRequired ?? true,
        mfaEnabled: false,
        failedLoginCount: 0,
        lockedUntil: null,
        policyVersion: { increment: 1 },
        rowVersion: { increment: 1 },
      },
    });
    await db.userProfile.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        displayName: spec.displayName,
        managerUserId: spec.manager ? users.get(spec.manager) : undefined,
      },
      update: {
        displayName: spec.displayName,
        managerUserId: spec.manager ? users.get(spec.manager) : null,
      },
    });
    await db.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId: role.id } },
      create: { userId: user.id, roleId: role.id },
      update: {},
    });
    for (const countryCode of spec.countries)
      await db.userCountryAccess.upsert({
        where: { userId_countryCode: { userId: user.id, countryCode } },
        create: {
          userId: user.id,
          countryCode,
          grantedBy: ownerId,
          validFrom: now,
        },
        update: {
          statusCode: "ACTIVE",
          validFrom: now,
          validTo: null,
          grantedBy: ownerId,
        },
      });
    await db.userPreference.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        preferences: { language: "en", timezone: "Africa/Cairo" },
      },
      update: { preferences: { language: "en", timezone: "Africa/Cairo" } },
    });
    if (existing)
      await db.appSession.updateMany({
        where: { userId: user.id, statusCode: "ACTIVE" },
        data: { statusCode: "REVOKED", revokedAt: now },
      });
    users.set(spec.username, user.id);
    passwords.set(spec.username, password);
  }
  return { users, passwords };
}

async function ensureFixtures(users: Map<string, string>) {
  const manager = users.get("uat.sales.manager")!;
  const salesUser = users.get("uat.sales.user")!;
  const salesUserB = users.get("uat.sales.user.b")!;
  const support = users.get("uat.sales.support")!;
  const logistics = users.get("uat.logistics")!;
  const finance = users.get("uat.finance")!;
  const accounts = [
    ["A", "UAT Egypt — Sales User Account", "EG", salesUser],
    ["B", "UAT Egypt — Private Manager Account", "EG", manager],
    ["C", "UAT Saudi — Sales User B Account", "SA", salesUserB],
    ["D", "UAT Egypt — Explicitly Shared Account", "EG", manager],
    ["E", "UAT Saudi — Scope Denied Share", "SA", manager],
    ["F", "UAT UAE — Regional Account", "AE", manager],
    ["G", "UAT Egypt — Support Account", "EG", support],
    ["H", "UAT Saudi — Logistics Account", "SA", logistics],
  ] as const;
  const accountIds = new Map<string, string>();
  for (const [code, name, countryCode, ownerUserId] of accounts) {
    const id = uuid("00000002", accounts.findIndex(([x]) => x === code) + 1);
    await db.account.upsert({
      where: { id },
      create: {
        id,
        accountRef: `UAT-ACC-${code}`,
        canonicalName: name,
        normalizedName: name.toLowerCase(),
        rawName: name,
        countryCode,
        hqCountryCode: countryCode,
        accountCategoryCode: "UAT",
        ownerUserId,
        defaultCurrencyCode: countryCode === "EG" ? "EGP" : "USD",
        createdByUserId: ownerId,
        updatedByUserId: ownerId,
        createdAt: now,
      },
      update: {
        canonicalName: name,
        countryCode,
        ownerUserId,
        updatedByUserId: ownerId,
        recordStatusCode: "ACTIVE",
      },
    });
    accountIds.set(code, id);
  }
  await db.customerShare.upsert({
    where: { id: uuid("00000009", 1) },
    create: {
      id: uuid("00000009", 1),
      accountId: accountIds.get("D")!,
      ownerUserIdSnapshot: manager,
      recipientUserId: salesUser,
      shareScopeCode: "ACCOUNT",
      accessLevelCode: "VIEW",
      statusCode: "ACTIVE",
      createdByUserId: manager,
    },
    update: { statusCode: "ACTIVE", recipientUserId: salesUser },
  });
  await db.customerShare.upsert({
    where: { id: uuid("00000009", 4) },
    create: {
      id: uuid("00000009", 4),
      accountId: accountIds.get("B")!,
      ownerUserIdSnapshot: manager,
      recipientUserId: finance,
      shareScopeCode: "ACCOUNT",
      accessLevelCode: "VIEW",
      statusCode: "ACTIVE",
      createdByUserId: manager,
    },
    update: {
      accountId: accountIds.get("B")!,
      statusCode: "ACTIVE",
      recipientUserId: finance,
    },
  });
  const portalUser = users.get("uat.portal.customer")!;
  const portalIdentity = await db.externalClientIdentity.upsert({
    where: { issuer_subject: { issuer: "abp-local", subject: portalUser } },
    create: {
      issuer: "abp-local",
      subject: portalUser,
      displayName: "ABP UAT — Customer Portal",
      emailNormalized: "uat.portal.customer@abp.local",
      provisionedByUserId: ownerId,
    },
    update: { statusCode: "ACTIVE", revokedAt: null },
  });
  await db.clientCustomerBinding.upsert({
    where: { id: uuid("00000009", 3) },
    create: {
      id: uuid("00000009", 3),
      externalClientIdentityId: portalIdentity.id,
      accountId: accountIds.get("A")!,
      createdByUserId: ownerId,
      validFrom: now,
    },
    update: {
      externalClientIdentityId: portalIdentity.id,
      accountId: accountIds.get("A")!,
      statusCode: "ACTIVE",
      validTo: null,
      revokedAt: null,
      revokedByUserId: null,
    },
  });
  await db.customerShare.upsert({
    where: { id: uuid("00000009", 2) },
    create: {
      id: uuid("00000009", 2),
      accountId: accountIds.get("E")!,
      ownerUserIdSnapshot: manager,
      recipientUserId: salesUser,
      shareScopeCode: "ACCOUNT",
      accessLevelCode: "VIEW",
      statusCode: "ACTIVE",
      createdByUserId: manager,
    },
    update: { statusCode: "ACTIVE", recipientUserId: salesUser },
  });
  for (let i = 1; i <= 12; i++) {
    const accountCode = String.fromCharCode(65 + ((i - 1) % 8));
    const id = uuid("00000003", i);
    await db.contact.upsert({
      where: { id },
      create: {
        id,
        accountId: accountIds.get(accountCode)!,
        displayName: `UAT Contact ${String(i).padStart(2, "0")}`,
        jobTitle: i % 2 ? "Procurement Director" : "Project Manager",
        createdByUserId: manager,
        updatedByUserId: manager,
      },
      update: {
        displayName: `UAT Contact ${String(i).padStart(2, "0")}`,
        updatedByUserId: manager,
      },
    });
    await db.contactChannel.upsert({
      where: {
        contactId_channelTypeCode_normalizedValue: {
          contactId: id,
          channelTypeCode: "EMAIL",
          normalizedValue: `uat.contact.${i}@abp.local`,
        },
      },
      create: {
        contactId: id,
        channelTypeCode: "EMAIL",
        value: `uat.contact.${i}@abp.local`,
        normalizedValue: `uat.contact.${i}@abp.local`,
        isPrimary: true,
        createdByUserId: manager,
      },
      update: { value: `uat.contact.${i}@abp.local` },
    });
  }
  const projectIds: string[] = [];
  for (let i = 1; i <= 8; i++) {
    const id = uuid("00000004", i);
    projectIds.push(id);
    const accountCode = String.fromCharCode(64 + i);
    const countryCode = ["EG", "EG", "SA", "EG", "SA", "AE", "EG", "SA"][i - 1];
    await db.project.upsert({
      where: { id },
      create: {
        id,
        name: `UAT Project ${String(i).padStart(2, "0")}`,
        normalizedName: `uat project ${i}`,
        countryCode,
        city: ["Cairo", "Giza", "Riyadh", "Alexandria"][i % 4],
        stageCode: i < 3 ? "ACTIVE" : "PLANNING",
        commercialOwnerUserId: i === 1 ? salesUser : manager,
        createdByUserId: manager,
        updatedByUserId: manager,
      },
      update: {
        name: `UAT Project ${String(i).padStart(2, "0")}`,
        countryCode,
        updatedByUserId: manager,
      },
    });
    await db.projectParty.upsert({
      where: {
        projectId_accountId_roleCode: {
          projectId: id,
          accountId: accountIds.get(accountCode)!,
          roleCode: "MAIN_CONTRACTOR",
        },
      },
      create: {
        projectId: id,
        accountId: accountIds.get(accountCode)!,
        roleCode: "MAIN_CONTRACTOR",
        primaryFlag: true,
      },
      update: {},
    });
  }
  for (const [i, stageCode] of [
    "HOT_LEAD",
    "UNDER_NEGOTIATION",
    "WON",
    "LOST",
    "CANCELLED",
    "HOT_LEAD",
    "UNDER_NEGOTIATION",
    "WON",
    "LOST",
    "UNDER_NEGOTIATION",
  ].entries()) {
    const id = uuid("00000005", i + 1);
    const accountCode = String.fromCharCode(65 + (i % 8));
    const ownerUserId = i === 0 ? salesUser : i === 2 ? salesUserB : manager;
    await db.opportunity.upsert({
      where: { id },
      create: {
        id,
        opportunityRef: `UAT-OPP-${String(i + 1).padStart(3, "0")}`,
        accountId: accountIds.get(accountCode)!,
        projectId: projectIds[i % projectIds.length],
        countryCode: ["EG", "EG", "SA", "EG", "SA", "AE", "EG", "SA"][i % 8],
        ownerUserId,
        stageCode,
        probabilityPct:
          stageCode === "WON"
            ? 100
            : stageCode === "LOST" || stageCode === "CANCELLED"
              ? 0
              : 60,
        estimatedValue: 120000 + i * 17500,
        currencyCode: "USD",
        expectedCloseDate: new Date(
          `2026-10-${String(10 + i).padStart(2, "0")}`,
        ),
        ...(stageCode === "WON"
          ? { wonAt: now, wonValueSnapshot: 120000 + i * 17500 }
          : {}),
        ...(stageCode === "LOST" ? { lostReasonCode: "PRICE" } : {}),
        createdByUserId: manager,
        updatedByUserId: manager,
      },
      update: {
        stageCode,
        ownerUserId,
        estimatedValue: 120000 + i * 17500,
        updatedByUserId: manager,
      },
    });
  }
  const family = await db.productFamily.upsert({
    where: { familyCode: "UAT_BUILDING_PRODUCTS" },
    create: {
      familyCode: "UAT_BUILDING_PRODUCTS",
      name: "UAT Building Products",
    },
    update: { active: true },
  });
  const productIds: string[] = [];
  for (let i = 1; i <= 4; i++) {
    const id = uuid("00000006", i);
    productIds.push(id);
    await db.product.upsert({
      where: { id },
      create: {
        id,
        skuCode: `UAT-SKU-${i}`,
        productFamilyId: family.id,
        productTypeCode: "STANDARD_SKU",
        canonicalDescription: `UAT Board Product ${i}`,
        normalizedDescription: `uat board product ${i}`,
        createdByUserId: manager,
        updatedByUserId: manager,
      },
      update: {
        canonicalDescription: `UAT Board Product ${i}`,
        updatedByUserId: manager,
      },
    });
  }
  for (let i = 1; i <= 6; i++) {
    const id = uuid("00000007", i);
    const accountCode = String.fromCharCode(65 + ((i - 1) % 8));
    const oppId = uuid("00000005", i);
    const supersedesQuotationId = i === 6 ? uuid("00000007", 1) : undefined;
    const statusCode =
      i === 1
        ? "DRAFT"
        : i === 2
          ? "SENT"
          : i === 3
            ? "SENT"
            : i === 4
              ? "SENT"
              : i === 5
                ? "EXPIRED"
                : "SENT";
    const commercialStateCode =
      i === 1
        ? "NOT_SUBMITTED"
        : i === 2
          ? "SUBMITTED"
          : i === 3
            ? "UNDER_NEGOTIATION"
            : i === 5
              ? "NOT_SUBMITTED"
              : "SUBMITTED";
    await db.quotation.upsert({
      where: { id },
      create: {
        id,
        quotationRef: `UAT-QTN-${String(i).padStart(3, "0")}`,
        accountId: accountIds.get(accountCode)!,
        opportunityId: oppId,
        projectId: projectIds[(i - 1) % projectIds.length],
        countryCode: ["EG", "EG", "SA", "EG", "SA", "AE"][i - 1],
        ownerUserId: manager,
        statusCode,
        commercialStateCode,
        currencyCode: "USD",
        validFrom: new Date("2026-09-01"),
        expiresOn: i === 5 ? new Date("2026-09-04") : new Date("2026-10-01"),
        subtotalAmount: 100000 + i * 25000,
        totalAmount: 100000 + i * 25000,
        contentHash: `uat-quotation-${i}`,
        sentAt: statusCode === "SENT" ? now : undefined,
        firstSubmittedAt:
          commercialStateCode !== "NOT_SUBMITTED" ? now : undefined,
        supersedesQuotationId,
        createdByUserId: manager,
        updatedByUserId: manager,
      },
      update: {
        statusCode,
        commercialStateCode,
        supersedesQuotationId,
        updatedByUserId: manager,
      },
    });
    await db.quotationLine.upsert({
      where: { quotationId_lineNo: { quotationId: id, lineNo: 1 } },
      create: {
        quotationId: id,
        lineNo: 1,
        productId: productIds[(i - 1) % productIds.length],
        description: `UAT Board Product ${((i - 1) % productIds.length) + 1}`,
        qty: 100 + i * 10,
        unitCode: "PIECE",
        unitPrice: 1000 + i * 50,
        lineTotal: (100 + i * 10) * (1000 + i * 50),
      },
      update: {},
    });
  }
  await db.quotationApproval.upsert({
    where: { id: uuid("00000023", 1) },
    create: {
      id: uuid("00000023", 1),
      quotationId: uuid("00000007", 4),
      contentHash: "uat-quotation-4",
      statusCode: "PENDING",
      requestedByUserId: salesUser,
      requestedAt: now,
      currentAssigneeUserId: manager,
      requiredAuthorityTier: 1,
      snapshot: { reason: "UAT approval-required quotation" },
    },
    update: {
      statusCode: "PENDING",
      currentAssigneeUserId: manager,
      invalidatedAt: null,
      invalidationReasonCode: null,
    },
  });
  for (let i = 1; i <= 8; i++) {
    const id = uuid("00000008", i);
    const accountCode = String.fromCharCode(64 + ((i - 1) % 8));
    await db.activity.upsert({
      where: { id },
      create: {
        id,
        accountId: accountIds.get(accountCode)!,
        countryCode: ["EG", "EG", "SA", "EG", "SA", "AE", "EG", "SA"][i - 1],
        ownerUserId: i % 3 === 0 ? support : manager,
        typeCode: i % 2 ? "MEETING" : "CALL",
        subject: `UAT activity ${String(i).padStart(2, "0")}`,
        notes: "Deterministic UAT activity",
        occurredAt: now,
        scheduledAt: now,
        dueAt: now,
        taskStatusCode: i < 4 ? "COMPLETED" : "OPEN",
        ...(i < 4 ? { completedAt: now } : {}),
      },
      update: {
        subject: `UAT activity ${String(i).padStart(2, "0")}`,
        taskStatusCode: i < 4 ? "COMPLETED" : "OPEN",
      },
    });
  }
  await db.companyTarget.upsert({
    where: { id: uuid("00000010", 1) },
    create: {
      id: uuid("00000010", 1),
      periodStart: new Date("2026-01-01"),
      periodEnd: new Date("2026-12-31"),
      amountUsd: 5000000,
      effectiveFrom: now,
      targetYear: 2026,
      companyCode: "ACROW",
      baseCurrencyCode: "USD",
      createdByUserId: manager,
    },
    update: { amountUsd: 5000000 },
  });
  await db.fXRate.upsert({
    where: { id: uuid("00000011", 1) },
    create: {
      id: uuid("00000011", 1),
      baseCurrencyCode: "USD",
      quoteCurrencyCode: "EGP",
      rate: "50.000000000000",
      effectiveFrom: now,
      sourceCode: "UAT_REFERENCE",
      changedByUserId: finance,
      reason: "Deterministic UAT FX rate",
    },
    update: { rate: "50.000000000000" },
  });
  const conversationId = uuid("00000012", 1);
  const messageId = uuid("00000013", 1);
  await db.conversation.upsert({
    where: { id: conversationId },
    create: {
      id: conversationId,
      typeCode: "DM",
      title: "UAT Sales Coordination",
      createdByUserId: manager,
    },
    update: { title: "UAT Sales Coordination" },
  });
  await db.conversationParticipant.upsert({
    where: { conversationId_userId: { conversationId, userId: manager } },
    create: { conversationId, userId: manager },
    update: {},
  });
  await db.conversationParticipant.upsert({
    where: { conversationId_userId: { conversationId, userId: salesUser } },
    create: { conversationId, userId: salesUser },
    update: {},
  });
  await db.message.upsert({
    where: { id: messageId },
    create: {
      id: messageId,
      conversationId,
      senderUserId: manager,
      body: "UAT quotation review is ready.",
    },
    update: { body: "UAT quotation review is ready." },
  });
  await db.userNotification.upsert({
    where: { id: uuid("00000014", 1) },
    create: {
      id: uuid("00000014", 1),
      recipientUserId: manager,
      typeCode: "APPROVAL_NEEDED",
      titleSafe: "UAT quotation approval",
      bodySafe: "Quotation UAT-QTN-002 is awaiting review.",
      resourceTypeCode: "QUOTATION",
      resourceId: uuid("00000007", 2),
      actionCode: "OPEN_QUOTATION",
    },
    update: { readAt: null },
  });
  const orderId = uuid("00000015", 1);
  await db.eRPOrder.upsert({
    where: { id: orderId },
    create: {
      id: orderId,
      sourceSystemCode: "ABP_UAT",
      sourceOrderKey: "UAT-SO-001",
      sourceSystemId: uuid("00000016", 1),
      sourceSalesOrderId: orderId,
      importBatchId: uuid("00000017", 1),
      accountId: accountIds.get("A")!,
      projectId: projectIds[0],
      countryCode: "EG",
      currencyCode: "USD",
      statusCode: "BOOKED",
      dqStatusCode: "VALID",
      totalAmount: 250000,
      bookedAmount: 250000,
      importedAt: now,
      integrationStatusCode: "PENDING_SYNC",
    },
    update: { integrationStatusCode: "PENDING_SYNC" },
  });
  await db.payment.upsert({
    where: { id: uuid("00000018", 1) },
    create: {
      id: uuid("00000018", 1),
      sourceSystemCode: "ABP_UAT",
      sourcePaymentKey: "UAT-PAY-001",
      accountId: accountIds.get("A")!,
      erpOrderId: orderId,
      amount: 50000,
      currencyCode: "USD",
      statusCode: "ACTIVE",
      paymentDate: now,
      paymentMethodCode: "BANK_TRANSFER",
      createdByUserId: finance,
    },
    update: { amount: 50000, statusCode: "ACTIVE" },
  });
  await db.cheque.upsert({
    where: { id: uuid("00000019", 1) },
    create: {
      id: uuid("00000019", 1),
      sourceSystemCode: "ABP_UAT",
      sourceChequeKey: "UAT-CHQ-001",
      accountId: accountIds.get("A")!,
      amount: 25000,
      currencyCode: "USD",
      statusCode: "RECEIVED",
      chequeNumber: "UAT-CHQ-001",
      bankName: "UAT Bank",
      issueDate: now,
      dueOn: new Date("2026-10-01"),
      createdByUserId: finance,
    },
    update: { statusCode: "RECEIVED" },
  });
  await db.complaint.upsert({
    where: { id: uuid("00000024", 1) },
    create: {
      id: uuid("00000024", 1),
      accountId: accountIds.get("A")!,
      projectId: projectIds[0],
      countryCode: "EG",
      complaintTypeCode: "DELIVERY",
      statusCode: "OPEN",
      severityCode: "MEDIUM",
      ownerUserId: support,
      description: "UAT portal complaint — delivery milestone clarification",
      createdAt: now,
    },
    update: { statusCode: "OPEN", ownerUserId: support },
  });
  await db.shipment.upsert({
    where: { id: uuid("00000025", 1) },
    create: {
      id: uuid("00000025", 1),
      shipmentRef: "UAT-SHP-0001",
      erpOrderId: orderId,
      countryCode: "EG",
      milestoneCode: "READY_FOR_DELIVERY",
      portOfDischarge: "Alexandria",
      createdByUserId: logistics,
      updatedByUserId: logistics,
      createdAt: now,
    },
    update: {
      milestoneCode: "READY_FOR_DELIVERY",
      updatedByUserId: logistics,
    },
  });
  const logisticsPlanId = uuid("00000029", 1);
  const logisticsVersionId = uuid("00000030", 1);
  const logisticsLineId = uuid("00000031", 1);
  const logisticsUnitId = uuid("00000032", 1);
  await db.logisticsPlan.upsert({
    where: { id: logisticsPlanId },
    create: {
      id: logisticsPlanId,
      sourceTypeCode: "QUOTATION",
      sourceId: uuid("00000007", 1),
      countryCode: "EG",
      planRef: "UAT-LOG-0001",
      selectedVersionId: logisticsVersionId,
      statusCode: "DRAFT",
      createdByUserId: logistics,
      createdAt: now,
    },
    update: {
      selectedVersionId: logisticsVersionId,
      statusCode: "DRAFT",
    },
  });
  await db.logisticsPlanVersion.upsert({
    where: { id: logisticsVersionId },
    create: {
      id: logisticsVersionId,
      logisticsPlanId,
      versionNo: 1,
      statusCode: "DRAFT",
      completenessModeCode: "COMPLETE",
      derivedResultsStatusCode: "CURRENT",
      createdByUserId: logistics,
      createdAt: now,
    },
    update: {
      statusCode: "DRAFT",
      derivedResultsStatusCode: "CURRENT",
    },
  });
  await db.logisticsPlanLine.upsert({
    where: { id: logisticsLineId },
    create: {
      id: logisticsLineId,
      planVersionId: logisticsVersionId,
      productId: productIds[0],
      qty: 100,
      lengthMm: 2440,
      widthMm: 1220,
      thicknessMm: 18,
      weightKg: 37.5,
      orientationCode: "FLAT_ON_FACE",
    },
    update: {
      qty: 100,
      lengthMm: 2440,
      widthMm: 1220,
      thicknessMm: 18,
      weightKg: 37.5,
    },
  });
  await db.logisticsTransportUnit.upsert({
    where: { id: logisticsUnitId },
    create: {
      id: logisticsUnitId,
      planVersionId: logisticsVersionId,
      instanceNo: 1,
      nameSnapshot: "6 m flatbed truck",
      lengthMm: 6000,
      widthMm: 2400,
      heightMm: 2600,
      maxWeightKg: 12000,
      createdAt: now,
    },
    update: {
      nameSnapshot: "6 m flatbed truck",
      lengthMm: 6000,
      widthMm: 2400,
      heightMm: 2600,
      maxWeightKg: 12000,
    },
  });
  for (const [index, x] of [0, 2440].entries()) {
    const placementId = uuid("00000033", index + 1);
    await db.logisticsPlacement.upsert({
      where: { id: placementId },
      create: {
        id: placementId,
        logisticsPlanVersionId: logisticsVersionId,
        demandSourceTypeCode: "PLAN_LINE",
        demandSourceId: logisticsLineId,
        planTransportUnitId: logisticsUnitId,
        planLineId: logisticsLineId,
        x,
        y: 0,
        z: 0,
        length: 2440,
        width: 1220,
        height: 900,
        rotationDeg: 0,
        stackOrder: index + 1,
        stackQty: 50,
      },
      update: {
        x,
        y: 0,
        z: 0,
        length: 2440,
        width: 1220,
        height: 900,
        rotationDeg: 0,
        stackQty: 50,
      },
    });
  }
  const policy = await db.returnedScrapPolicy.upsert({
    where: { policyCode: "UAT_RETURN_25" },
    create: {
      policyCode: "UAT_RETURN_25",
      benefitRate: "0.2500",
      effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
    },
    update: { statusCode: "ACTIVE", effectiveTo: null },
  });
  const policyId = policy.id;
  const originalLine = await db.quotationLine.findFirstOrThrow({
    where: { quotationId: uuid("00000007", 2), lineNo: 1 },
  });
  const returnId = uuid("00000026", 1);
  await db.returnedScrapRequest.upsert({
    where: { id: returnId },
    create: {
      id: returnId,
      caseRef: "UAT-RSC-0001",
      accountId: accountIds.get("B")!,
      originalQuotationId: uuid("00000007", 2),
      countryCode: "EG",
      policyId,
      currencyCodeSnapshot: "USD",
      benefitTypeCode: "CREDIT",
      statusCode: "DRAFT",
      requestedByUserId: manager,
      assessedBaseAmount: 10500,
      benefitValueAmount: 2625,
      assessmentHash: "uat-return-assessment-v1",
    },
    update: { statusCode: "DRAFT", requestedByUserId: manager },
  });
  await db.returnedScrapItem.upsert({
    where: { id: uuid("00000027", 1) },
    create: {
      id: uuid("00000027", 1),
      returnedScrapRequestId: returnId,
      originalQuotationLineId: originalLine.id,
      productId: originalLine.productId,
      eligibleReturnedQty: 10,
      returnedQty: 10,
      originalPurchaseUnitPrice: 1050,
      benefitRate: "0.2500",
      benefitAmount: 2625,
      benefitTypeCode: "CREDIT",
      unitCode: originalLine.unitCode,
      eligibleBaseAmount: 10500,
    },
    update: { returnedQty: 10, benefitAmount: 2625 },
  });
  const objectRoot = resolve(
    process.env.ABP_LOCAL_OBJECT_ROOT ?? ".tmp/object-storage",
  );
  const documentDirectory = join(objectRoot, "uat");
  const documentBody = Buffer.from(
    "ABP UAT customer account summary for UAT-ACC-A.\n",
    "utf8",
  );
  await mkdir(documentDirectory, { recursive: true });
  await writeFile(
    join(documentDirectory, "account-a-summary.txt"),
    documentBody,
  );
  await db.documentMetadata.upsert({
    where: { id: uuid("00000028", 1) },
    create: {
      id: uuid("00000028", 1),
      resourceTypeCode: "ACCOUNT",
      resourceId: accountIds.get("A")!,
      storageKey: "uat/account-a-summary.txt",
      mimeType: "text/plain",
      sizeBytes: BigInt(documentBody.length),
      fileHash: createHash("sha256").update(documentBody).digest("hex"),
      classificationCode: "INTERNAL",
      documentTypeCode: "ACCOUNT_SUMMARY",
      title: "UAT Account A Summary",
      createdByUserId: support,
      createdAt: now,
    },
    update: {
      sizeBytes: BigInt(documentBody.length),
      fileHash: createHash("sha256").update(documentBody).digest("hex"),
      statusCode: "AVAILABLE",
    },
  });
  await db.importBatch.upsert({
    where: { id: uuid("00000017", 1) },
    create: {
      id: uuid("00000017", 1),
      sourceSystemCode: "ABP_UAT",
      sourceSystemId: uuid("00000016", 1),
      importTypeCode: "CUSTOMERS",
      sourceFingerprint: "abp-uat-import-v1",
      statusCode: "COMMITTED",
      actorUserId: support,
      committedAt: now,
    },
    update: { statusCode: "COMMITTED" },
  });
  await db.dQIssue.upsert({
    where: { id: uuid("00000020", 1) },
    create: {
      id: uuid("00000020", 1),
      importBatchId: uuid("00000017", 1),
      sourceEntityCode: "CUSTOMER",
      sourceRecordKey: "UAT-ACC-E",
      ruleCode: "COUNTRY_SCOPE_REVIEW",
      severityCode: "WARNING",
      message: "UAT deliberate data-quality review item",
      statusCode: "OPEN",
      resourceTypeCode: "ACCOUNT",
      resourceId: accountIds.get("E")!,
    },
    update: { statusCode: "OPEN" },
  });
  const reconciliationRunId = uuid("00000021", 1);
  await db.reconciliationRun.upsert({
    where: { id: reconciliationRunId },
    create: {
      id: reconciliationRunId,
      importBatchId: uuid("00000017", 1),
      reconciliationTypeCode: "UAT_CUSTOMER_RECONCILIATION",
      statusCode: "COMPLETED",
      summary: { matched: 7, review: 1 },
      createdByUserId: support,
      completedAt: now,
    },
    update: { statusCode: "COMPLETED" },
  });
  await db.reconciliationIssue.upsert({
    where: { id: uuid("00000022", 1) },
    create: {
      id: uuid("00000022", 1),
      runId: reconciliationRunId,
      issueCode: "UAT_SCOPE_REVIEW",
      severityCode: "WARNING",
      sourceKey: "UAT-ACC-E",
      resourceTypeCode: "ACCOUNT",
      resourceId: accountIds.get("E")!,
      details: { message: "Country scope wins over share" },
    },
    update: { statusCode: "OPEN" },
  });

  const watchResources = [
    await db.marketSignal.findFirst({
      where: { countryCode: "EG", statusCode: "ACTIVE" },
      orderBy: { publishedDate: "desc" },
    }),
    await db.targetAccount.findFirst({
      where: { countryCode: "EG", statusCode: "PROSPECT" },
      orderBy: { createdAt: "desc" },
    }),
  ].filter(
    (resource): resource is NonNullable<typeof resource> => resource !== null,
  );
  for (const actorUserId of [ownerId, manager]) {
    for (const resource of watchResources) {
      const resourceType =
        "title" in resource ? "MARKET_SIGNAL" : "TARGET_ACCOUNT";
      const label = "title" in resource ? resource.title : resource.companyName;
      await db.watchlistEntry.upsert({
        where: {
          createdByUserId_resourceType_resourceId: {
            createdByUserId: actorUserId,
            resourceType,
            resourceId: resource.id,
          },
        },
        create: {
          createdByUserId: actorUserId,
          resourceType,
          resourceId: resource.id,
          label,
          notes: "UAT commercial follow-up item",
        },
        update: {
          label,
          notes: "UAT commercial follow-up item",
          statusCode: "ACTIVE",
        },
      });
    }
  }
}

async function main() {
  await ensureReferenceData();
  const { users, passwords } = await ensureUsers();
  await ensureFixtures(users);
  if (process.env.ABP_UAT_OUTPUT === "none") {
    process.stdout.write(
      `UAT fixtures ready: users=${users.size}; customers=8; contacts=12; projects=8; opportunities=10; quotations=6; activities=8\n`,
    );
    return;
  }
  if (process.env.ABP_UAT_OUTPUT === "json") {
    process.stdout.write(
      JSON.stringify(
        userSpecs.map((spec) => ({
          username: spec.username,
          password: passwords.get(spec.username),
          userId: users.get(spec.username),
        })),
      ),
    );
    return;
  }
  process.stdout.write(
    "ABP UAT LOGIN PACK\n\nUAT Application:\nhttps://abp-commercial.local\n\n",
  );
  for (const spec of userSpecs)
    process.stdout.write(
      `${spec.displayName.replace("ABP UAT — ", "")}\n${spec.username}\nTemporary Password:\n${passwords.get(spec.username)}\n\n`,
    );
  process.stdout.write(
    `UAT users=${users.size}; customers=8; contacts=12; projects=8; opportunities=10; quotations=6; activities=8\n`,
  );
}

try {
  await main();
} finally {
  await db.$disconnect();
}
