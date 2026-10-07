// Idempotent LOCAL demonstration data. Existing business rows are never overwritten.
import { createPrismaClient } from "../dist/index.js";
import { permissions } from "../../contracts/dist/index.js";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL_REQUIRED");
if (
  process.env.NODE_ENV === "production" &&
  process.env.ABP_ALLOW_DEMO_SEED !== "true"
)
  throw new Error("DEMO_SEED_DISABLED_IN_PRODUCTION");
if (process.env.ABP_ALLOW_DEMO_SEED !== "true")
  throw new Error("DEMO_SEED_REQUIRES_ABP_ALLOW_DEMO_SEED_TRUE");
const db = createPrismaClient(url);
const id = (group, number) =>
  `${group.padEnd(8, "0")}-0000-4000-8000-${String(number).padStart(12, "0")}`;
let owner = "10000000-0000-4000-8000-000000000002";
const created = { createdByUserId: owner, updatedByUserId: owner };
const customers = [
  ["001", "شركة المقاولون العرب", "Arab Contractors", "STRATEGIC", "EG"],
  ["002", "أوراسكوم للإنشاءات", "Orascom Construction", "STRATEGIC", "EG"],
  ["003", "حسن علام القابضة", "Hassan Allam Holding", "ENTERPRISE", "EG"],
  ["004", "رشيد للمقاولات", "Rashid Contracting", "ENTERPRISE", "EG"],
  ["005", "شركة سيناء للإنشاء", "Sinai Construction Co.", "ENTERPRISE", "EG"],
  [
    "006",
    "مجموعة النصر للتطوير",
    "Al-Nasr Development Group",
    "MID_MARKET",
    "EG",
  ],
  ["007", "شركة الوادي للمقاولات", "Al-Wadi Contracting", "MID_MARKET", "EG"],
  ["008", "شركة هيلتون للإنشاء", "Hilton Construction Co.", "MID_MARKET", "SA"],
  ["009", "مؤسسة البناء الحديث", "Modern Building Est.", "MID_MARKET", "EG"],
  ["010", "شركة الخليج للإنشاء", "Gulf Construction Co.", "MID_MARKET", "AE"],
  ["011", "مصر لمستلزمات البناء", "Misr Building Supplies", "MID_MARKET", "EG"],
  ["012", "شركة النيل للمقاولات", "Nile Contracting Co.", "SMB", "EG"],
  ["013", "مؤسسة الفاروق للبناء", "Al-Farouk Building Est.", "SMB", "EG"],
  ["014", "شركة الأهرام للمشاريع", "Al-Ahram Projects Co.", "SMB", "EG"],
  ["015", "رمضان للمقاولات والتشييد", "Ramadan Contracting", "SMB", "EG"],
  ["016", "شركة الدلتا للإنشاء", "Delta Construction Co.", "MID_MARKET", "EG"],
  [
    "017",
    "مجموعة الصحراء للتطوير",
    "Al-Sahraa Development",
    "ENTERPRISE",
    "SA",
  ],
  [
    "018",
    "شركة البحر الأحمر للمقاولات",
    "Red Sea Contracting Co.",
    "MID_MARKET",
    "EG",
  ],
  ["019", "مؤسسة سيناء للمشاريع", "Sinai Projects Est.", "SMB", "EG"],
  [
    "020",
    "شركة النور للإنشاء والتعمير",
    "Al-Nour Construction Co.",
    "SMB",
    "EG",
  ],
];
const products = [
  ["ACROW-BOARD-18", "ACROW Board 18mm", "Sheet", "520"],
  ["ACROW-BOARD-21", "ACROW Board 21mm", "Sheet", "590"],
  ["ACROW-BOARD-24", "ACROW Board 24mm", "Sheet", "675"],
  ["ACROW-CURVED-18", "ACROW Curved Board 18mm", "Sheet", "780"],
  ["ACROW-PROP-2.4M", "ACROW Adjustable Prop 2.4m", "Piece", "220"],
  ["ACROW-PROP-3.6M", "ACROW Adjustable Prop 3.6m", "Piece", "310"],
  ["ACROW-PROP-4.8M", "ACROW Heavy Duty Prop 4.8m", "Piece", "390"],
  ["ACROW-WELD-220", "ACROW Board Welding Machine 220V", "Unit", "4200"],
  ["ACROW-JACK-ADJ", "ACROW Adjustable Screw Jack", "Piece", "85"],
  ["ACROW-BEAM-300", "ACROW Telescopic Beam 3m", "Piece", "145"],
  ["ACROW-PLY-18", "ACROW Formwork Plywood 18mm", "Sheet", "520"],
  ["ACROW-TIE-ROD", "ACROW Tie Rod & Wing Nut Set", "Set", "125"],
  ["ACROW-ACCESSORY-KIT", "ACROW Formwork Accessory Kit", "Kit", "350"],
];
const names = [
  ["Ahmed Hassan", "ahmed@abp.com", "SYSTEM_ADMIN"],
  ["Mohamed Ramadan", "m.ramadan@abp.com", "SALES_MANAGER"],
  ["Sara Ibrahim", "s.ibrahim@abp.com", "SALES_REP"],
  ["Khaled Mahmoud", "k.mahmoud@abp.com", "SALES_REP"],
  ["Dina Youssef", "d.youssef@abp.com", "SALES_REP"],
  ["Omar Salah", "o.salah@abp.com", "LOGISTICS_COORDINATOR"],
  ["Nadia Farouk", "n.farouk@abp.com", "FINANCE_ANALYST"],
  ["Tarek Abdullah", "t.abdullah@abp.com", "OPERATIONS_ANALYST"],
];
const date = (index) =>
  new Date(Date.UTC(2025, 8 + (index % 12), 5 + (index % 22), 10));
async function main() {
  // Demo data is only demo data if the account people actually sign in with
  // can see it. Whoever signs in locally owns the notifications, the
  // opportunities and the quotations; otherwise the seed fills the database
  // and the app still looks empty, which is worse than not seeding at all.
  owner =
    (
      await db.appUser.findFirst({
        where: { authProvider: "LOCAL", authStatusCode: "ACTIVE" },
        orderBy: { createdAt: "asc" },
        select: { id: true },
      })
    )?.id ??
    (
      await db.appUser.findFirst({
        where: { usernameNormalized: "abdelrahman" },
        select: { id: true },
      })
    )?.id ??
    owner;
  for (const [code, name, continentCode] of [
    ["EG", "Egypt", "AFRICA"],
    ["SA", "Saudi Arabia", "ASIA"],
    ["AE", "United Arab Emirates", "ASIA"],
  ])
    await db.country.upsert({
      where: { code },
      create: { code, name, continentCode },
      update: {},
    });
  /**
   * What a sales manager may do.
   *
   * This used to be a blacklist — everything except `admin.` and `security.` —
   * which gave the role all 134 permissions the system administrator has, down
   * to `users.create` and `roles.manage`, because user administration is spelled
   * `users.` and slipped straight through the filter. A blacklist gets this
   * wrong again every time a permission family is added, so the rule is now
   * stated the other way round: nothing is granted unless it is named here.
   *
   * The line is ownership, not seniority. A sales manager runs the commercial
   * book — customers, pipeline, quotations, approvals, the team's targets — and
   * can read across into finance, logistics and operations to answer for a deal.
   * They do not administer the system, set company pricing policy, or act inside
   * another function: no creating users or roles, no editing the pricing basis,
   * no recording a payment, no committing an import.
   */
  const SALES_MANAGER_FAMILIES = [
    "accounts",
    "activities",
    "competitors",
    "contacts",
    "customer-segments",
    "complaints",
    "market-intelligence",
    "opportunities",
    "projects",
    "quotation",
    "quotations",
    "repeat-business",
    "reports",
    "returns",
    "sales",
    "search",
    "target-accounts",
    "target-markets",
    "targets",
    "watchlist",
  ];

  /** Named individually because their family also contains privileged codes. */
  const SALES_MANAGER_EXTRA = new Set([
    "approvals.view",
    "approvals.decide",
    // Approving a discount and overriding the floor are the manager's decision;
    // setting the floor itself is pricing policy and stays with finance/admin.
    "pricing.view",
    "pricing.approve",
    "pricing.override_min",
    "documents.view",
    "documents.create",
    "documents.link",
    "audit.view",
    "exports.view",
    "exports.create",
    "data.export",
    "ai.advisory.view",
    "research.view",
    // Freight shapes the quoted price, so the planner is a commercial tool;
    // creating and dispatching the real shipment is not.
    "logistics.view",
    "logistics.plan",
    "logistics.optimize",
    "logistics.validate",
    // Read-only windows into other functions, so a manager can answer for a
    // deal without acting inside someone else's ledger.
    "payments.view",
    "cheques.view",
    "finance.fx.view",
    "sales-orders.view",
    "shipments.view",
    "capacity.view",
    "capacity.estimate",
    "catalog.view",
    "imports.view",
    "data-quality.view",
    "item-resolver.use",
    "reconciliation.view",
    "operations.workspace.view",
  ]);

  const salesManagerMay = (code: string) =>
    SALES_MANAGER_FAMILIES.includes(code.split(".")[0] ?? "") ||
    SALES_MANAGER_EXTRA.has(code);

  for (const code of Object.values(permissions))
    await db.permission.upsert({
      where: { code },
      create: { code, description: code },
      update: {},
    });
  for (const [
    index,
    [displayName, emailNormalized, roleCode],
  ] of names.entries()) {
    const userId = id("1", index + 1);
    await db.appUser.upsert({
      where: { id: userId },
      create: {
        id: userId,
        externalSubject: `abp-demo-${index}`,
        displayName,
        emailNormalized,
      },
      update: {},
    });
    await db.userProfile.upsert({
      where: { userId },
      create: {
        userId,
        displayName,
        ...(index > 1 && index < 5 ? { managerUserId: owner } : {}),
      },
      update: {},
    });
    const role = await db.role.upsert({
      where: { code: roleCode },
      create: {
        code: roleCode,
        name: roleCode.replaceAll("_", " "),
        workspace: roleCode.includes("LOGISTICS")
          ? "LOGISTICS"
          : roleCode.includes("FINANCE")
            ? "FINANCE"
            : "SALES",
      },
      update: {},
    });
    const allowed = Object.values(permissions).filter(
      (code) =>
        roleCode === "SYSTEM_ADMIN" ||
        (roleCode === "SALES_MANAGER" && salesManagerMay(code)) ||
        // A sales rep opens the Sales overview every morning. Without
        // reports.orders, reports.commercial and targets.view the page loads
        // but its KPI cards, its target progress and the whole commercial
        // history section are hidden — they saw an empty dashboard and
        // reasonably read it as broken. These are read-only reporting scopes
        // over their own country grants, so widening them changes what a rep
        // can see about their own book, not what they can do to it.
        (roleCode === "SALES_REP" &&
          /^(sales.workspace|accounts|contacts|projects|opportunities|activities|quotations|products|search|ai.advisory|market-intelligence|target-markets|target-accounts|competitors|watchlist|repeat-business|reports|targets)/.test(
            code,
          )) ||
        (roleCode.includes("LOGISTICS") &&
          /^(logistics|shipments|search)/.test(code)) ||
        (roleCode.includes("FINANCE") &&
          /^(payments|cheques|fx|finance|reports|search)/.test(code)) ||
        (roleCode.includes("OPERATIONS") &&
          /^(capacity|products|reports|search)/.test(code)),
    );
    for (const permissionCode of allowed)
      await db.rolePermission.upsert({
        where: { roleId_permissionCode: { roleId: role.id, permissionCode } },
        create: { roleId: role.id, permissionCode },
        update: {},
      });
    await db.userRole.upsert({
      where: { userId_roleId: { userId, roleId: role.id } },
      create: { userId, roleId: role.id },
      update: {},
    });
    for (const countryCode of ["EG", "SA", "AE"])
      await db.userCountryAccess.upsert({
        where: { userId_countryCode: { userId, countryCode } },
        create: {
          userId,
          countryCode,
          grantedBy: id("1", 1),
          validFrom: new Date("2025-01-01"),
        },
        update: {},
      });
  }
  for (const [
    index,
    [ref, canonicalName, english, accountCategoryCode, countryCode],
  ] of customers.entries()) {
    const accountId = id("ab01", index + 1),
      projectId = id("ab02", index + 1);
    await db.account.upsert({
      where: { id: accountId },
      create: {
        id: accountId,
        accountRef: `ACC-${ref}`,
        canonicalName,
        rawName: english,
        normalizedName: canonicalName,
        countryCode,
        hqCountryCode: countryCode,
        accountCategoryCode,
        ownerUserId: owner,
        defaultCurrencyCode: countryCode === "EG" ? "EGP" : "USD",
        createdAt: date(index),
        ...created,
      },
      update: { ownerUserId: owner },
    });
    await db.contact.upsert({
      where: { id: id("ab03", index + 1) },
      create: {
        id: id("ab03", index + 1),
        accountId,
        displayName: [
          "أحمد عبد الرحمن",
          "محمد السيد",
          "خالد مصطفى",
          "منى عادل",
          "سارة إبراهيم",
        ][index % 5],
        jobTitle: "مدير المشتريات",
        ...created,
      },
      update: {},
    });
    await db.project.upsert({
      where: { id: projectId },
      create: {
        id: projectId,
        name: `مشروع ${english} السكني`,
        normalizedName: english.toLowerCase(),
        countryCode,
        city: ["Cairo", "Alexandria", "New Capital", "Luxor"][index % 4],
        commercialOwnerUserId: owner,
        createdAt: date(index),
        ...created,
      },
      update: { commercialOwnerUserId: owner },
    });
    await db.projectParty.upsert({
      where: {
        projectId_accountId_roleCode: {
          projectId,
          accountId,
          roleCode: "MAIN_CONTRACTOR",
        },
      },
      create: {
        projectId,
        accountId,
        roleCode: "MAIN_CONTRACTOR",
        primaryFlag: true,
      },
      update: {},
    });
  }
  const family = await db.productFamily.upsert({
    where: { familyCode: "ABP_BUILDING" },
    create: { familyCode: "ABP_BUILDING", name: "Building products" },
    update: {},
  });
  for (const [
    index,
    [skuCode, canonicalDescription, , price],
  ] of products.entries()) {
    const productId = id("ab04", index + 1);
    await db.product.upsert({
      where: { skuCode },
      create: {
        id: productId,
        skuCode,
        productFamilyId: family.id,
        productTypeCode: "STANDARD_SKU",
        canonicalDescription,
        normalizedDescription: canonicalDescription.toLowerCase(),
        ...created,
      },
      update: {
        canonicalDescription,
        normalizedDescription: canonicalDescription.toLowerCase(),
      },
    });
    await db.pricingRule.upsert({
      where: { id: id("ab05", index + 1) },
      create: {
        id: id("ab05", index + 1),
        productId,
        countryCode: "EG",
        currencyCode: "EGP",
        minPrice: Number(price) * 0.85,
        referencePrice: price,
        maxPrice: Number(price) * 1.3,
        effectiveFrom: new Date("2025-09-01"),
        sourceCode: "DEMO",
      },
      update: {
        minPrice: Number(price) * 0.85,
        referencePrice: price,
        maxPrice: Number(price) * 1.3,
      },
    });
  }
  const stages = [
    "PROSPECT",
    "QUALIFIED",
    "PROPOSAL",
    "NEGOTIATION",
    "WON",
    "LOST",
  ];
  for (const [index, stageCode] of stages.entries())
    await db.opportunityStagePolicy.upsert({
      where: {
        stageCode_effectiveFrom: {
          stageCode,
          effectiveFrom: new Date("2025-01-01"),
        },
      },
      create: {
        stageCode,
        defaultProbabilityPct: [10, 25, 50, 75, 100, 0][index],
        effectiveFrom: new Date("2025-01-01"),
      },
      update: {},
    });
  await db.opportunityLostReason.upsert({
    where: {
      lostReasonCode_effectiveFrom: {
        lostReasonCode: "PRICE",
        effectiveFrom: new Date("2025-01-01"),
      },
    },
    create: {
      lostReasonCode: "PRICE",
      displayName: "Price / السعر",
      effectiveFrom: new Date("2025-01-01"),
    },
    update: {},
  });
  // What the deals are actually for. A demo where every row reads
  // "Orascom — Proposal" teaches the wrong thing about the pipeline: the
  // whole point of naming a deal is that two deals with the same customer and
  // the same stage are still told apart at a glance.
  const dealScopes = [
    "شدات أعمدة — برج إداري",
    "شدات حوائط — بدروم ومرايات",
    "ألواح أكرو بورد — أسطح أفقية",
    "شدات كور مصاعد",
    "أعمدة دائرية — بهو المدخل",
  ];
  const distribution = [
    ...Array(6).fill("PROSPECT"),
    ...Array(5).fill("QUALIFIED"),
    ...Array(5).fill("PROPOSAL"),
    ...Array(4).fill("NEGOTIATION"),
    ...Array(3).fill("WON"),
    ...Array(2).fill("LOST"),
  ];
  for (let index = 0; index < 25; index++) {
    const stageCode = distribution[index],
      value = 50_000 + index * 10_000,
      wonValue =
        stageCode === "WON" ? [600000, 625000, 650000][index - 20] : null;
    await db.opportunity.upsert({
      where: { id: id("ab06", index + 1) },
      create: {
        id: id("ab06", index + 1),
        title: `${customers[index % 20][2]} — ${dealScopes[index % dealScopes.length]}`,
        accountId: id("ab01", (index % 20) + 1),
        projectId: id("ab02", (index % 20) + 1),
        countryCode: customers[index % 20][4],
        ownerUserId: owner,
        stageCode,
        probabilityPct: [10, 25, 50, 75, 100, 0][stages.indexOf(stageCode)],
        estimatedValue: wonValue ?? value,
        currencyCode: "USD",
        expectedCloseDate: new Date(
          Date.UTC(2026, 8 + (index % 3), 10 + (index % 18)),
        ),
        ...(stageCode === "WON"
          ? {
              wonAt: new Date(
                Date.UTC(2026, 6 + (index - 20), 8 + (index - 20)),
              ),
              wonValueSnapshot: wonValue,
            }
          : {}),
        ...(stageCode === "LOST" ? { lostReasonCode: "PRICE" } : {}),
        createdAt: date(index),
        ...created,
      },
      update: {
        title: `${customers[index % 20][2]} — ${dealScopes[index % dealScopes.length]}`,
        ownerUserId: owner,
        estimatedValue: wonValue ?? value,
        currencyCode: "USD",
      },
    });
  }
  for (const [offset, value] of [600000, 625000, 650000].entries()) {
    const opportunityIndex = 20 + offset;
    const transitionId = id("ab25", offset + 1);
    await db.opportunityStageTransition.upsert({
      where: { id: transitionId },
      create: {
        id: transitionId,
        opportunityId: id("ab06", opportunityIndex + 1),
        fromStageCode: "NEGOTIATION",
        toStageCode: "WON",
        occurredAt: new Date(Date.UTC(2026, 6 + offset, 8 + offset)),
        actorUserId: owner,
      },
      update: { actorUserId: owner },
    });
    await db.opportunityWonSnapshot.upsert({
      where: { id: id("ab26", offset + 1) },
      create: {
        id: id("ab26", offset + 1),
        opportunityId: id("ab06", opportunityIndex + 1),
        stageTransitionId: transitionId,
        wonAt: new Date(Date.UTC(2026, 6 + offset, 8 + offset)),
        value,
        currencyCode: "USD",
      },
      update: {},
    });
  }
  const companyTarget = await db.companyTarget.upsert({
    where: {
      periodStart_periodEnd_version: {
        periodStart: new Date("2026-01-01"),
        periodEnd: new Date("2026-12-31"),
        version: 1,
      },
    },
    create: {
      id: id("ab24", 1),
      periodStart: new Date("2026-01-01"),
      periodEnd: new Date("2026-12-31"),
      amountUsd: 10_000_000,
      effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
      targetYear: 2026,
      companyCode: "ACROW",
      baseCurrencyCode: "USD",
      createdByUserId: owner,
    },
    update: { amountUsd: 10_000_000 },
  });
  const monthlyTargetAmounts = [
    833_333.3333, 833_333.3333, 833_333.3333, 833_333.3333, 833_333.3333,
    833_333.3333, 833_333.3333, 833_333.3333, 833_333.3333, 833_333.3333,
    833_333.3333, 833_333.3337,
  ];
  for (const [month, amountUsd] of monthlyTargetAmounts.entries()) {
    const periodStart = new Date(Date.UTC(2026, month, 1));
    const periodEnd = new Date(Date.UTC(2026, month + 1, 0));
    await db.targetAllocation.upsert({
      where: {
        companyTargetId_allocationTypeCode_periodStart_version: {
          companyTargetId: companyTarget.id,
          allocationTypeCode: "MONTH",
          periodStart,
          version: 1,
        },
      },
      create: {
        id: id("ab27", month + 1),
        companyTargetId: companyTarget.id,
        allocationTypeCode: "MONTH",
        periodStart,
        periodEnd,
        amountUsd,
        effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
        createdByUserId: owner,
      },
      update: { amountUsd, periodEnd },
    });
  }
  await db.fXRate.upsert({
    where: { id: id("ab28", 1) },
    create: {
      id: id("ab28", 1),
      baseCurrencyCode: "USD",
      quoteCurrencyCode: "EGP",
      rate: "50.000000000000",
      effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
      sourceCode: "DEMO_REFERENCE",
      changedByUserId: owner,
      reason: "Deterministic local demonstration exchange rate",
    },
    update: {
      baseCurrencyCode: "USD",
      quoteCurrencyCode: "EGP",
      rate: "50.000000000000",
    },
  });
  for (let index = 0; index < 15; index++) {
    // Persist the existing governed lifecycle; acceptance and rejection are approval outcomes.
    const statusCode =
      index < 3
        ? "DRAFT"
        : index < 11
          ? "SENT"
          : index < 13
            ? "READY"
            : "EXPIRED";
    const quotationId = id("ab07", index + 1),
      unitPrice = Number(products[index % products.length][3]),
      qty = 1000 + index * 200;
    await db.quotation.upsert({
      where: { id: quotationId },
      create: {
        id: quotationId,
        quotationRef: `QT-2026-${String(index + 1).padStart(4, "0")}`,
        accountId: id("ab01", index + 1),
        opportunityId: id("ab06", index + 1),
        projectId: id("ab02", index + 1),
        countryCode: customers[index][4],
        ownerUserId: owner,
        statusCode,
        currencyCode: "EGP",
        validFrom: date(index),
        expiresOn: new Date("2026-12-01"),
        subtotalAmount: qty * unitPrice,
        totalAmount: qty * unitPrice,
        ...(statusCode === "SENT"
          ? {
              contentHash: `demo-seed-${quotationId}`,
              sentAt: date(index),
              commercialStateCode: "SUBMITTED",
              firstSubmittedAt: date(index),
            }
          : {}),
        createdAt: date(index),
        ...created,
      },
      update: {},
    });
    await db.quotationLine.upsert({
      where: { quotationId_lineNo: { quotationId, lineNo: 1 } },
      create: {
        quotationId,
        lineNo: 1,
        productId: id("ab04", (index % products.length) + 1),
        description: products[index % products.length][1],
        qty,
        unitCode: "PIECE",
        unitPrice,
        lineTotal: qty * unitPrice,
      },
      update: {},
    });
  }
  for (let index = 0; index < 50; index++) {
    const activityId = id("ab08", index + 1),
      accountId = id("ab01", (index % 20) + 1);
    await db.activity.upsert({
      where: { id: activityId },
      create: {
        id: activityId,
        accountId,
        countryCode: customers[index % 20][4],
        ownerUserId: owner,
        typeCode:
          index < 15
            ? "CALL"
            : index < 25
              ? "EMAIL"
              : index < 35
                ? "MEETING"
                : "FOLLOW_UP",
        subject: `${["متابعة عرض السعر", "اجتماع المشروع", "مراجعة التوريد", "اتصال العميل"][index % 4]} — ${customers[index % 20][1]}`,
        dueAt:
          index < 35
            ? new Date(Date.UTC(2026, 8, 6 + (index % 20), 9))
            : date(index),
        taskStatusCode: index < 20 ? "COMPLETED" : "OPEN",
        ...(index < 20 ? { completedAt: date(index) } : {}),
        createdAt: date(index),
      },
      update: { ownerUserId: owner },
    });
    await db.activityLink.upsert({
      where: { id: id("ab09", index + 1) },
      create: {
        id: id("ab09", index + 1),
        activityId,
        resourceTypeCode: "ACCOUNT",
        resourceId: accountId,
        isPrimary: true,
      },
      update: {},
    });
  }
  const marketSignals = [
    {
      title: "New Cairo infrastructure tender announced",
      sourceName: "Egyptian public tender bulletin",
      sourceUrl: "https://example.local/evidence/new-cairo-infrastructure",
      publishedDate: new Date("2026-08-18"),
      retrievedDate: new Date("2026-09-05"),
      eventDate: new Date("2026-10-01"),
      evidence:
        "Published tender notice for drainage and utility infrastructure packages in New Cairo.",
      verificationCode: "VERIFIED",
      classificationCode: "FACT",
      countryCode: "EG",
      summary: "Potential demand for PVC systems and temporary works products.",
    },
    {
      title: "Riyadh project pipeline expected to accelerate",
      sourceName: "ABP commercial research desk",
      sourceUrl: "https://example.local/evidence/riyadh-pipeline",
      publishedDate: new Date("2026-08-25"),
      retrievedDate: new Date("2026-09-05"),
      evidence:
        "Analyst forecast derived from published project schedules and distributor interviews.",
      verificationCode: "UNVERIFIED",
      classificationCode: "FORECAST",
      countryCode: "SA",
      summary: "Review scaffolding and shoring partner capacity before Q4.",
    },
    {
      title: "Contractor consolidation discussed in UAE market",
      sourceName: "Regional construction roundtable",
      publishedDate: new Date("2026-09-01"),
      retrievedDate: new Date("2026-09-05"),
      evidence:
        "Opinion gathered from an industry roundtable; no transaction has been announced.",
      verificationCode: "UNVERIFIED",
      classificationCode: "OPINION",
      countryCode: "AE",
      summary:
        "Monitor the named contractors; do not treat consolidation as confirmed.",
    },
  ];
  for (const [index, signal] of marketSignals.entries())
    await db.marketSignal.upsert({
      where: { id: id("ab29", index + 1) },
      create: {
        id: id("ab29", index + 1),
        ...signal,
        evidenceHash: createHash("sha256")
          .update(signal.evidence)
          .digest("hex"),
        createdByUserId: owner,
      },
      update: {},
    });
  const targetMarkets = [
    [
      "Greater Cairo Infrastructure",
      "EG",
      "INFRASTRUCTURE",
      "Public and private utility projects with recurring PVC demand.",
      92,
    ],
    [
      "Riyadh Mega Projects",
      "SA",
      "MEGA_PROJECTS",
      "Large active pipeline with demand for shoring and scaffolding.",
      86,
    ],
    [
      "Northern Emirates Contractors",
      "AE",
      "CONTRACTORS",
      "Mid-size contractors with shorter sales cycles and distributor coverage.",
      74,
    ],
  ];
  for (const [
    index,
    [name, countryCode, segmentCode, rationale, priorityScore],
  ] of targetMarkets.entries())
    await db.targetMarket.upsert({
      where: { id: id("ab30", index + 1) },
      create: {
        id: id("ab30", index + 1),
        name,
        countryCode,
        segmentCode,
        rationale,
        priorityScore,
        rankingSource: "COMMERCIAL_REVIEW_2026_Q3",
        createdByUserId: owner,
      },
      update: {},
    });
  const targetAccounts = [
    [
      "Cairo Infrastructure Alliance",
      "EG",
      "STRATEGIC",
      "Named delivery partner on multiple utility packages.",
      1,
    ],
    [
      "Riyadh Civil Works Group",
      "SA",
      "ENTERPRISE",
      "Visible tender activity across three planned packages.",
      2,
    ],
    [
      "Emirates Formwork Partners",
      "AE",
      "MID_MARKET",
      "Distributor interviews indicate a near-term formwork requirement.",
      3,
    ],
  ];
  for (const [
    index,
    [companyName, countryCode, segmentCode, rationale, signalNo],
  ] of targetAccounts.entries())
    await db.targetAccount.upsert({
      where: { id: id("ab31", index + 1) },
      create: {
        id: id("ab31", index + 1),
        companyName,
        normalizedName: companyName.toLowerCase(),
        countryCode,
        segmentCode,
        rationale,
        sourceSignalId: id("ab29", signalNo),
        ownerUserId: owner,
        createdByUserId: owner,
      },
      update: {},
    });
  const competitors = [
    [
      "Regional Pipe Systems",
      "EG",
      "Strong local distributor reach",
      "Limited engineered temporary works portfolio",
    ],
    [
      "Gulf Shoring Solutions",
      "SA",
      "Fast site support",
      "Premium pricing and limited PVC range",
    ],
    [
      "Emirates Access Systems",
      "AE",
      "Established rental fleet",
      "Low coverage outside the UAE",
    ],
  ];
  for (const [
    index,
    [name, countryCode, strengths, weaknesses],
  ] of competitors.entries())
    await db.competitor.upsert({
      where: { id: id("ab32", index + 1) },
      create: {
        id: id("ab32", index + 1),
        name,
        normalizedName: name.toLowerCase(),
        countryCode,
        strengths,
        weaknesses,
        notes:
          "Demo research profile; validate before use in a customer decision.",
        createdByUserId: owner,
      },
      update: {},
    });
  for (let index = 0; index < 3; index++)
    await db.watchlistEntry.upsert({
      where: { id: id("ab33", index + 1) },
      create: {
        id: id("ab33", index + 1),
        resourceType: "TARGET_ACCOUNT",
        resourceId: id("ab31", index + 1),
        label: `Priority prospect — ${targetAccounts[index][0]}`,
        notes: "Review in the weekly commercial pipeline meeting.",
        createdByUserId: owner,
      },
      update: {},
    });
  await db.repeatBusinessRequest.upsert({
    where: { id: id("ab34", 1) },
    create: {
      id: id("ab34", 1),
      accountId: id("ab01", 1),
      subject: "Additional PVC package for New Cairo site",
      description:
        "Please prepare a commercial follow-up for an additional drainage package. No order has been authorized.",
      requestedByUserId: owner,
      assignedOwnerUserId: owner,
    },
    update: {},
  });
  for (let index = 0; index < 20; index++)
    await db.userNotification.upsert({
      where: { id: id("ab10", index + 1) },
      create: {
        id: id("ab10", index + 1),
        recipientUserId: owner,
        typeCode: [
          "APPROVAL_NEEDED",
          "QUOTATION_ACCEPTED",
          "OVERDUE_TASK",
          "SHIPMENT_UPDATE",
          "AI_INSIGHT",
        ][index % 5],
        titleSafe: `${["عرض سعر للمراجعة", "متابعة العميل", "موعد نشاط تجاري", "تحديث التوريد", "رؤية تجارية جديدة"][index % 5]} — ${customers[index][1]}`,
        bodySafe:
          "إشعار توضيحي لبيئة العرض المحلية / Local demonstration notification",
        resourceTypeCode: "ACCOUNT",
        resourceId: id("ab01", index + 1),
        createdAt: new Date(Date.UTC(2026, 8, 5, 10, index)),
      },
      update: {},
    });
  for (let index = 0; index < 4; index++)
    await db.aiRuleOutput.upsert({
      where: { id: id("ab11", index + 1) },
      create: {
        id: id("ab11", index + 1),
        recipientUserId: owner,
        ruleCode: `DEMO_COMMERCIAL_${index + 1}`,
        ruleVersion: "1",
        resourceTypeCode: "OPPORTUNITY",
        resourceId: id("ab06", index + 1),
        countryCode: "EG",
        outputTypeCode: "ADVISORY",
        scoreNumeric: 47 + index,
        outputJson: {
          priority: index < 2 ? "HIGH" : "MEDIUM",
          title: [
            "Pipeline follow-up overdue",
            "Pricing review recommended",
            "Account engagement declining",
            "Seasonal demand planning",
          ][index],
          titleAr: [
            "تأخر متابعة الفرص",
            "مراجعة التسعير مطلوبة",
            "تراجع التواصل مع العميل",
            "تخطيط الطلب الموسمي",
          ][index],
          insight:
            "Demonstration insight: review the linked opportunity and schedule a commercial follow-up.",
          insightAr:
            "رؤية توضيحية: راجع الفرصة المرتبطة وحدد موعداً للمتابعة التجارية.",
          kpiLabel: "Days since review",
          kpiLabelAr: "أيام منذ المراجعة",
          kpiValue: 47 + index,
          sparkData: [20, 25, 30, 38, 42, 45, 47 + index],
        },
      },
      update: {},
    });
  await db.logisticsPlan.upsert({
    where: { id: id("ab12", 1) },
    create: {
      id: id("ab12", 1),
      planRef: "LOG-2026-0001",
      sourceTypeCode: "QUOTATION",
      sourceId: id("ab07", 1),
      countryCode: "EG",
      createdByUserId: owner,
    },
    update: {},
  });
  await db.logisticsPlanVersion.upsert({
    where: {
      logisticsPlanId_versionNo: {
        logisticsPlanId: id("ab12", 1),
        versionNo: 1,
      },
    },
    create: {
      id: id("ab13", 1),
      logisticsPlanId: id("ab12", 1),
      versionNo: 1,
      createdByUserId: owner,
    },
    update: {},
  });
  const batchId = id("ab14", 1),
    sourceId = id("ab15", 1);
  await db.importBatch.upsert({
    where: { id: batchId },
    create: {
      id: batchId,
      sourceSystemCode: "ABP_DEMO",
      sourceSystemId: sourceId,
      importTypeCode: "ERP_ORDERS",
      sourceFingerprint: "abp-commercial-demo-v1",
      statusCode: "COMMITTED",
      actorUserId: owner,
      committedAt: new Date("2026-09-01"),
    },
    update: {},
  });
  const objectRoot =
    process.env.ABP_LOCAL_OBJECT_ROOT ??
    fileURLToPath(new URL("../../../.tmp/object-storage/", import.meta.url));
  await mkdir(join(objectRoot, "demo"), { recursive: true });
  for (let index = 0; index < 20; index++) {
    const accountId = id("ab01", index + 1),
      orderId = id("ab16", index + 1),
      countryCode = customers[index][4];
    const amount = 280000 + index * 18000,
      occurred = date(index);
    await db.eRPOrder.upsert({
      where: { id: orderId },
      create: {
        id: orderId,
        sourceSystemCode: "ABP_DEMO",
        sourceSystemId: sourceId,
        sourceOrderKey: `SO-DEMO-2026-${String(index + 1).padStart(4, "0")}`,
        sourceSalesOrderId: orderId,
        importBatchId: batchId,
        accountId,
        projectId: id("ab02", index + 1),
        countryCode,
        currencyCode: "USD",
        statusCode: ["BOOKED", "SHIPPED", "INVOICED"][index % 3],
        dqStatusCode: "VALID",
        totalAmount: amount / 50,
        bookedAmount: amount / 50,
        shippedAmount: index % 3 > 0 ? amount / 50 : 0,
        invoicedAmount: index % 3 === 2 ? amount / 50 : 0,
        orderDate: occurred,
        importedAt: occurred,
      },
      update: {},
    });
    if (index < 2)
      await db.eRPOrder.updateMany({
        where: { id: orderId, integrationStatusCode: "NOT_REQUIRED" },
        data: { integrationStatusCode: "PENDING_SYNC" },
      });
    await db.eRPOrderLine.upsert({
      where: {
        erpOrderId_sourceLineKey: { erpOrderId: orderId, sourceLineKey: "1" },
      },
      create: {
        erpOrderId: orderId,
        sourceLineKey: "1",
        productId: id("ab04", (index % products.length) + 1),
        qtyBooked: 100,
        qtyShipped: index % 3 > 0 ? 100 : 0,
        qtyInvoiced: index % 3 === 2 ? 100 : 0,
        qtyRemaining: index % 3 > 0 ? 0 : 100,
      },
      update: {},
    });
    await db.payment.upsert({
      where: { id: id("ab17", index + 1) },
      create: {
        id: id("ab17", index + 1),
        sourceSystemCode: "ABP_DEMO",
        sourcePaymentKey: `PAY-DEMO-${index + 1}`,
        accountId,
        erpOrderId: orderId,
        amount: amount / 2,
        currencyCode: "EGP",
        statusCode: "ACTIVE",
        paymentDate: occurred,
        paymentMethodCode: "BANK_TRANSFER",
        createdByUserId: owner,
        createdAt: occurred,
      },
      update: {},
    });
    await db.complaint.upsert({
      where: { id: id("ab18", index + 1) },
      create: {
        id: id("ab18", index + 1),
        accountId,
        projectId: id("ab02", index + 1),
        countryCode,
        complaintTypeCode: "DELIVERY",
        statusCode: ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"][index % 4],
        severityCode: "MEDIUM",
        ownerUserId: owner,
        description: `متابعة جدول التوريد — ${customers[index][1]}`,
        createdAt: occurred,
      },
      update: {},
    });
    const milestoneCode = [
      "READY_FOR_DELIVERY",
      "SHIPPED",
      "VESSEL_DEPARTED",
      "ARRIVED_AT_PORT_OF_DISCHARGE",
    ][index % 4];
    await db.shipment.upsert({
      where: { id: id("ab19", index + 1) },
      create: {
        id: id("ab19", index + 1),
        erpOrderId: orderId,
        countryCode,
        milestoneCode,
        ...(index % 4 >= 2 ? { blDate: occurred } : {}),
        ...(index % 4 === 3
          ? {
              portOfDischarge: "Alexandria",
              actualArrivalAt: new Date(occurred.getTime() + 7 * 86400000),
            }
          : {}),
        createdByUserId: owner,
        updatedByUserId: owner,
        createdAt: occurred,
      },
      update: {},
    });
    const fileName = `customer-${index + 1}.csv`,
      bytes = Buffer.from(
        `\uFEFFCustomer,Reference,Demo\r\n"${customers[index][1]}","SO-DEMO-2026-${String(index + 1).padStart(4, "0")}",true\r\n`,
      );
    await writeFile(join(objectRoot, "demo", fileName), bytes);
    await db.documentMetadata.upsert({
      where: { id: id("ab20", index + 1) },
      create: {
        id: id("ab20", index + 1),
        resourceTypeCode: "ACCOUNT",
        resourceId: accountId,
        storageKey: `demo/${fileName}`,
        mimeType: "text/csv",
        sizeBytes: BigInt(bytes.length),
        fileHash: createHash("sha256").update(bytes).digest("hex"),
        classificationCode: "INTERNAL",
        documentTypeCode: "GENERAL",
        title: fileName,
        statusCode: "AVAILABLE",
        createdByUserId: owner,
        createdAt: occurred,
      },
      update: {},
    });
  }
  for (let index = 0; index < 15; index++) {
    const quote = await db.quotation.findUniqueOrThrow({
      where: { id: id("ab07", index + 1) },
    });
    if (quote.statusCode === "SENT")
      await db.quotationAcceptance.upsert({
        where: { id: id("ab21", index + 1) },
        create: {
          id: id("ab21", index + 1),
          quotationId: quote.id,
          evidenceTypeCode: "EXTERNAL_REFERENCE",
          externalReference: `DEMO-CLIENT-ACCEPTANCE-${index + 1}`,
          acceptedAt: quote.sentAt ?? date(index),
          verifiedByUserId: owner,
        },
        update: {},
      });
    await db.quotationApproval.upsert({
      where: { id: id("ab22", index + 1) },
      create: {
        id: id("ab22", index + 1),
        quotationId: quote.id,
        contentHash: quote.contentHash ?? `demo-review-${quote.id}`,
        statusCode: ["PENDING", "APPROVED", "REJECTED"][index % 3],
        requestedByUserId: owner,
        currentAssigneeUserId: owner,
        requestedAt: date(index),
        ...(index % 3
          ? { decidedByUserId: owner, decidedAt: date(index) }
          : {}),
      },
      update: {},
    });
  }
  await db.logisticsPlanLine.upsert({
    where: { id: id("ab23", 1) },
    create: {
      id: id("ab23", 1),
      planVersionId: id("ab13", 1),
      productId: id("ab04", 1),
      qty: 100,
      lengthMm: 3000,
      widthMm: 110,
      thicknessMm: 110,
      weightKg: 5,
    },
    update: {},
  });
  console.log(
    "Added linked demo orders, payments, complaints, shipments and downloadable customer documents.",
  );
  console.log(
    "ABP demo seed complete: 8 users, 20 customers, 20 contacts/projects, 13 SKUs, 25 opportunities, 15 quotations, 50 activities, 20 notifications.",
  );
}
try {
  await main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
