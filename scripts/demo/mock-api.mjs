import { createServer } from "node:http";
import { readFile } from "node:fs/promises";

const port = Number(process.env.ABP_DEMO_API_PORT ?? 3000);
const ownerUserId = "10000000-0000-4000-8000-000000000001";
const catalog = JSON.parse(
  await readFile(
    new URL(
      "../../apps/web/src/generated/operation-catalog.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const permissions = [
  "authenticated",
  "sales.workspace.view",
  "sales.management.view",
  "sales.support.act",
  "operations.workspace.view",
  "search.use",
  "ai.advisory.view",
  ...new Set(
    catalog.operations
      .map((operation) => operation.permission)
      .filter((permission) => typeof permission === "string"),
  ),
];
const countries = [
  {
    countryCode: "EG",
    displayName: "Egypt",
    continent: "AFRICA",
    marketScope: "LOCAL",
  },
  {
    countryCode: "SA",
    displayName: "Saudi Arabia",
    continent: "ASIA",
    marketScope: "EXPORT",
  },
  {
    countryCode: "AE",
    displayName: "United Arab Emirates",
    continent: "ASIA",
    marketScope: "EXPORT",
  },
];
const customerNames = [
  ["Arab Contractors", "EG", "STRATEGIC"],
  ["Talaat Moustafa Group", "EG", "STRATEGIC"],
  ["Orascom Construction", "EG", "ENTERPRISE"],
  ["Hassan Allam Holding", "EG", "ENTERPRISE"],
  ["Palm Hills Developments", "EG", "KEY"],
  ["Al Futtaim Engineering", "AE", "KEY"],
  ["Saudi Binladin Group", "SA", "ENTERPRISE"],
  ["Red Sea Construction", "SA", "MID_MARKET"],
  ["New Capital Developers", "EG", "STRATEGIC"],
  ["SODIC", "EG", "KEY"],
];
let sequence = 100;
const uuid = (group, number) =>
  `${group.padEnd(8, "0")}-0000-4000-8000-${String(number).padStart(12, "0")}`;
const countryByCode = (countryCode) =>
  countries.find((country) => country.countryCode === countryCode) ??
  countries[0];
const accountDetail = (account) => ({
  ...account,
  defaultCurrencyCode: account.country.countryCode === "EG" ? "EGP" : "USD",
  effectiveGroupMemberships: [],
  geography: {
    country: account.country,
    continent: account.country.continent,
    marketScope: account.country.marketScope,
  },
  hqCountry: account.country,
  rowVersion: '"rv-1"',
  archivedAt: null,
});
const accounts = customerNames.map(
  ([canonicalName, countryCode, category], index) => ({
    accountId: uuid("30000000", index + 1),
    accountRef: `ACC-${String(1024 + index)}`,
    customerNumber: `C-${String(1024 + index)}`,
    canonicalName,
    accountCategoryCode: category,
    ownerUserId,
    recordStatusCode: "ACTIVE",
    country: countryByCode(countryCode),
  }),
);
const projectNames = [
  "New Administrative Capital Towers",
  "Cairo Metro Line 4",
  "Alamein Downtown Towers",
  "Riyadh Mall Expansion",
  "Jeddah Industrial Complex",
];
const projects = projectNames.map((projectName, index) => ({
  projectId: uuid("40000000", index + 1),
  projectRef: `PRJ-2026-${String(index + 1).padStart(3, "0")}`,
  projectName,
  accountId: accounts[index % accounts.length].accountId,
  countryCode: accounts[index % accounts.length].country.countryCode,
  recordStatusCode: "ACTIVE",
  rowVersion: '"rv-1"',
}));
const opportunityNames = [
  "High Rise Building — Cairo",
  "Mall Project — Riyadh",
  "Industrial Complex — Jeddah",
  "Hospital Expansion — Alexandria",
  "Residential Compound — 6th October",
  "New Capital Business District",
  "North Coast Resort",
  "Cairo Metro Expansion",
  "Dubai Logistics Hub",
  "Suez Canal Warehouses",
];
const stages = [
  "NEGOTIATION",
  "PROPOSAL",
  "QUALIFIED",
  "NEGOTIATION",
  "PROPOSAL",
  "WON",
  "QUALIFIED",
  "PROSPECT",
  "WON",
  "NEGOTIATION",
];
const opportunities = opportunityNames.map((title, index) => ({
  opportunityId: uuid("50000000", index + 1),
  opportunityRef: `OPP-2026-${String(index + 1).padStart(4, "0")}`,
  title,
  accountId: accounts[index].accountId,
  projectId: projects[index % projects.length].projectId,
  ownerUserId,
  countryCode: accounts[index].country.countryCode,
  currencyCode: "USD",
  estimatedValue: String(175_000 + index * 47_300),
  expectedCloseDate: `2026-${String(5 + (index % 5)).padStart(2, "0")}-${String(12 + index).padStart(2, "0")}`,
  probabilityPct:
    stages[index] === "WON" ? "100" : String(25 + (index % 4) * 20),
  probabilitySourceCode: "STAGE_DEFAULT",
  stageCode: stages[index],
  rowVersion: '"rv-1"',
  lostReasonCode: null,
  noProjectReasonCode: null,
  stageHistory: [],
  wonAt: stages[index] === "WON" ? "2026-08-20T10:00:00Z" : null,
  wonSnapshots: [],
  wonValueSnapshot:
    stages[index] === "WON" ? String(175_000 + index * 47_300) : null,
}));
const quotations = opportunities.slice(0, 6).map((opportunity, index) => ({
  quotationId: uuid("60000000", index + 1),
  quoteRef: `Q-2026-${String(1057 - index)}`,
  accountId: opportunity.accountId,
  opportunityId: opportunity.opportunityId,
  projectId: opportunity.projectId,
  ownerUserId,
  countryCode: opportunity.countryCode,
  currencyCode: "USD",
  calculationVersion: "2026.09",
  statusCode: index < 2 ? "SENT" : "DRAFT",
  commercialState: index < 2 ? "SUBMITTED" : "NOT_SUBMITTED",
  grandTotalAmount: String(210_000 + index * 42_500),
  subtotalAmount: String(200_000 + index * 40_000),
  discountAmount: "0",
  taxAmount: String(10_000 + index * 2_500),
  validFrom: "2026-09-01",
  expiresOn: "2026-10-01",
  firstSubmittedAt: index < 2 ? "2026-09-03T09:30:00Z" : null,
  sentAt: index < 2 ? "2026-09-03T09:30:00Z" : null,
  supersedesQuotationId: null,
  paymentTermsCode: "NET30",
  customPaymentTerms: null,
  rowVersion: '"rv-1"',
  adjustments: [],
  lines: [
    {
      quotationLineId: uuid("61000000", index + 1),
      description: "ACROW shoring and formwork package",
      qty: "100",
      unitCode: "PIECE",
      unitPrice: String(2000 + index * 400),
      discountAmount: "0",
      lineTotal: String(200_000 + index * 40_000),
    },
  ],
}));
const activities = Array.from({ length: 8 }, (_, index) => ({
  activityId: uuid("70000000", index + 1),
  typeCode: ["MEETING", "CALL", "FOLLOW_UP", "SITE_VISIT"][index % 4],
  subject: [
    "Client meeting — ACROW Misr",
    "Quotation follow-up",
    "Technical submittal review",
    "New Capital site visit",
  ][index % 4],
  countryCode: accounts[index].country.countryCode,
  ownerUserId,
  dueAt: `2026-09-${String(7 + index).padStart(2, "0")}T09:00:00Z`,
  scheduledAt: `2026-09-${String(7 + index).padStart(2, "0")}T09:00:00Z`,
  taskStatusCode: index < 2 ? "COMPLETED" : "OPEN",
  rowVersion: '"rv-1"',
  links: [
    {
      resourceTypeCode: "ACCOUNT",
      resourceId: accounts[index].accountId,
      isPrimary: true,
    },
  ],
}));
const contacts = accounts.slice(0, 4).map((account, index) => ({
  contactId: uuid("80000000", index + 1),
  accountId: account.accountId,
  displayName: ["Eng. Omar Hassan", "Mariam Adel", "Khaled Samir", "Nour Ali"][
    index
  ],
  jobTitle: [
    "Project Director",
    "Procurement Manager",
    "Site Manager",
    "Commercial Lead",
  ][index],
  statusCode: "ACTIVE",
  rowVersion: '"rv-1"',
  account: {
    accountId: account.accountId,
    accountRef: account.accountRef,
    canonicalName: account.canonicalName,
  },
  channels: [],
}));
const notifications = activities.map((activity, index) => ({
  notificationId: uuid("90000000", index + 1),
  titleSafe: activity.subject,
  bodySafe: `Scheduled commercial action ${String(index + 1)}`,
  typeCode: "ACTION_REQUIRED",
  createdAt: activity.dueAt,
  readAt: index < 3 ? "2026-09-05T08:00:00Z" : null,
}));
const pageMeta = (total, limit = 25, offset = 0) => ({
  page: Math.floor(offset / limit) + 1,
  offset,
  limit,
  total,
  hasNext: offset + limit < total,
});
const list = (data, url) => {
  const limit = Number(url.searchParams.get("limit") ?? 25);
  const offset = Number(
    url.searchParams.get("offset") ??
      (Number(url.searchParams.get("page") ?? 1) - 1) * limit,
  );
  return {
    data: data.slice(offset, offset + limit),
    meta: pageMeta(data.length, limit, offset),
  };
};
const readBody = async (request) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
};
const send = (response, status, payload, headers = {}) => {
  response.writeHead(status, {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type,if-match,idempotency-key",
    "access-control-allow-methods": "GET,POST,PATCH,PUT,DELETE,OPTIONS",
    "content-type": "application/json; charset=utf-8",
    ...headers,
  });
  response.end(JSON.stringify(payload));
};
const detailById = (rows, id, key) => rows.find((row) => row[key] === id);
const metrics = [
  {
    metricId: "MET-PIPE-001",
    metricVersion: 1,
    name: "Active pipeline value",
    availability: "AVAILABLE",
    value: "2347800",
    unit: "MONEY",
    currency: "USD",
    basis: "Authorized active opportunities",
    breakdown: stages.slice(0, 4).map((stageCode, index) => ({
      key: stageCode,
      label: stageCode,
      value: String(842_200 - index * 136_100),
    })),
    dqContext: { excludedDataConflict: 0, unclassified: 0 },
  },
  {
    metricId: "MET-WON-001",
    metricVersion: 1,
    name: "Won revenue",
    availability: "AVAILABLE",
    value: "1875400",
    unit: "MONEY",
    currency: "USD",
    basis: "Won value snapshots",
    breakdown: [],
    dqContext: { excludedDataConflict: 0, unclassified: 0 },
  },
];

const server = createServer(async (request, response) => {
  try {
    if (request.method === "OPTIONS") return send(response, 204, {});
    const url = new URL(request.url ?? "/", `http://${request.headers.host}`);
    const path = url.pathname.replace(/^\/api\/v1/, "") || "/";
    if (path === "/health/live" || path === "/health/ready") {
      return send(response, 200, { status: "ok", mode: "university-demo" });
    }
    if (path === "/me" && request.method === "GET") {
      return send(response, 200, {
        data: {
          user: {
            userId: ownerUserId,
            email: "admin@abp.local",
            displayName: "Alexander V.",
            authStatusCode: "ACTIVE",
            rowVersion: '"rv-1"',
          },
          session: {
            sessionId: "university-demo-session",
            authTransport: "BFF_COOKIE",
            assurance: "FEDERATED_MFA",
            issuedAt: "2026-09-05T08:00:00Z",
            expiresAt: "2027-09-05T08:00:00Z",
          },
          access: {
            roles: [
              {
                roleId: uuid("20000000", 1),
                code: "SYSTEM_ADMIN",
                name: "System Administrator",
                workspace: "ADMIN",
              },
            ],
            permissions,
            countryScope: { countryCodes: ["EG", "SA", "AE"], enforced: true },
            workspaces: [
              "SALES",
              "OPERATIONS",
              "LOGISTICS",
              "FINANCE",
              "ADMIN",
            ].map((workspace) => ({
              workspace,
              enabled: true,
              capabilities: [],
            })),
            policyVersion: 1,
          },
          stepUp: {
            required: false,
            satisfied: true,
            permittedMethods: ["MFA"],
          },
        },
      });
    }
    if (path === "/reference/countries")
      return send(response, 200, { data: countries });
    if (path === "/reference/opportunity-stage-policies") {
      return send(response, 200, {
        data: [
          "PROSPECT",
          "QUALIFIED",
          "PROPOSAL",
          "NEGOTIATION",
          "WON",
          "LOST",
        ].map((stageCode, index) => ({
          stageCode,
          defaultProbabilityPct: String([10, 25, 50, 75, 100, 0][index]),
          effectiveFrom: "2026-01-01T00:00:00Z",
          effectiveTo: null,
        })),
      });
    }
    if (path === "/reference/opportunity-lost-reasons") {
      return send(response, 200, {
        data: ["PRICE", "COMPETITOR", "TIMING"].map((lostReasonCode) => ({
          lostReasonCode,
          displayName: lostReasonCode,
          statusCode: "ACTIVE",
          effectiveFrom: "2026-01-01T00:00:00Z",
          effectiveTo: null,
        })),
      });
    }
    if (path === "/accounts" && request.method === "GET") {
      const search = (url.searchParams.get("search") ?? "").toLowerCase();
      const filtered = accounts.filter((account) =>
        `${account.canonicalName} ${account.accountRef}`
          .toLowerCase()
          .includes(search),
      );
      return send(response, 200, list(filtered, url));
    }
    if (path === "/accounts" && request.method === "POST") {
      const body = await readBody(request);
      const country = countryByCode(body.countryCode);
      const account = {
        accountId: uuid("30000000", ++sequence),
        accountRef: `ACC-${String(2000 + sequence)}`,
        customerNumber: null,
        canonicalName: body.canonicalName,
        accountCategoryCode: null,
        ownerUserId,
        recordStatusCode: "ACTIVE",
        country,
      };
      accounts.unshift(account);
      return send(
        response,
        201,
        { data: accountDetail(account) },
        { etag: '"rv-1"' },
      );
    }
    const accountContactMatch = path.match(/^\/accounts\/([^/]+)\/contacts$/);
    if (accountContactMatch && request.method === "GET") {
      return send(
        response,
        200,
        list(
          contacts.filter(
            (contact) => contact.accountId === accountContactMatch[1],
          ),
          url,
        ),
      );
    }
    if (accountContactMatch && request.method === "POST") {
      const body = await readBody(request);
      const account = detailById(accounts, accountContactMatch[1], "accountId");
      const contact = {
        contactId: uuid("80000000", ++sequence),
        accountId: accountContactMatch[1],
        displayName: body.displayName,
        jobTitle: body.jobTitle ?? null,
        statusCode: "ACTIVE",
        rowVersion: '"rv-1"',
        account: {
          accountId: account.accountId,
          accountRef: account.accountRef,
          canonicalName: account.canonicalName,
        },
        channels: (body.channels ?? []).map((channel, index) => ({
          ...channel,
          contactChannelId: uuid("81000000", sequence + index),
        })),
      };
      contacts.unshift(contact);
      return send(response, 201, { data: contact }, { etag: '"rv-1"' });
    }
    const accountMatch = path.match(/^\/accounts\/([^/]+)$/);
    if (accountMatch && request.method === "GET") {
      const account = detailById(accounts, accountMatch[1], "accountId");
      return account
        ? send(
            response,
            200,
            { data: accountDetail(account) },
            { etag: '"rv-1"' },
          )
        : send(response, 404, { error: { messageKey: "ACCOUNT_NOT_FOUND" } });
    }
    const contactMatch = path.match(/^\/contacts\/([^/]+)$/);
    if (contactMatch && request.method === "GET") {
      const contact = detailById(contacts, contactMatch[1], "contactId");
      return contact
        ? send(response, 200, { data: contact }, { etag: '"rv-1"' })
        : send(response, 404, { error: { messageKey: "CONTACT_NOT_FOUND" } });
    }
    if (path === "/projects" && request.method === "GET") {
      const accountId = url.searchParams.get("accountId");
      return send(
        response,
        200,
        list(
          accountId
            ? projects.filter((project) => project.accountId === accountId)
            : projects,
          url,
        ),
      );
    }
    if (path === "/opportunities" && request.method === "GET") {
      const accountId = url.searchParams.get("accountId");
      return send(
        response,
        200,
        list(
          accountId
            ? opportunities.filter(
                (opportunity) => opportunity.accountId === accountId,
              )
            : opportunities,
          url,
        ),
      );
    }
    if (path === "/opportunities" && request.method === "POST") {
      const body = await readBody(request);
      const account = detailById(accounts, body.accountId, "accountId");
      const opportunity = {
        opportunityId: uuid("50000000", ++sequence),
        opportunityRef: `OPP-2026-${String(sequence).padStart(4, "0")}`,
        title: "New commercial opportunity",
        accountId: body.accountId,
        projectId: null,
        ownerUserId,
        countryCode: account?.country.countryCode ?? "EG",
        currencyCode: body.currencyCode ?? "USD",
        estimatedValue: body.estimatedValue ?? null,
        expectedCloseDate: null,
        probabilityPct: "10",
        probabilitySourceCode: "STAGE_DEFAULT",
        stageCode: "PROSPECT",
        rowVersion: '"rv-1"',
        lostReasonCode: null,
        noProjectReasonCode: body.noProjectReasonCode ?? "EARLY_QUALIFICATION",
        stageHistory: [],
        wonAt: null,
        wonSnapshots: [],
        wonValueSnapshot: null,
      };
      opportunities.unshift(opportunity);
      return send(response, 201, { data: opportunity }, { etag: '"rv-1"' });
    }
    const opportunityMatch = path.match(/^\/opportunities\/([^/]+)$/);
    if (opportunityMatch && request.method === "GET") {
      const opportunity = detailById(
        opportunities,
        opportunityMatch[1],
        "opportunityId",
      );
      return opportunity
        ? send(response, 200, { data: opportunity }, { etag: '"rv-1"' })
        : send(response, 404, {
            error: { messageKey: "OPPORTUNITY_NOT_FOUND" },
          });
    }
    if (path === "/quotations" && request.method === "GET") {
      const accountId = url.searchParams.get("accountId");
      return send(
        response,
        200,
        list(
          accountId
            ? quotations.filter((quote) => quote.accountId === accountId)
            : quotations,
          url,
        ),
      );
    }
    if (path === "/quotations" && request.method === "POST") {
      const body = await readBody(request);
      const opportunity = detailById(
        opportunities,
        body.opportunityId,
        "opportunityId",
      );
      const quotation = {
        ...quotations[0],
        quotationId: uuid("60000000", ++sequence),
        quoteRef: `Q-2026-${String(1100 + sequence)}`,
        accountId: opportunity.accountId,
        opportunityId: opportunity.opportunityId,
        statusCode: "DRAFT",
        commercialState: "NOT_SUBMITTED",
        firstSubmittedAt: null,
        sentAt: null,
      };
      quotations.unshift(quotation);
      return send(response, 201, { data: quotation }, { etag: '"rv-1"' });
    }
    const quotationMatch = path.match(/^\/quotations\/([^/]+)$/);
    if (quotationMatch && request.method === "GET") {
      const quotation = detailById(
        quotations,
        quotationMatch[1],
        "quotationId",
      );
      return quotation
        ? send(response, 200, { data: quotation }, { etag: '"rv-1"' })
        : send(response, 404, { error: { messageKey: "QUOTATION_NOT_FOUND" } });
    }
    if (path === "/activities" && request.method === "GET") {
      return send(response, 200, list(activities, url));
    }
    if (path === "/activities" && request.method === "POST") {
      const body = await readBody(request);
      const activity = {
        activityId: uuid("70000000", ++sequence),
        countryCode: "EG",
        ownerUserId,
        taskStatusCode: "OPEN",
        rowVersion: '"rv-1"',
        ...body,
      };
      activities.unshift(activity);
      return send(response, 201, { data: activity }, { etag: '"rv-1"' });
    }
    if (path === "/notifications" && request.method === "GET") {
      return send(response, 200, list(notifications, url));
    }
    if (path === "/analytics/registry/reports" && request.method === "GET") {
      return send(response, 200, {
        data: [
          {
            reportId: "RPT-004",
            name: "Pipeline & quotations",
            exportFormats: ["CSV", "XLSX", "PDF"],
            metricIds: metrics.map((metric) => metric.metricId),
          },
          {
            reportId: "RPT-005",
            name: "Customer performance",
            exportFormats: ["CSV", "PDF"],
            metricIds: metrics.map((metric) => metric.metricId),
          },
        ],
      });
    }
    const reportMatch = path.match(/^\/analytics\/reports\/([^/]+)$/);
    if (reportMatch && request.method === "GET") {
      return send(response, 200, {
        data: {
          reportId: reportMatch[1],
          name: "Commercial performance",
          asOf: url.searchParams.get("asOf") ?? "2026-09-05T23:59:59.999Z",
          currency: url.searchParams.get("currency") ?? "USD",
          metrics,
        },
      });
    }
    if (request.method === "GET") return send(response, 200, list([], url));
    return send(response, 200, {
      data: { success: true, rowVersion: '"rv-2"' },
    });
  } catch (error) {
    return send(response, 500, {
      error: {
        messageKey: error instanceof Error ? error.message : "DEMO_API_ERROR",
      },
    });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(
    `ABP university demo API listening on http://127.0.0.1:${String(port)}/api/v1`,
  );
});
