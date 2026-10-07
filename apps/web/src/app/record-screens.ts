import type { RecordScreenSpec } from "./RecordScreen.tsx";

/**
 * Column descriptions for the screens that are ordinary lists of records.
 *
 * Every entry here is a screen that used to fall through to the generic
 * operation browser, where a user saw an operation picker and a table of raw
 * field names. Naming the columns is most of what turns that into a screen.
 *
 * Screens with real behaviour of their own — quotations, the dashboard, order
 * history, the import review queue — are not in this file; they are their own
 * components.
 */
export const recordScreens: Record<string, RecordScreenSpec> = {
  MARKET_SIGNALS: {
    listOperationId: "get_market_signals",
    idField: "id",
    kicker: { en: "Intelligence", ar: "معلومات السوق" },
    title: { en: "Market signals", ar: "إشارات السوق" },
    sub: {
      en: "Published evidence of demand, each kept with its source.",
      ar: "أدلة منشورة على الطلب، كل منها محفوظ مع مصدره.",
    },
    empty: { en: "No signals recorded.", ar: "لا توجد إشارات مسجلة." },
    searchable: true,
    columns: [
      { field: "title", en: "Signal", ar: "الإشارة" },
      { field: "countryCode", en: "Country", ar: "الدولة" },
      {
        field: "classificationCode",
        en: "Type",
        ar: "النوع",
        kind: "code",
      },
      {
        field: "verificationCode",
        en: "Verified",
        ar: "التحقق",
        kind: "status",
      },
      {
        field: "publishedDate",
        en: "Published",
        ar: "تاريخ النشر",
        kind: "date",
      },
      { field: "sourceName", en: "Source", ar: "المصدر", secondary: true },
    ],
    detailFields: [
      { field: "summary", en: "Summary", ar: "الملخص" },
      { field: "evidence", en: "Evidence", ar: "الدليل" },
      { field: "sourceUrl", en: "Source link", ar: "رابط المصدر" },
      { field: "eventDate", en: "Event date", ar: "تاريخ الحدث", kind: "date" },
    ],
  },

  TARGET_MARKETS: {
    listOperationId: "get_target_markets",
    idField: "id",
    kicker: { en: "Intelligence", ar: "معلومات السوق" },
    title: { en: "Target markets", ar: "الأسواق المستهدفة" },
    empty: { en: "No target markets yet.", ar: "لا توجد أسواق مستهدفة." },
    searchable: true,
    columns: [
      { field: "name", en: "Market", ar: "السوق" },
      { field: "countryCode", en: "Country", ar: "الدولة" },
      { field: "segmentCode", en: "Segment", ar: "القطاع", kind: "code" },
      {
        field: "priorityScore",
        en: "Priority",
        ar: "الأولوية",
        kind: "number",
      },
      { field: "statusCode", en: "Status", ar: "الحالة", kind: "status" },
    ],
    detailFields: [
      { field: "rationale", en: "Why", ar: "السبب" },
      { field: "rankingSource", en: "Ranking source", ar: "مصدر الترتيب" },
    ],
  },

  TARGET_ACCOUNTS: {
    listOperationId: "get_target_accounts",
    idField: "id",
    kicker: { en: "Intelligence", ar: "معلومات السوق" },
    title: { en: "Target accounts", ar: "الحسابات المستهدفة" },
    sub: {
      en: "Companies worth approaching. Convert one to a customer when it becomes real.",
      ar: "شركات تستحق التواصل. حوّلها إلى عميل عندما تصبح فعلية.",
    },
    empty: { en: "No target accounts yet.", ar: "لا توجد حسابات مستهدفة." },
    searchable: true,
    columns: [
      { field: "companyName", en: "Company", ar: "الشركة" },
      { field: "countryCode", en: "Country", ar: "الدولة" },
      { field: "segmentCode", en: "Segment", ar: "القطاع", kind: "code" },
      { field: "statusCode", en: "Status", ar: "الحالة", kind: "status" },
      { field: "website", en: "Website", ar: "الموقع", secondary: true },
    ],
    detailFields: [{ field: "rationale", en: "Why", ar: "السبب" }],
  },

  COMPETITORS: {
    listOperationId: "get_competitors",
    idField: "id",
    kicker: { en: "Intelligence", ar: "معلومات السوق" },
    title: { en: "Competitors", ar: "المنافسون" },
    empty: { en: "No competitors recorded.", ar: "لا يوجد منافسون مسجلون." },
    searchable: true,
    columns: [
      { field: "name", en: "Competitor", ar: "المنافس" },
      { field: "countryCode", en: "Country", ar: "الدولة" },
      { field: "statusCode", en: "Status", ar: "الحالة", kind: "status" },
    ],
    detailFields: [
      { field: "strengths", en: "Strengths", ar: "نقاط القوة" },
      { field: "weaknesses", en: "Weaknesses", ar: "نقاط الضعف" },
      { field: "notes", en: "Notes", ar: "ملاحظات" },
    ],
  },

  WATCHLIST: {
    listOperationId: "get_watchlist",
    idField: "watchlistEntryId",
    kicker: { en: "Intelligence", ar: "معلومات السوق" },
    title: { en: "Watchlist", ar: "قائمة المتابعة" },
    empty: { en: "Your watchlist is empty.", ar: "قائمة المتابعة فارغة." },
    columns: [
      { field: "label", en: "Item", ar: "العنصر" },
      // The contract calls this `resourceType`; `resourceTypeCode` is the
      // audit log's field name and matched nothing here.
      { field: "resourceType", en: "Kind", ar: "النوع", kind: "status" },
      { field: "createdAt", en: "Added", ar: "أُضيف", kind: "date" },
    ],
  },

  REPEAT_BUSINESS: {
    listOperationId: "get_repeat_business_requests",
    idField: "id",
    kicker: { en: "Customers", ar: "العملاء" },
    title: { en: "Repeat business", ar: "أعمال متكررة" },
    sub: {
      en: "Customers asking to buy again on the same terms.",
      ar: "عملاء يطلبون الشراء مرة أخرى بنفس الشروط.",
    },
    empty: { en: "No repeat requests.", ar: "لا توجد طلبات متكررة." },
    searchable: true,
    columns: [
      { field: "subject", en: "Request", ar: "الطلب" },
      {
        field: "account.canonicalName",
        en: "Customer",
        ar: "العميل",
        href: (row) =>
          typeof row.accountId === "string"
            ? `/customers/${row.accountId}`
            : null,
      },
      { field: "statusCode", en: "Status", ar: "الحالة", kind: "status" },
      { field: "createdAt", en: "Raised", ar: "تاريخ الطلب", kind: "date" },
    ],
  },

  FINANCE_PAYMENTS: {
    listOperationId: "get_finance_payments",
    idField: "paymentId",
    kicker: { en: "Finance", ar: "المالية" },
    title: { en: "Payments", ar: "المدفوعات" },
    empty: { en: "No payments recorded.", ar: "لا توجد مدفوعات مسجلة." },
    searchable: true,
    // A payment has no reference of its own that a user ever sees: the
    // source key stays on the detail endpoint. The customer is what people
    // recognise a payment by, so it leads — never the payment UUID.
    columns: [
      {
        field: "accountName",
        en: "Customer",
        ar: "العميل",
        href: (row) =>
          typeof row.accountId === "string"
            ? `/customers/${row.accountId}`
            : null,
      },
      { field: "amount", en: "Amount", ar: "المبلغ", kind: "money" },
      {
        field: "paymentMethodCode",
        en: "Method",
        ar: "الطريقة",
        kind: "status",
      },
      { field: "statusCode", en: "Status", ar: "الحالة", kind: "status" },
      {
        field: "paymentDate",
        en: "Received",
        ar: "تاريخ الاستلام",
        kind: "date",
      },
    ],
  },

  FINANCE_PAYMENT: {
    listOperationId: "get_finance_payments",
    detailOperationId: "get_finance_payments_by_paymentId",
    idParam: "paymentId",
    idField: "paymentId",
    kicker: { en: "Finance", ar: "المالية" },
    title: { en: "Payment", ar: "الدفعة" },
    empty: { en: "No payments recorded.", ar: "لا توجد مدفوعات مسجلة." },
    columns: [
      {
        field: "accountName",
        en: "Customer",
        ar: "العميل",
        href: (row) =>
          typeof row.accountId === "string"
            ? `/customers/${row.accountId}`
            : null,
      },
      { field: "amount", en: "Amount", ar: "المبلغ", kind: "money" },
      {
        field: "paymentMethodCode",
        en: "Method",
        ar: "الطريقة",
        kind: "status",
      },
      { field: "statusCode", en: "Status", ar: "الحالة", kind: "status" },
      {
        field: "paymentDate",
        en: "Received",
        ar: "تاريخ الاستلام",
        kind: "date",
      },
    ],
  },

  FINANCE_CHEQUES: {
    listOperationId: "get_finance_cheques",
    idField: "chequeId",
    kicker: { en: "Finance", ar: "المالية" },
    title: { en: "Cheques", ar: "الشيكات" },
    empty: { en: "No cheques on file.", ar: "لا توجد شيكات." },
    searchable: true,
    // The endpoint returns `chequeNumber`, not `chequeRef` — the old column
    // name matched nothing, so every row showed a dash where its number
    // belongs. It went unnoticed because the table was empty.
    columns: [
      { field: "chequeNumber", en: "Cheque no.", ar: "رقم الشيك" },
      { field: "bankName", en: "Bank", ar: "البنك" },
      { field: "amount", en: "Amount", ar: "المبلغ", kind: "money" },
      { field: "dueDate", en: "Due", ar: "تاريخ الاستحقاق", kind: "date" },
      { field: "statusCode", en: "Status", ar: "الحالة", kind: "status" },
      {
        field: "issueDate",
        en: "Issued",
        ar: "تاريخ التحرير",
        kind: "date",
        secondary: true,
      },
    ],
    detailFields: [
      { field: "currencyCode", en: "Currency", ar: "العملة" },
      {
        field: "depositedAt",
        en: "Deposited",
        ar: "تاريخ الإيداع",
        kind: "date",
      },
      { field: "clearedAt", en: "Cleared", ar: "تاريخ التحصيل", kind: "date" },
      { field: "bouncedAt", en: "Bounced", ar: "تاريخ الارتداد", kind: "date" },
    ],
  },

  FINANCE_FX: {
    listOperationId: "get_finance_fx_rates",
    idField: "fxRateId",
    kicker: { en: "Finance", ar: "المالية" },
    title: { en: "Exchange rates", ar: "أسعار الصرف" },
    sub: {
      en: "Versioned rates. A superseded rate is kept so old documents still explain themselves.",
      ar: "أسعار مُصدّرة بإصدارات. السعر القديم محفوظ حتى تظل المستندات القديمة مفهومة.",
    },
    empty: { en: "No rates recorded.", ar: "لا توجد أسعار مسجلة." },
    columns: [
      { field: "baseCurrencyCode", en: "Base", ar: "الأساس" },
      { field: "quoteCurrencyCode", en: "Quote", ar: "المقابل" },
      { field: "rate", en: "Rate", ar: "السعر", kind: "number" },
      { field: "effectiveAt", en: "Effective", ar: "ساري من", kind: "date" },
      { field: "statusCode", en: "Status", ar: "الحالة", kind: "status" },
      {
        field: "versionNo",
        en: "Version",
        ar: "الإصدار",
        kind: "number",
        secondary: true,
      },
    ],
    detailFields: [
      { field: "sourceCode", en: "Source", ar: "المصدر", kind: "code" },
      { field: "reason", en: "Reason", ar: "السبب" },
    ],
  },

  LOGISTICS: {
    listOperationId: "get_logistics_plans",
    idField: "logisticsPlanId",
    kicker: { en: "Logistics", ar: "اللوجستيات" },
    title: { en: "Load plans", ar: "خطط التحميل" },
    empty: { en: "No load plans yet.", ar: "لا توجد خطط تحميل." },
    columns: [
      { field: "planRef", en: "Plan", ar: "الخطة" },
      { field: "sourceTypeCode", en: "For", ar: "لـ", kind: "code" },
      { field: "countryCode", en: "Country", ar: "الدولة" },
      { field: "statusCode", en: "Status", ar: "الحالة", kind: "status" },
    ],
  },

  // CAPACITY is no longer a record list: it is a calculator, in
  // CapacityPlannerPage. A list of estimates with no way to make one was a
  // table waiting for a screen.

  CAPACITY_ESTIMATE: {
    listOperationId: "get_capacity_estimates",
    detailOperationId: "get_capacity_estimates_by_estimateId",
    idParam: "estimateId",
    idField: "capacityEstimateId",
    kicker: { en: "Operations", ar: "التشغيل" },
    title: { en: "Capacity estimate", ar: "تقدير الطاقة" },
    empty: { en: "No estimates yet.", ar: "لا توجد تقديرات." },
    // A row here is an estimate *run*: the per-category figures live inside
    // its `items` array, so `categoryCode` / `boardsRequired` / `daysRequired`
    // were never fields on it and every column rendered a dash. These are the
    // run's own fields; the full breakdown is on the planner screen.
    columns: [
      {
        field: "sourceTypeCode",
        en: "Raised from",
        ar: "اتعمل من",
        kind: "status",
      },
      { field: "startAt", en: "Starts", ar: "يبدأ", kind: "date" },
      {
        field: "estimatedFinishAt",
        en: "Estimated finish",
        ar: "الانتهاء المتوقع",
        kind: "date",
      },
      {
        field: "createdAt",
        en: "Estimated on",
        ar: "اتحسب يوم",
        kind: "datetime",
      },
    ],
    detailFields: [
      {
        field: "items.0.categoryCode",
        en: "First category",
        ar: "أول فئة",
        kind: "status",
      },
      {
        field: "items.0.quantityBoards",
        en: "Boards",
        ar: "الألواح",
        kind: "number",
      },
      {
        field: "items.0.requiredDaysDecimal",
        en: "Days",
        ar: "الأيام",
        kind: "number",
      },
    ],
  },

  ADMIN_CAPACITY: {
    listOperationId: "get_capacity_rates",
    idField: "capacityRateId",
    kicker: { en: "Administration", ar: "الإدارة" },
    title: { en: "Capacity rates", ar: "معدلات الطاقة" },
    empty: { en: "No rates configured.", ar: "لا توجد معدلات." },
    columns: [
      { field: "categoryCode", en: "Category", ar: "الفئة", kind: "code" },
      {
        field: "boardsPerDay",
        en: "Boards / day",
        ar: "ألواح/يوم",
        kind: "number",
      },
      {
        field: "effectiveFrom",
        en: "Effective from",
        ar: "ساري من",
        kind: "date",
      },
      {
        field: "effectiveTo",
        en: "Effective to",
        ar: "ساري حتى",
        kind: "date",
      },
      {
        field: "sourceCode",
        en: "Source",
        ar: "المصدر",
        kind: "status",
        secondary: true,
      },
    ],
  },

  ADMIN_ROLES: {
    listOperationId: "get_admin_roles",
    idField: "roleId",
    kicker: { en: "Administration", ar: "الإدارة" },
    title: { en: "Roles", ar: "الأدوار" },
    empty: { en: "No roles.", ar: "لا توجد أدوار." },
    columns: [
      { field: "roleCode", en: "Role", ar: "الدور", kind: "status" },
      {
        field: "name",
        en: "Stored name",
        ar: "الاسم المخزّن",
        secondary: true,
      },
      {
        field: "isSystemProtected",
        en: "System",
        ar: "نظامي",
        kind: "boolean",
      },
    ],
  },

  ADMIN_SEGMENTS: {
    listOperationId: "get_customer_segments",
    idField: "segmentId",
    kicker: { en: "Administration", ar: "الإدارة" },
    title: { en: "Customer segments", ar: "قطاعات العملاء" },
    empty: { en: "No segments defined.", ar: "لا توجد قطاعات." },
    searchable: true,
    // The endpoint carries both languages on the row; `name` and
    // `segmentCode` were never fields it returned.
    columns: [
      { field: "displayNameEn", en: "Segment", ar: "القطاع (إنجليزي)" },
      { field: "displayNameAr", en: "Arabic name", ar: "القطاع" },
      { field: "code", en: "Code", ar: "الكود", kind: "code" },
      { field: "statusCode", en: "Status", ar: "الحالة", kind: "status" },
    ],
    detailFields: [
      { field: "createdAt", en: "Created", ar: "تاريخ الإنشاء", kind: "date" },
      {
        field: "archivedAt",
        en: "Archived",
        ar: "تاريخ الأرشفة",
        kind: "date",
      },
    ],
  },

  ADMIN_TEMPLATES: {
    listOperationId: "get_admin_document_templates",
    idField: "templateId",
    kicker: { en: "Administration", ar: "الإدارة" },
    title: { en: "Document templates", ar: "قوالب المستندات" },
    empty: { en: "No templates configured.", ar: "لا توجد قوالب." },
    // `templateCode` matched nothing: the endpoint returns `code`.
    columns: [
      { field: "name", en: "Template", ar: "القالب" },
      { field: "code", en: "Code", ar: "الكود", kind: "code" },
      {
        field: "documentTypeCode",
        en: "Used for",
        ar: "بيستخدم في",
        kind: "status",
      },
      { field: "languageCode", en: "Language", ar: "اللغة", kind: "code" },
      {
        field: "activeVersion.versionNo",
        en: "Live version",
        ar: "الإصدار الحالي",
        kind: "number",
      },
      { field: "statusCode", en: "Status", ar: "الحالة", kind: "status" },
    ],
    detailFields: [
      {
        field: "versionCount",
        en: "Versions",
        ar: "عدد الإصدارات",
        kind: "number",
      },
      { field: "brandCode", en: "Brand", ar: "العلامة", kind: "code" },
      { field: "updatedAt", en: "Updated", ar: "آخر تحديث", kind: "date" },
    ],
  },

  ADMIN_AUDIT: {
    listOperationId: "get_audit",
    idField: "auditEventId",
    kicker: { en: "Administration", ar: "الإدارة" },
    title: { en: "Audit trail", ar: "سجل التدقيق" },
    sub: {
      en: "What was done, by whom, and when.",
      ar: "ما تم، ومن قام به، ومتى.",
    },
    empty: { en: "No audit events.", ar: "لا توجد أحداث." },
    columns: [
      { field: "createdAt", en: "When", ar: "الوقت", kind: "datetime" },
      { field: "actionCode", en: "Action", ar: "الإجراء", kind: "code" },
      { field: "resourceTypeCode", en: "On", ar: "على", kind: "code" },
      {
        field: "actorTypeCode",
        en: "Actor type",
        ar: "نوع الفاعل",
        kind: "code",
      },
      { field: "reason", en: "Reason", ar: "السبب", secondary: true },
    ],
    detailFields: [
      { field: "actorUserId", en: "Actor", ar: "المستخدم" },
      { field: "resourceId", en: "Record", ar: "السجل" },
    ],
  },

  RECONCILIATION: {
    listOperationId: "get_reconciliation_runs",
    idField: "reconciliationRunId",
    kicker: { en: "Data", ar: "البيانات" },
    title: { en: "Reconciliation", ar: "المطابقة" },
    empty: {
      en: "No reconciliation has been run yet.",
      ar: "لسه مفيش مطابقة اتعملت.",
    },
    // There is no `runRef` and no `issueCount` on this row, and there is no
    // comparedCount/mismatchCount/matchedCount/missingCount either — those
    // four were bound here on the assumption that the summary held them, and
    // the run has never written any of them, so the screen showed four columns
    // of dashes. The summary is now typed in the contract and these are the
    // fields it actually carries.
    columns: [
      {
        field: "reconciliationTypeCode",
        en: "Compared",
        ar: "المقارنة",
        kind: "status",
      },
      { field: "statusCode", en: "Status", ar: "الحالة", kind: "status" },
      {
        field: "summaryJsonb.openDataQualityIssues",
        en: "Open issues found",
        ar: "مشاكل مفتوحة",
        kind: "number",
      },
      { field: "startedAt", en: "Run at", ar: "وقت التشغيل", kind: "datetime" },
      {
        field: "finishedAt",
        en: "Finished",
        ar: "وقت الانتهاء",
        kind: "datetime",
        secondary: true,
      },
    ],
    detailFields: [
      {
        field: "summaryJsonb.openDataQualityIssues",
        en: "Open issues found",
        ar: "مشاكل مفتوحة",
        kind: "number",
      },
      // Worth stating on the screen: a reconciliation run reports, it never
      // edits. Someone reading a list of differences will assume otherwise.
      {
        field: "summaryJsonb.mutationMode",
        en: "Changes written",
        ar: "تعديلات مكتوبة",
        kind: "status",
      },
      {
        field: "finishedAt",
        en: "Finished",
        ar: "وقت الانتهاء",
        kind: "datetime",
      },
    ],
  },

  RESEARCH: {
    listOperationId: "get_research_most_requested_sizes",
    idField: "productId",
    kicker: { en: "Intelligence", ar: "معلومات السوق" },
    title: { en: "Most requested sizes", ar: "أكثر المقاسات طلبًا" },
    sub: {
      en: "What customers actually ask for, by volume.",
      ar: "ما يطلبه العملاء فعليًا، حسب الحجم.",
    },
    empty: { en: "No demand data yet.", ar: "لا توجد بيانات طلب." },
    columns: [
      { field: "skuCode", en: "Product", ar: "المنتج", kind: "code" },
      {
        field: "totalRequestedQuantity",
        en: "Quantity requested",
        ar: "الكمية المطلوبة",
        kind: "number",
      },
      // Two customers asking for 1,000 each is a different signal from one
      // asking for 2,000, so the quotation count sits beside the volume.
      {
        field: "distinctOfficialQuotationCount",
        en: "Quotations",
        ar: "عروض الأسعار",
        kind: "number",
      },
    ],
  },

  ADMIN_COUNTRIES: {
    listOperationId: "get_reference_countries",
    idField: "countryCode",
    kicker: { en: "Administration", ar: "الإدارة" },
    title: { en: "Countries", ar: "الدول" },
    sub: {
      en: "Every record is scoped by country. A user who is not granted a country cannot see anything in it.",
      ar: "كل سجل مرتبط بدولة. المستخدم بدون صلاحية دولة لا يرى شيئًا فيها.",
    },
    empty: { en: "No countries.", ar: "لا توجد دول." },
    columns: [
      { field: "displayName", en: "Country", ar: "الدولة" },
      { field: "countryCode", en: "Code", ar: "الكود" },
      { field: "continent", en: "Continent", ar: "القارة", kind: "code" },
      { field: "marketScope", en: "Market", ar: "السوق", kind: "code" },
    ],
  },

  ADMIN_POLICIES: {
    listOperationId: "get_payment_terms",
    idField: "paymentTermId",
    kicker: { en: "Administration", ar: "الإدارة" },
    title: { en: "Payment terms", ar: "شروط الدفع" },
    sub: {
      en: "The terms a quotation can offer. Tax policies and pricing guardrails are set alongside these.",
      ar: "الشروط التي يمكن لعرض السعر تقديمها. سياسات الضرائب وحدود التسعير تُضبط معها.",
    },
    empty: { en: "No payment terms configured.", ar: "لا توجد شروط دفع." },
    columns: [
      { field: "displayText", en: "Term", ar: "الشرط" },
      { field: "termCode", en: "Code", ar: "الكود", kind: "code" },
      {
        field: "effectiveFrom",
        en: "In force from",
        ar: "سارٍ من",
        kind: "date",
      },
      { field: "isActive", en: "Active", ar: "مفعّل", kind: "boolean" },
    ],
  },
  ADMIN_DQ: {
    listOperationId: "get_data_quality_issues",
    idField: "issueId",
    kicker: { en: "Administration", ar: "الإدارة" },
    title: {
      en: "Data quality rules & mappings",
      ar: "قواعد وربط جودة البيانات",
    },
    sub: {
      en: "What the importers flagged and could not decide on their own. Each row is a record the system refused to guess about.",
      ar: "ما رصدته عمليات الاستيراد ولم تستطع البت فيه. كل صف سجل رفض النظام أن يخمّن بشأنه.",
    },
    empty: {
      en: "Nothing flagged — every imported record resolved cleanly.",
      ar: "لا توجد ملاحظات — كل السجلات المستوردة تمت مطابقتها.",
    },
    searchable: true,
    columns: [
      { field: "issueCode", en: "Issue", ar: "الملاحظة", kind: "status" },
      { field: "severityCode", en: "Severity", ar: "الخطورة", kind: "status" },
      { field: "sourceEntityCode", en: "Entity", ar: "الكيان", kind: "status" },
      { field: "sourceRecordKey", en: "Record", ar: "السجل", kind: "code" },
      { field: "statusCode", en: "Status", ar: "الحالة", kind: "status" },
      {
        field: "createdAt",
        en: "Flagged",
        ar: "تاريخ الرصد",
        kind: "date",
        secondary: true,
      },
    ],
    detailFields: [
      { field: "message", en: "Detail", ar: "التفاصيل" },
      { field: "resolutionCode", en: "Resolution", ar: "القرار" },
      { field: "resolvedAt", en: "Resolved", ar: "تاريخ الحسم", kind: "date" },
      { field: "importJobId", en: "Import job", ar: "عملية الاستيراد" },
    ],
  },
  ADMIN_CLIENT_IDENTITIES: {
    listOperationId: "get_admin_client_identities",
    idField: "clientIdentityId",
    kicker: { en: "Administration", ar: "الإدارة" },
    title: { en: "Client portal access", ar: "صلاحيات بوابة العملاء" },
    sub: {
      en: "Who can sign in to the customer portal, and which customers each one is allowed to see.",
      ar: "مَن يستطيع الدخول لبوابة العملاء، وأي عملاء يُسمح له بالاطلاع عليهم.",
    },
    empty: {
      en: "No portal identities provisioned yet.",
      ar: "لم يتم تفعيل أي هوية بوابة بعد.",
    },
    columns: [
      { field: "displayName", en: "Client", ar: "العميل" },
      { field: "email", en: "Email", ar: "البريد" },
      { field: "statusCode", en: "Status", ar: "الحالة", kind: "status" },
      {
        field: "activeBindingCount",
        en: "Customers",
        ar: "العملاء",
        kind: "number",
      },
      {
        field: "provisionedAt",
        en: "Provisioned",
        ar: "تاريخ التفعيل",
        kind: "date",
        secondary: true,
      },
    ],
    detailFields: [
      { field: "issuer", en: "Issuer", ar: "الجهة المصدرة" },
      { field: "subject", en: "Subject", ar: "المعرّف" },
    ],
  },
  ADMIN_FORMULAS: {
    listOperationId: "get_pricing_calculation_formulas",
    idField: "formulaKey",
    kicker: { en: "Administration", ar: "الإدارة" },
    title: { en: "Pricing rules", ar: "قواعد التسعير" },
    sub: {
      en: "ACROW does not only sell by the kilogram. Each rule is an expression evaluated over the line's own dimensions.",
      ar: "أكرو لا تبيع بالكيلو فقط. كل قاعدة معادلة تُحسب على أبعاد البند نفسه.",
    },
    empty: {
      en: "No pricing rules yet — every line is priced by weight.",
      ar: "لا توجد قواعد تسعير — كل البنود تُسعّر بالوزن.",
    },
    searchable: true,
    columns: [
      { field: "displayName", en: "Rule", ar: "القاعدة" },
      { field: "expression", en: "Expression", ar: "المعادلة", kind: "code" },
      { field: "rateUnitLabel", en: "Rate unit", ar: "وحدة السعر" },
      { field: "statusCode", en: "Status", ar: "الحالة", kind: "status" },
    ],
    detailFields: [
      { field: "formulaKey", en: "Key", ar: "المفتاح" },
      { field: "description", en: "Description", ar: "الوصف" },
      { field: "arabicLabel", en: "Arabic label", ar: "الاسم بالعربية" },
    ],
  },
};
