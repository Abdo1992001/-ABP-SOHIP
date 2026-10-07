import { createContext, useContext, useEffect, useMemo, useState } from "react";

export type Locale = "en" | "ar";

const messages = {
  en: {
    loading: "Loading authorized data…",
    unavailable: "This data is temporarily unavailable.",
    notFound: "No configured record is available yet.",
    retry: "Retry",
    empty: "No results found.",
    accessDenied: "Access denied",
    accessDeniedNote: "Your current permissions do not allow this screen.",
    sales: "Sales core",
    controlled: "Controlled workspaces",
    administration: "Administration",
    selfService: "My workspace",
    countryScope: "Country Scope enforced",
    language: "العربية",
    refresh: "Refresh",
    actions: "Available actions",
    execute: "Confirm",
    cancel: "Cancel",
    requestBody: "Details",
    pathParameters: "Linked references",
    ifMatch: "If-Match / row version",
    conflict:
      "This information changed. Reload the current version before retrying.",
    queued: "Request accepted. Track its real job state below.",
    noFakeKpi: "Semantic metrics are rendered only from the server contract.",
    signedInAs: "Signed in as",
    menu: "Menu",
    brandSystem: "Commercial system",
    close: "Close",
    search: "Search",
    commandHelp: "Search customers, projects, quotations…",
    workflow: "Workflow status",
    correlation: "Reference",
    invalidJson: "Enter valid JSON before submitting.",
  },
  ar: {
    loading: "جارٍ تحميل البيانات المصرح بها…",
    unavailable: "هذه البيانات غير متاحة مؤقتًا.",
    notFound: "لا يوجد سجل مُعدّ بعد.",
    retry: "إعادة المحاولة",
    empty: "لا توجد سجلات مصرح بها.",
    accessDenied: "غير مصرح بالدخول",
    accessDeniedNote: "صلاحياتك الحالية لا تسمح بعرض هذه الشاشة.",
    sales: "مركز المبيعات",
    controlled: "مساحات العمل المحكومة",
    administration: "الإدارة",
    selfService: "مساحتي",
    countryScope: "نطاق الدول مطبق",
    language: "English",
    refresh: "تحديث",
    actions: "الإجراءات المتاحة",
    execute: "تنفيذ",
    cancel: "إلغاء",
    requestBody: "التفاصيل",
    pathParameters: "معرفات المورد",
    ifMatch: "نسخة السجل / If-Match",
    conflict: "تم تعديل السجل. حمّل النسخة الحالية قبل إعادة المحاولة.",
    queued: "تم قبول الطلب. تابع حالة المهمة الحقيقية أدناه.",
    noFakeKpi: "لا تظهر المؤشرات إلا من عقد الخادم المعتمد.",
    signedInAs: "مسجل باسم",
    menu: "القائمة",
    brandSystem: "النظام التجاري",
    close: "إغلاق",
    search: "بحث في التنقل",
    commandHelp: "اضغط Ctrl+K للبحث في الشاشات المصرح بها.",
    workflow: "حالة سير العمل",
    correlation: "المرجع",
    invalidJson: "أدخل JSON صحيحًا قبل التنفيذ.",
  },
} as const;

type MessageKey = keyof (typeof messages)["en"];
interface I18nValue {
  locale: Locale;
  direction: "ltr" | "rtl";
  t: (key: MessageKey) => string;
  toggle: () => void;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocale] = useState<Locale>(() => {
    const saved = window.localStorage.getItem("abp.locale");
    return saved === "ar" ? "ar" : "en";
  });
  const direction = locale === "ar" ? "rtl" : "ltr";
  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = direction;
    window.localStorage.setItem("abp.locale", locale);
  }, [direction, locale]);
  const value = useMemo<I18nValue>(
    () => ({
      locale,
      direction,
      t: (key) => messages[locale][key],
      toggle: () => {
        setLocale((current) => (current === "en" ? "ar" : "en"));
      },
    }),
    [direction, locale],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  return (
    value ?? {
      locale: "en",
      direction: "ltr",
      t: (key) => messages.en[key],
      toggle: () => undefined,
    }
  );
}
