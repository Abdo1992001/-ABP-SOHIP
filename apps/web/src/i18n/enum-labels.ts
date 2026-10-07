export type ChipTone = "ok" | "warn" | "danger" | "info" | "violet" | "neutral";

type EnumEntry = { en: string; ar: string; tone: ChipTone };

export const ENUM_LABELS: Readonly<Record<string, EnumEntry>> = {
  /*
   * Why a governed metric has no figure.
   *
   * The analytics cards print the metric's `basis`, and for a metric that
   * could not be computed the basis is the reason code. So a manager opening
   * Reporting read "ZERO_TARGET_DENOMINATOR" under a figure that was not
   * there, which says nothing about what to do. Each of these says what is
   * missing and, where there is one, what would fix it.
   */
  UNAVAILABLE: {
    en: "The figure could not be computed.",
    ar: "مش ممكن نحسب الرقم ده.",
    tone: "neutral",
  },
  COMPANY_TARGET_NOT_CONFIGURED: {
    en: "No company target is set for this year.",
    ar: "مفيش هدف للشركة متسجّل للسنة دي.",
    tone: "warn",
  },
  TARGET_ALLOCATION_NOT_CONFIGURED: {
    en: "The year's target has not been split across the periods.",
    ar: "هدف السنة لسه مش متوزّع على الفترات.",
    tone: "warn",
  },
  ZERO_TARGET_DENOMINATOR: {
    en: "The target is zero, so there is nothing to measure against.",
    ar: "الهدف صفر، فمفيش حاجة نقيس عليها.",
    tone: "neutral",
  },
  ZERO_SENT_DENOMINATOR: {
    en: "No quotation has been sent in this period.",
    ar: "مفيش عرض سعر اتبعت في الفترة دي.",
    tone: "neutral",
  },
  ZERO_OPEN_OPPORTUNITIES: {
    en: "No opportunity is open in this period.",
    ar: "مفيش فرصة مفتوحة في الفترة دي.",
    tone: "neutral",
  },
  ZERO_CUSTOMERS: {
    en: "No customer falls inside this filter.",
    ar: "مفيش عميل داخل الفلتر ده.",
    tone: "neutral",
  },
  ZERO_LIVE_COHORT: {
    en: "No live cohort to compare against.",
    ar: "مفيش مجموعة نشطة نقارن بيها.",
    tone: "neutral",
  },
  ZERO_MATCHED_PRICED_LINES: {
    en: "No priced line matched this selection.",
    ar: "مفيش بند مسعّر مطابق للاختيار ده.",
    tone: "neutral",
  },
  ZERO_IMPORTED_ITEM_VALUES: {
    en: "The imported items carry no values to read.",
    ar: "البنود المستوردة مفيهاش قيم نقراها.",
    tone: "neutral",
  },
  FX_RATE_NOT_AVAILABLE: {
    en: "No exchange rate is on file for this date.",
    ar: "مفيش سعر صرف متسجّل للتاريخ ده.",
    tone: "warn",
  },
  CUSTOMER_SELECTION_REQUIRED: {
    en: "Choose a customer to see this figure.",
    ar: "اختار عميل عشان تشوف الرقم ده.",
    tone: "info",
  },
  STAGE_PAIR_FILTER_REQUIRED: {
    en: "Choose the two stages to compare.",
    ar: "اختار المرحلتين اللي هتقارن بينهم.",
    tone: "info",
  },
  NO_RULE_SCORE_OUTPUT: {
    en: "No scoring rule produced an output.",
    ar: "مفيش قاعدة تقييم طلعت نتيجة.",
    tone: "neutral",
  },
  UNKNOWN_PRODUCT_METRIC: {
    en: "This product metric is not in the registry.",
    ar: "المؤشر ده مش موجود في سجل المنتجات.",
    tone: "danger",
  },
  UNKNOWN_PRICE_METRIC: {
    en: "This price metric is not in the registry.",
    ar: "المؤشر ده مش موجود في سجل الأسعار.",
    tone: "danger",
  },
  PRODUCT_THICKNESS_NOT_POPULATED: {
    en: "The products have no thickness recorded.",
    ar: "المنتجات مفيهاش سُمك متسجّل.",
    tone: "warn",
  },
  PRODUCT_BOARD_TYPE_NOT_CLASSIFIED: {
    en: "The products have not been classified by board type.",
    ar: "المنتجات لسه متصنّفتش حسب نوع اللوح.",
    tone: "warn",
  },
  PRODUCT_FORMWORK_CLASSIFICATION_NOT_CAPTURED: {
    en: "The formwork classification has not been captured.",
    ar: "تصنيف الفورم ورك لسه مأخدش.",
    tone: "warn",
  },
  STRATEGIC: { en: "Strategic", ar: "استراتيجي", tone: "violet" },
  ENTERPRISE: { en: "Enterprise", ar: "مؤسسي", tone: "info" },
  MID_MARKET: { en: "Mid-market", ar: "سوق متوسط", tone: "neutral" },
  SMB: { en: "SMB", ar: "منشآت صغيرة", tone: "neutral" },
  OVERDUE: { en: "Overdue", ar: "متأخر", tone: "danger" },
  TODAY: { en: "Today", ar: "اليوم", tone: "warn" },
  UPCOMING: { en: "Upcoming", ar: "قادم", tone: "info" },
  FOLLOW_UP: { en: "Follow-up", ar: "متابعة", tone: "neutral" },
  MEETING: { en: "Meeting", ar: "اجتماع", tone: "neutral" },
  CALL: { en: "Call", ar: "اتصال", tone: "neutral" },
  SITE_VISIT: { en: "Site visit", ar: "زيارة موقع", tone: "info" },
  WHATSAPP: { en: "WhatsApp", ar: "واتساب", tone: "ok" },
  EMAIL: { en: "Email", ar: "إيميل", tone: "neutral" },
  // Contact channel kinds. These are read beside a phone number, so the
  // label is what somebody would call it, not the stored code.
  MOBILE: { en: "Mobile", ar: "موبايل", tone: "neutral" },
  PHONE: { en: "Phone", ar: "تليفون", tone: "neutral" },
  LANDLINE: { en: "Landline", ar: "أرضي", tone: "neutral" },
  FAX: { en: "Fax", ar: "فاكس", tone: "neutral" },
  OTHER: { en: "Other", ar: "أخرى", tone: "neutral" },
  // A reconciliation run's mutation mode. Printed next to a list of
  // differences, where the reader's first question is whether anything was
  // changed on their behalf — so the answer is spelled out, not left as
  // "NONE".
  NONE: { en: "None — report only", ar: "لا شيء — تقرير فقط", tone: "neutral" },

  // Shipment stages, in the vocabulary the shipment records themselves use.
  VESSEL_DEPARTED: { en: "Vessel departed", ar: "الباخرة سافرت", tone: "info" },
  ARRIVED_AT_PORT_OF_DISCHARGE: {
    en: "At discharge port",
    ar: "في ميناء التفريغ",
    tone: "info",
  },
  READY_FOR_DELIVERY: {
    en: "Ready for delivery",
    ar: "جاهزة للتسليم",
    tone: "ok",
  },

  // Cheque states. A bounced cheque is the row a credit controller opens the
  // screen to find, so it is the one that has to read as bad at a glance.
  RECEIVED: { en: "Received", ar: "مستلم", tone: "neutral" },
  DEPOSITED: { en: "Deposited", ar: "مودع", tone: "info" },
  CLEARED: { en: "Cleared", ar: "محصّل", tone: "ok" },

  // Reconciliation findings: what disagreed between the CRM and the ERP.
  AMOUNT_MISMATCH: {
    en: "Amount mismatch",
    ar: "اختلاف في المبلغ",
    tone: "danger",
  },
  STATUS_MISMATCH: {
    en: "Status mismatch",
    ar: "اختلاف في الحالة",
    tone: "warn",
  },
  MISSING_IN_CRM: { en: "Missing in CRM", ar: "ناقص في الـCRM", tone: "warn" },

  // Customer segments.
  KEY_ACCOUNT: { en: "Key account", ar: "حساب رئيسي", tone: "violet" },
  CONTRACTOR: { en: "Contractor", ar: "مقاول", tone: "neutral" },
  RENTAL: { en: "Rental company", ar: "شركة تأجير", tone: "neutral" },
  EXPORT: { en: "Export", ar: "تصدير", tone: "info" },
  NEW_BUSINESS: { en: "New business", ar: "عميل جديد", tone: "ok" },

  // Quotation adjustments and how a payment was applied.
  DISCOUNT: { en: "Discount", ar: "خصم", tone: "warn" },
  PERCENT: { en: "Percentage", ar: "نسبة", tone: "neutral" },
  FIXED_AMOUNT: { en: "Fixed amount", ar: "مبلغ ثابت", tone: "neutral" },
  PART_PAYMENT: { en: "Part payment", ar: "دفعة جزئية", tone: "warn" },
  FULL_SETTLEMENT: { en: "Settled in full", ar: "سداد كامل", tone: "ok" },

  // Document kinds and where a record came from.
  QUOTATION: { en: "Quotation", ar: "عرض سعر", tone: "neutral" },
  PROFORMA: { en: "Proforma invoice", ar: "فاتورة مبدئية", tone: "neutral" },
  CONTRACT: { en: "Contract", ar: "عقد", tone: "neutral" },
  MANUAL: { en: "Entered by hand", ar: "إدخال يدوي", tone: "neutral" },

  // Who a company is on a construction site. These appear as a chip beside
  // the company name, so they read as the site would say them.
  DEVELOPER: { en: "Developer", ar: "المالك / المطوّر", tone: "violet" },
  MAIN_CONTRACTOR: {
    en: "Main contractor",
    ar: "المقاول الرئيسي",
    tone: "info",
  },
  SUBCONTRACTOR: { en: "Subcontractor", ar: "مقاول الباطن", tone: "neutral" },
  CONSULTANT: { en: "Consultant", ar: "الاستشاري", tone: "neutral" },

  // And what a person does on it, which is not their job title.
  SITE_ENGINEER: { en: "Site engineer", ar: "مهندس الموقع", tone: "neutral" },
  PROJECT_MANAGER: { en: "Project manager", ar: "مدير المشروع", tone: "info" },
  PROCUREMENT: { en: "Procurement", ar: "المشتريات", tone: "neutral" },
  TECHNICAL_OFFICE: {
    en: "Technical office",
    ar: "المكتب الفني",
    tone: "neutral",
  },
  SITE_FOREMAN: { en: "Foreman", ar: "المشرف", tone: "neutral" },
  // Board categories, which the capacity rates and the pricing basis both
  // key off. Without these the Arabic screen printed "Standard" in Latin.
  STANDARD: { en: "Standard", ar: "ستاندرد", tone: "neutral" },
  ORDINARY: { en: "Ordinary", ar: "عادي", tone: "neutral" },
  CURVED: { en: "Curved", ar: "منحني", tone: "info" },
  // How much of a customer a share grant covers. These read as a chip next
  // to the colleague's name, so the narrow one must look narrow.
  CONTACT_ONLY: { en: "Contacts only", ar: "جهات الاتصال بس", tone: "neutral" },
  CUSTOMER_CONTACTS: {
    en: "Customer and contacts",
    ar: "العميل وجهات الاتصال",
    tone: "info",
  },
  COMMERCIAL_WORKSPACE: {
    en: "Full workspace",
    ar: "مساحة العمل كاملة",
    tone: "violet",
  },
  REVOKED: { en: "Revoked", ar: "مسحوبة", tone: "danger" },
  CIRCULAR: { en: "Circular", ar: "دائري", tone: "violet" },
  REVIEW: { en: "Review", ar: "مراجعة", tone: "neutral" },
  // Opportunity commercial stages. Separate from a quotation's document status:
  // a deal is won or lost, a document is drafted, sent or superseded.
  // The funnel the dashboard draws, from the handoff's own label table.
  // Negotiation is violet there, alongside Strategic: both mean "this one
  // needs a person, not a process".
  PROSPECT: { en: "Prospect", ar: "استكشاف", tone: "neutral" },
  QUALIFIED: { en: "Qualified", ar: "مؤهل", tone: "info" },
  PROPOSAL: { en: "Proposal", ar: "عرض", tone: "info" },
  NEGOTIATION: { en: "Negotiation", ar: "تفاوض", tone: "violet" },
  NEW_LEAD: { en: "New lead", ar: "عميل محتمل", tone: "neutral" },
  HOT_LEAD: { en: "Hot lead", ar: "فرصة ساخنة", tone: "warn" },
  UNDER_NEGOTIATION: {
    en: "Under negotiation",
    ar: "قيد التفاوض",
    tone: "violet",
  },
  SUPERSEDED: { en: "Superseded", ar: "مستبدل", tone: "neutral" },
  WON: { en: "Won", ar: "مكسوبة", tone: "ok" },
  LOST: { en: "Lost", ar: "خاسرة", tone: "danger" },
  DRAFT: { en: "Draft", ar: "مسودة", tone: "neutral" },
  READY: { en: "Ready", ar: "جاهز", tone: "warn" },
  READY_NOT_SUBMITTED: {
    en: "Ready · Not submitted",
    ar: "جاهز · لم يُرسل",
    tone: "warn",
  },
  NOT_SUBMITTED: { en: "Not submitted", ar: "لم يُرسل", tone: "warn" },
  SUBMITTED: { en: "Submitted", ar: "مُرسل", tone: "info" },
  APPROVED: { en: "Approved", ar: "معتمد", tone: "ok" },
  SENT: { en: "Sent", ar: "أُرسل", tone: "info" },
  EXPIRED: { en: "Expired", ar: "منتهي", tone: "danger" },
  CONFIRMED: { en: "Confirmed", ar: "مؤكد", tone: "ok" },
  IN_PREPARATION: { en: "In preparation", ar: "قيد التجهيز", tone: "warn" },
  SHIPPED: { en: "Shipped", ar: "تم الشحن", tone: "info" },
  // Customer orders, between confirmation and hand-over.
  IN_PRODUCTION: { en: "In production", ar: "في الإنتاج", tone: "warn" },
  HANDED_OVER: { en: "Handed over", ar: "اتسلّم", tone: "ok" },
  // Receivable installments.
  PARTIAL: { en: "Partly paid", ar: "مدفوع جزئيًا", tone: "info" },
  PAID: { en: "Paid", ar: "مدفوع", tone: "ok" },
  WRITTEN_OFF: { en: "Written off", ar: "معدوم", tone: "neutral" },
  // Shipment steps.
  POD_RECEIVED: { en: "POD received", ar: "إثبات التسليم وصل", tone: "ok" },
  // Work orders.
  PLANNED: { en: "Planned", ar: "متخطط", tone: "neutral" },
  RELEASED: { en: "Released", ar: "اتسلّم للمصنع", tone: "info" },
  QC: { en: "Quality check", ar: "فحص الجودة", tone: "violet" },
  // The complaint route.
  OPERATIONS_REVIEW: {
    en: "Operations review",
    ar: "مراجعة العمليات",
    tone: "info",
  },
  QUALITY_REVIEW: { en: "Quality review", ar: "مراجعة الجودة", tone: "violet" },
  SOLUTION: { en: "Solution", ar: "الحل", tone: "warn" },
  TRANSFER: { en: "Bank transfer", ar: "تحويل بنكي", tone: "neutral" },
  CARD: { en: "Card", ar: "كارت", tone: "neutral" },
  CANCELLED: { en: "Cancelled", ar: "ملغى", tone: "danger" },
  // A load optimiser run. It answers 202 and finishes later, so these are
  // read while someone is waiting — "Queued" has to mean something to them,
  // not just to the queue.
  QUEUED: { en: "Waiting to start", ar: "مستنية تبدأ", tone: "neutral" },
  RUNNING: { en: "Running", ar: "بتشتغل", tone: "info" },
  SUCCEEDED: { en: "Done", ar: "خلصت", tone: "ok" },
  FAILED: { en: "Failed", ar: "فشلت", tone: "danger" },
  COLLECTED: { en: "Collected", ar: "محصّل", tone: "ok" },
  // How the money arrived. Free text in the schema, so these are the codes
  // the system actually writes; an unknown one still renders as its code.
  BANK_TRANSFER: { en: "Bank transfer", ar: "تحويل بنكي", tone: "info" },
  CASH: { en: "Cash", ar: "نقدًا", tone: "neutral" },

  // Two-step verification, as the security screen states it.
  ENABLED: { en: "Enabled", ar: "مفعّل", tone: "ok" },
  REQUIRED: { en: "Setup required", ar: "مطلوب التفعيل", tone: "warn" },
  DISABLED: { en: "Not enabled", ar: "غير مفعّل", tone: "neutral" },
  CHEQUE: { en: "Cheque", ar: "شيك", tone: "neutral" },

  // Who a person is in the system. These appear on the roles screen and in
  // the role switcher, where the raw code was being read out as-is.
  SYSTEM_ADMIN: {
    en: "System administrator",
    ar: "مسؤول النظام",
    tone: "violet",
  },
  SALES_MANAGER: { en: "Sales manager", ar: "مدير مبيعات", tone: "info" },
  SALES_REP: {
    en: "Sales representative",
    ar: "مندوب مبيعات",
    tone: "neutral",
  },
  SALES_SUPPORT: { en: "Sales support", ar: "دعم المبيعات", tone: "neutral" },
  FINANCE_ANALYST: { en: "Finance analyst", ar: "محلل مالي", tone: "neutral" },
  LOGISTICS_COORDINATOR: {
    en: "Logistics coordinator",
    ar: "منسق لوجيستيات",
    tone: "neutral",
  },
  OPERATIONS_ANALYST: {
    en: "Operations analyst",
    ar: "محلل تشغيل",
    tone: "neutral",
  },
  R_AND_D: {
    en: "Research & development",
    ar: "البحث والتطوير",
    tone: "neutral",
  },

  // What a payment term actually says. NET_30 is not a sentence.
  CASH_IN_ADVANCE: { en: "Cash in advance", ar: "دفع مقدم", tone: "ok" },
  ADVANCE_50_BALANCE_ON_DELIVERY: {
    en: "50% advance, balance on delivery",
    ar: "٥٠٪ مقدم والباقي عند التسليم",
    tone: "info",
  },
  LC_AT_SIGHT: {
    en: "Letter of credit at sight",
    ar: "اعتماد مستندي بالاطلاع",
    tone: "info",
  },
  NET_30: { en: "Net 30 days", ar: "صافي ٣٠ يومًا", tone: "neutral" },
  NET_60: { en: "Net 60 days", ar: "صافي ٦٠ يومًا", tone: "warn" },
  NET_90: { en: "Net 90 days", ar: "صافي ٩٠ يومًا", tone: "danger" },

  // What an import feed carries.
  ERP_ORDERS: { en: "ERP orders", ar: "أوامر ERP", tone: "neutral" },
  ERP_ORDER: { en: "ERP order", ar: "أمر ERP", tone: "neutral" },
  SALES_ORDER_HISTORY: {
    en: "Sales order history",
    ar: "تاريخ أوامر البيع",
    tone: "neutral",
  },
  ITEM_MASTER: { en: "Item master", ar: "دليل الأصناف", tone: "neutral" },
  SALES_ORDERS: { en: "Sales orders", ar: "أوامر البيع", tone: "neutral" },
  CUSTOMERS: { en: "Customers", ar: "العملاء", tone: "neutral" },
  FINANCE: { en: "Finance", ar: "المالية", tone: "neutral" },
  COMMITTED: { en: "Committed", ar: "معتمد", tone: "ok" },
  MASTER_SPECIFICATION_V3: {
    en: "Master specification v3",
    ar: "المواصفة الرئيسية ٣",
    tone: "neutral",
  },

  // What the importers refused to guess about.
  GROUP_AFFILIATE_DETECTED: {
    en: "Possible group affiliate",
    ar: "احتمال شركة تابعة للمجموعة",
    tone: "warn",
  },
  ORDER_DATE_MISSING: {
    en: "Order date missing",
    ar: "تاريخ الأمر ناقص",
    tone: "warn",
  },
  NON_PRODUCT_ITEM: {
    en: "Not a product line",
    ar: "بند غير منتج",
    tone: "neutral",
  },
  ITEM_NOT_IN_MASTER: {
    en: "Item not in the master list",
    ar: "الصنف غير موجود في الدليل",
    tone: "danger",
  },
  CLEARING: { en: "Clearing", ar: "قيد المقاصة", tone: "warn" },
  BOUNCED: { en: "Bounced", ar: "مرتجع", tone: "danger" },
  IN_TRANSIT: { en: "In transit", ar: "في الطريق", tone: "info" },
  DELIVERED: { en: "Delivered", ar: "تم التسليم", tone: "ok" },
  ON_HOLD: { en: "On hold", ar: "مُعلَّق", tone: "danger" },
  LOW: { en: "Low", ar: "منخفضة", tone: "neutral" },
  MEDIUM: { en: "Medium", ar: "متوسطة", tone: "warn" },
  HIGH: { en: "High", ar: "عالية", tone: "danger" },
  CRITICAL: { en: "Critical", ar: "حرجة", tone: "danger" },
  ACTIVE: { en: "Active", ar: "نشط", tone: "ok" },
  ARCHIVED: { en: "Archived", ar: "مؤرشف", tone: "neutral" },
  PENDING: { en: "Pending", ar: "قيد الانتظار", tone: "warn" },
  PENDING_APPROVAL: {
    en: "Pending approval",
    ar: "بانتظار الموافقة",
    tone: "warn",
  },
  OPEN: { en: "Open", ar: "مفتوحة", tone: "warn" },
  COMPLETED: { en: "Completed", ar: "مكتملة", tone: "ok" },
  IN_REVIEW: { en: "In review", ar: "قيد المراجعة", tone: "info" },
  IN_PROGRESS: { en: "In progress", ar: "قيد التنفيذ", tone: "info" },
  DELIVERY: { en: "Delivery", ar: "التسليم", tone: "neutral" },
  DELIVERY_DELAY: {
    en: "Delivery delay",
    ar: "تأخير التسليم",
    tone: "neutral",
  },
  RESOLVED: { en: "Resolved", ar: "تم الحل", tone: "ok" },
  CLOSED: { en: "Closed", ar: "مغلقة", tone: "neutral" },
  FINALIZED: { en: "Finalized", ar: "منتهي", tone: "ok" },
  REJECTED: { en: "Rejected", ar: "مرفوض", tone: "danger" },
  AVAILABLE: { en: "Available", ar: "متوفر", tone: "ok" },
  OUT_OF_STOCK: { en: "Out of stock", ar: "غير متوفر", tone: "danger" },
  LOW_STOCK: { en: "Low stock", ar: "مخزون منخفض", tone: "warn" },
  AFRICA: { en: "Africa", ar: "أفريقيا", tone: "neutral" },
  ASIA: { en: "Asia", ar: "آسيا", tone: "neutral" },
  EUROPE: { en: "Europe", ar: "أوروبا", tone: "neutral" },
  NORTH_AMERICA: {
    en: "North America",
    ar: "أمريكا الشمالية",
    tone: "neutral",
  },
  SOUTH_AMERICA: {
    en: "South America",
    ar: "أمريكا الجنوبية",
    tone: "neutral",
  },
  OCEANIA: { en: "Oceania", ar: "أوقيانوسيا", tone: "neutral" },
  ANTARCTICA: {
    en: "Antarctica",
    ar: "القارة القطبية الجنوبية",
    tone: "neutral",
  },
  LOCAL: { en: "Local", ar: "محلي", tone: "neutral" },
  REGIONAL: { en: "Regional", ar: "إقليمي", tone: "info" },
  GLOBAL: { en: "Global", ar: "عالمي", tone: "violet" },
};

/** Maps a raw enum code to a localized, human-readable label. Falls back to a
 * title-cased version of the code itself when no mapping is registered, so a
 * new backend status never renders as literal SCREAMING_CASE. */
export function enumLabel(
  code: string | null | undefined,
  locale: "en" | "ar",
): string {
  if (!code) return "—";
  const entry = ENUM_LABELS[code];
  if (entry) return locale === "ar" ? entry.ar : entry.en;
  return code
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/^./, (letter) => letter.toUpperCase());
}

export function enumTone(code: string | null | undefined): ChipTone {
  if (!code) return "neutral";
  return ENUM_LABELS[code]?.tone ?? "neutral";
}
