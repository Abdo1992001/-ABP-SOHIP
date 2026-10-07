import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Alert,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  salesApi,
  type Account,
  type ActionItem,
  type Activity,
  type Me,
  type Notification,
  type Opportunity,
  type Quotation,
} from "./api";
import {
  ActionButton,
  Card,
  DetailSheet,
  LabelValue,
  LoadingState,
  MessageState,
  Money,
  Page,
  Pill,
  ScreenTitle,
  SearchField,
  humanize,
  rowDirection,
  rtlText,
  shortDate,
  styles as ui,
  tr,
  type Locale,
  usePalette,
} from "./ui";

type CommonProps = { locale: Locale; me: Me };

function useDebounced(value: string, delay = 350) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const handle = setTimeout(() => {
      setDebounced(value);
    }, delay);
    return () => {
      clearTimeout(handle);
    };
  }, [delay, value]);
  return debounced;
}

function errorText(error: unknown, locale: Locale) {
  if (error instanceof Error) return error.message;
  return tr(locale, "حصل خطأ غير متوقع.", "Something went wrong.");
}

function ListLayout({
  title,
  subtitle,
  locale,
  search,
  setSearch,
  children,
}: {
  title: string;
  subtitle?: string;
  locale: Locale;
  search: string;
  setSearch: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <Page>
      <ScreenTitle title={title} subtitle={subtitle} locale={locale} />
      <SearchField value={search} onChangeText={setSearch} locale={locale} />
      {children}
    </Page>
  );
}

export function TodayScreen({ locale, me }: CommonProps) {
  const p = usePalette();
  const actions = useQuery({
    queryKey: ["action-queue"],
    queryFn: () => salesApi.actionQueue(),
  });
  const canSeeTarget = me.access.permissions.includes("targets.view");
  const target = useQuery({
    queryKey: ["target", new Date().getFullYear()],
    queryFn: () => salesApi.target(new Date().getFullYear()),
    enabled: canSeeTarget,
    retry: false,
  });
  const urgent = useMemo(
    () =>
      actions.data?.filter(
        (item: ActionItem) => item.priorityCode?.toUpperCase() === "HIGH",
      ).length ?? 0,
    [actions.data],
  );
  const overdue = useMemo(
    () =>
      actions.data?.filter(
        (item: ActionItem) => item.dueAt && new Date(item.dueAt) < new Date(),
      ).length ?? 0,
    [actions.data],
  );

  if (actions.isLoading)
    return (
      <Page>
        <LoadingState locale={locale} />
      </Page>
    );
  if (actions.error) {
    return (
      <Page>
        <MessageState
          title={tr(locale, "تعذر تحميل يومك", "Couldn't load your day")}
          detail={errorText(actions.error, locale)}
          locale={locale}
          onRetry={() => void actions.refetch()}
        />
      </Page>
    );
  }

  return (
    <Page>
      <FlatList
        data={actions.data ?? []}
        keyExtractor={(item) =>
          `${item.sourceTypeCode}-${item.sourceId}-${item.actionCode}`
        }
        refreshing={actions.isRefetching || target.isRefetching}
        onRefresh={() => {
          void actions.refetch();
          if (canSeeTarget) void target.refetch();
        }}
        contentContainerStyle={ui.content}
        ListHeaderComponent={
          <>
            <View style={{ marginBottom: 16 }}>
              <Text
                style={[localStyles.eyebrow, rtlText(locale), { color: p.red }]}
              >
                {tr(locale, "مساحة عمل السيلز", "SALES WORKSPACE")}
              </Text>
              <Text
                style={[localStyles.hero, rtlText(locale), { color: p.text }]}
              >
                {tr(
                  locale,
                  `صباح الخير، ${me.user.displayName}`,
                  `Good day, ${me.user.displayName}`,
                )}
              </Text>
              <Text style={[ui.subtitle, rtlText(locale), { color: p.muted }]}>
                {tr(
                  locale,
                  "دي أهم الحاجات اللي محتاجة تحرك منك النهارده.",
                  "Your most important sales actions for today.",
                )}
              </Text>
            </View>
            <View style={[localStyles.stats, rowDirection(locale)]}>
              <Stat
                value={String(actions.data?.length ?? 0)}
                label={tr(locale, "إجمالي المهام", "Actions")}
              />
              <Stat
                value={String(urgent)}
                label={tr(locale, "أولوية عالية", "High priority")}
                tone="red"
              />
              <Stat
                value={String(overdue)}
                label={tr(locale, "متأخر", "Overdue")}
                tone="amber"
              />
            </View>
            {target.data ? (
              <Card accent={p.green}>
                <View style={[ui.cardRow, rowDirection(locale)]}>
                  <View style={{ flex: 1 }}>
                    <Text
                      style={[ui.cardMeta, rtlText(locale), { color: p.muted }]}
                    >
                      {tr(
                        locale,
                        `هدف ${String(target.data.year)}`,
                        `${String(target.data.year)} target`,
                      )}
                    </Text>
                    <Money
                      amount={target.data.wonAmount}
                      currency={target.data.baseCurrencyCode}
                    />
                  </View>
                  <View
                    style={{
                      alignItems: locale === "ar" ? "flex-start" : "flex-end",
                    }}
                  >
                    <Text style={[localStyles.percent, { color: p.green }]}>
                      {target.data.achievementPct ?? "0"}%
                    </Text>
                    <Text style={[ui.cardMeta, { color: p.muted }]}>
                      {tr(locale, "مُحقق", "achieved")}
                    </Text>
                  </View>
                </View>
              </Card>
            ) : null}
            <Text
              style={[
                localStyles.sectionTitle,
                rtlText(locale),
                { color: p.text },
              ]}
            >
              {tr(locale, "قائمة التحرك", "Action queue")}
            </Text>
          </>
        }
        renderItem={({ item }) => (
          <Card accent={item.priorityCode === "HIGH" ? p.red : undefined}>
            <View style={[ui.cardRow, rowDirection(locale)]}>
              <Text
                style={[
                  ui.cardTitle,
                  rtlText(locale),
                  { color: p.text, flex: 1 },
                ]}
              >
                {item.title}
              </Text>
              <Pill value={item.priorityCode ?? item.actionCode} />
            </View>
            {item.subtitle ? (
              <Text style={[ui.cardMeta, rtlText(locale), { color: p.muted }]}>
                {item.subtitle}
              </Text>
            ) : null}
            <View style={[ui.cardRow, rowDirection(locale), { marginTop: 10 }]}>
              <Text style={[ui.cardMeta, { color: p.muted }]}>
                {shortDate(item.dueAt, locale)}
              </Text>
              {item.amount ? (
                <Money amount={item.amount} currency={item.currencyCode} />
              ) : null}
            </View>
          </Card>
        )}
        ListEmptyComponent={
          <MessageState
            title={tr(locale, "يومك مرتب", "You're all caught up")}
            detail={tr(
              locale,
              "لا توجد إجراءات معلقة حاليًا.",
              "No pending actions right now.",
            )}
            locale={locale}
          />
        }
      />
    </Page>
  );
}

function Stat({
  value,
  label,
  tone,
}: {
  value: string;
  label: string;
  tone?: "red" | "amber";
}) {
  const p = usePalette();
  const color = tone === "red" ? p.red : tone === "amber" ? p.amber : p.navy;
  return (
    <View
      style={[
        localStyles.stat,
        { backgroundColor: p.surface, borderColor: p.border },
      ]}
    >
      <Text style={[localStyles.statValue, { color }]}>{value}</Text>
      <Text
        style={[localStyles.statLabel, { color: p.muted }]}
        numberOfLines={2}
      >
        {label}
      </Text>
    </View>
  );
}

export function CustomersScreen({ locale }: CommonProps) {
  const p = usePalette();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Account | null>(null);
  const debounced = useDebounced(search);
  const query = useQuery({
    queryKey: ["accounts", debounced],
    queryFn: () => salesApi.accounts(debounced),
  });
  const detail = useQuery({
    queryKey: ["account", selected?.accountId],
    queryFn: () => salesApi.account(selected?.accountId ?? ""),
    enabled: Boolean(selected),
  });

  return (
    <ListLayout
      title={tr(locale, "العملاء", "Customers")}
      subtitle={tr(
        locale,
        "بيانات العميل وفرصه وعروضه في مكان واحد",
        "Customer 360, opportunities and quotations",
      )}
      locale={locale}
      search={search}
      setSearch={setSearch}
    >
      {query.isLoading ? (
        <LoadingState locale={locale} />
      ) : query.error ? (
        <MessageState
          title={tr(locale, "تعذر تحميل العملاء", "Couldn't load customers")}
          detail={errorText(query.error, locale)}
          locale={locale}
          onRetry={() => void query.refetch()}
        />
      ) : (
        <FlatList
          data={query.data?.data ?? []}
          keyExtractor={(item) => item.accountId}
          refreshing={query.isRefetching}
          onRefresh={() => void query.refetch()}
          contentContainerStyle={ui.content}
          renderItem={({ item }) => (
            <Card
              onPress={() => {
                setSelected(item);
              }}
            >
              <View style={[ui.cardRow, rowDirection(locale)]}>
                <View style={{ flex: 1 }}>
                  <Text
                    style={[ui.cardTitle, rtlText(locale), { color: p.text }]}
                  >
                    {item.canonicalName}
                  </Text>
                  <Text
                    style={[ui.cardMeta, rtlText(locale), { color: p.muted }]}
                  >
                    {item.accountRef} ·{" "}
                    {item.country?.displayName ??
                      tr(locale, "الدولة غير محددة", "Country unresolved")}
                  </Text>
                </View>
                <Pill value={item.recordStatusCode} />
              </View>
              <Text style={[ui.cardMeta, rtlText(locale), { color: p.muted }]}>
                {humanize(item.businessTypeCode)} ·{" "}
                {humanize(item.accountCategoryCode)}
              </Text>
            </Card>
          )}
          ListEmptyComponent={
            <MessageState
              title={tr(locale, "لا يوجد عملاء", "No customers found")}
              detail={tr(
                locale,
                "جرّب كلمة بحث مختلفة.",
                "Try a different search.",
              )}
              locale={locale}
            />
          }
        />
      )}
      <DetailSheet
        visible={Boolean(selected)}
        onClose={() => {
          setSelected(null);
        }}
        title={selected?.canonicalName ?? ""}
        locale={locale}
      >
        {detail.isLoading ? (
          <LoadingState locale={locale} />
        ) : detail.error ? (
          <MessageState
            title={tr(locale, "تعذر تحميل التفاصيل", "Couldn't load details")}
            detail={errorText(detail.error, locale)}
            locale={locale}
            onRetry={() => void detail.refetch()}
          />
        ) : detail.data ? (
          <>
            <LabelValue
              label={tr(locale, "كود العميل", "Customer reference")}
              value={detail.data.accountRef}
              locale={locale}
            />
            <LabelValue
              label={tr(locale, "الدولة والسوق", "Country & market")}
              value={`${detail.data.geography.country?.displayName ?? "—"} · ${humanize(detail.data.geography.marketScope)}`}
              locale={locale}
            />
            <LabelValue
              label={tr(locale, "العملة الافتراضية", "Default currency")}
              value={detail.data.defaultCurrencyCode ?? "—"}
              locale={locale}
            />
            <LabelValue
              label={tr(locale, "جهات الاتصال", "Contacts")}
              value={String(detail.data.contacts.length)}
              locale={locale}
            />
            <LabelValue
              label={tr(locale, "الفرص", "Opportunities")}
              value={String(detail.data.opportunities.length)}
              locale={locale}
            />
            <LabelValue
              label={tr(locale, "عروض الأسعار", "Quotations")}
              value={String(detail.data.quotations.length)}
              locale={locale}
            />
            <LabelValue
              label={tr(locale, "حالة ERP", "ERP status")}
              value={humanize(detail.data.erpSyncStatus.statusCode)}
              locale={locale}
            />
          </>
        ) : null}
      </DetailSheet>
    </ListLayout>
  );
}

const stages = [
  "",
  "NEW_LEAD",
  "HOT_LEAD",
  "UNDER_NEGOTIATION",
  "WON",
  "LOST",
] as const;

export function PipelineScreen({ locale }: CommonProps) {
  const p = usePalette();
  const [search, setSearch] = useState("");
  const [stage, setStage] = useState<string>("");
  const [selected, setSelected] = useState<Opportunity | null>(null);
  const debounced = useDebounced(search);
  const query = useQuery({
    queryKey: ["opportunities", debounced, stage],
    queryFn: () => salesApi.opportunities(debounced, stage || undefined),
  });
  const detail = useQuery({
    queryKey: ["opportunity", selected?.opportunityId],
    queryFn: () => salesApi.opportunity(selected?.opportunityId ?? ""),
    enabled: Boolean(selected),
  });

  return (
    <ListLayout
      title={tr(locale, "الفرص", "Pipeline")}
      subtitle={tr(
        locale,
        "من الـLead لحد الفوز أو الخسارة",
        "From lead through won or lost",
      )}
      locale={locale}
      search={search}
      setSearch={setSearch}
    >
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={localStyles.chips}
      >
        {stages.map((item) => (
          <Pressable
            key={item || "ALL"}
            onPress={() => {
              setStage(item);
            }}
            style={[
              localStyles.chip,
              {
                backgroundColor: stage === item ? p.navy : p.surface,
                borderColor: stage === item ? p.navy : p.border,
              },
            ]}
          >
            <Text
              style={{
                color: stage === item ? "white" : p.text,
                fontWeight: "700",
              }}
            >
              {item ? humanize(item) : tr(locale, "الكل", "All")}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
      {query.isLoading ? (
        <LoadingState locale={locale} />
      ) : query.error ? (
        <MessageState
          title={tr(locale, "تعذر تحميل الفرص", "Couldn't load pipeline")}
          detail={errorText(query.error, locale)}
          locale={locale}
          onRetry={() => void query.refetch()}
        />
      ) : (
        <FlatList
          data={query.data?.data ?? []}
          keyExtractor={(item) => item.opportunityId}
          refreshing={query.isRefetching}
          onRefresh={() => void query.refetch()}
          contentContainerStyle={ui.content}
          renderItem={({ item }) => (
            <Card
              onPress={() => {
                setSelected(item);
              }}
              accent={
                item.stageCode === "WON"
                  ? p.green
                  : item.stageCode === "LOST"
                    ? p.red
                    : undefined
              }
            >
              <View style={[ui.cardRow, rowDirection(locale)]}>
                <Text
                  style={[
                    ui.cardTitle,
                    rtlText(locale),
                    { color: p.text, flex: 1 },
                  ]}
                >
                  {item.title || item.opportunityRef}
                </Text>
                <Pill value={item.stageCode} />
              </View>
              <Text style={[ui.cardMeta, rtlText(locale), { color: p.muted }]}>
                {item.opportunityRef} · {item.countryCode}
              </Text>
              <View
                style={[ui.cardRow, rowDirection(locale), { marginTop: 10 }]}
              >
                <Text style={[ui.cardMeta, { color: p.muted }]}>
                  {tr(locale, "إغلاق متوقع", "Close")}{" "}
                  {shortDate(item.expectedCloseDate, locale)}
                </Text>
                <Money
                  amount={item.estimatedValue}
                  currency={item.currencyCode}
                />
              </View>
            </Card>
          )}
          ListEmptyComponent={
            <MessageState
              title={tr(locale, "لا توجد فرص", "No opportunities found")}
              detail={tr(
                locale,
                "غيّر البحث أو مرحلة الفرصة.",
                "Change the search or stage filter.",
              )}
              locale={locale}
            />
          }
        />
      )}
      <DetailSheet
        visible={Boolean(selected)}
        onClose={() => {
          setSelected(null);
        }}
        title={selected?.title || selected?.opportunityRef || ""}
        locale={locale}
      >
        {detail.isLoading ? (
          <LoadingState locale={locale} />
        ) : detail.error ? (
          <MessageState
            title={tr(locale, "تعذر تحميل التفاصيل", "Couldn't load details")}
            detail={errorText(detail.error, locale)}
            locale={locale}
            onRetry={() => void detail.refetch()}
          />
        ) : detail.data ? (
          <>
            <LabelValue
              label={tr(locale, "المرحلة", "Stage")}
              value={humanize(detail.data.stageCode)}
              locale={locale}
            />
            <LabelValue
              label={tr(locale, "القيمة المتوقعة", "Estimated value")}
              value={`${detail.data.estimatedValue ?? "—"} ${detail.data.currencyCode ?? ""}`}
              locale={locale}
            />
            <LabelValue
              label={tr(locale, "نسبة الاحتمال", "Probability")}
              value={
                detail.data.probabilityPct
                  ? `${detail.data.probabilityPct}%`
                  : "—"
              }
              locale={locale}
            />
            <LabelValue
              label={tr(locale, "تاريخ الإغلاق", "Expected close")}
              value={shortDate(detail.data.expectedCloseDate, locale)}
              locale={locale}
            />
            {detail.data.lostReasonCode ? (
              <LabelValue
                label={tr(locale, "سبب الخسارة", "Lost reason")}
                value={humanize(detail.data.lostReasonCode)}
                locale={locale}
              />
            ) : null}
            <LabelValue
              label={tr(locale, "تحركات المرحلة", "Stage changes")}
              value={String(detail.data.stageHistory.length)}
              locale={locale}
            />
          </>
        ) : null}
      </DetailSheet>
    </ListLayout>
  );
}

export function WorkScreen({ locale }: CommonProps) {
  const p = usePalette();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Activity | null>(null);
  const debounced = useDebounced(search);
  const query = useQuery({
    queryKey: ["activities", debounced],
    queryFn: () => salesApi.activities(debounced),
  });
  const complete = useMutation({
    mutationFn: (activity: Activity) => salesApi.completeActivity(activity),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["activities"] });
      await queryClient.invalidateQueries({ queryKey: ["action-queue"] });
      setSelected(null);
    },
    onError: (error) => {
      Alert.alert(
        tr(locale, "لم يتم الإتمام", "Couldn't complete"),
        errorText(error, locale),
      );
    },
  });

  return (
    <ListLayout
      title={tr(locale, "المتابعات", "Work")}
      subtitle={tr(
        locale,
        "مكالمات واجتماعات ومهام السيلز",
        "Calls, meetings and follow-ups",
      )}
      locale={locale}
      search={search}
      setSearch={setSearch}
    >
      {query.isLoading ? (
        <LoadingState locale={locale} />
      ) : query.error ? (
        <MessageState
          title={tr(locale, "تعذر تحميل المتابعات", "Couldn't load work")}
          detail={errorText(query.error, locale)}
          locale={locale}
          onRetry={() => void query.refetch()}
        />
      ) : (
        <FlatList
          data={query.data?.data ?? []}
          keyExtractor={(item) => item.activityId}
          refreshing={query.isRefetching}
          onRefresh={() => void query.refetch()}
          contentContainerStyle={ui.content}
          renderItem={({ item }) => {
            const overdue =
              item.taskStatusCode === "OPEN" &&
              item.dueAt != null &&
              new Date(item.dueAt) < new Date();
            return (
              <Card
                onPress={() => {
                  setSelected(item);
                }}
                accent={overdue ? p.red : undefined}
              >
                <View style={[ui.cardRow, rowDirection(locale)]}>
                  <Text
                    style={[
                      ui.cardTitle,
                      rtlText(locale),
                      { color: p.text, flex: 1 },
                    ]}
                  >
                    {item.subject || humanize(item.typeCode)}
                  </Text>
                  <Pill value={overdue ? "OVERDUE" : item.taskStatusCode} />
                </View>
                <Text
                  style={[ui.cardMeta, rtlText(locale), { color: p.muted }]}
                >
                  {humanize(item.typeCode)} ·{" "}
                  {shortDate(item.dueAt ?? item.scheduledAt, locale)}
                </Text>
              </Card>
            );
          }}
          ListEmptyComponent={
            <MessageState
              title={tr(locale, "لا توجد متابعات", "No work found")}
              detail={tr(
                locale,
                "لا توجد مهام مطابقة للبحث.",
                "No matching activities.",
              )}
              locale={locale}
            />
          }
        />
      )}
      <DetailSheet
        visible={Boolean(selected)}
        onClose={() => {
          setSelected(null);
        }}
        title={selected?.subject || humanize(selected?.typeCode)}
        locale={locale}
      >
        {selected ? (
          <>
            <LabelValue
              label={tr(locale, "النوع", "Type")}
              value={humanize(selected.typeCode)}
              locale={locale}
            />
            <LabelValue
              label={tr(locale, "الحالة", "Status")}
              value={humanize(selected.taskStatusCode)}
              locale={locale}
            />
            <LabelValue
              label={tr(locale, "الموعد", "Due")}
              value={shortDate(selected.dueAt ?? selected.scheduledAt, locale)}
              locale={locale}
            />
            <LabelValue
              label={tr(locale, "الملاحظات", "Notes")}
              value={selected.notes ?? "—"}
              locale={locale}
            />
            {selected.taskStatusCode === "OPEN" ? (
              <ActionButton
                label={
                  complete.isPending
                    ? tr(locale, "جاري الإتمام...", "Completing...")
                    : tr(locale, "تمت المتابعة", "Mark complete")
                }
                disabled={complete.isPending || !selected.rowVersion}
                onPress={() => {
                  complete.mutate(selected);
                }}
              />
            ) : null}
          </>
        ) : null}
      </DetailSheet>
    </ListLayout>
  );
}

type MoreSection = "quotes" | "notifications" | "profile";

export function MoreScreen({
  locale,
  me,
  onLogout,
}: CommonProps & { onLogout: () => Promise<void> }) {
  const p = usePalette();
  const queryClient = useQueryClient();
  const [section, setSection] = useState<MoreSection>("quotes");
  const [search, setSearch] = useState("");
  const [quote, setQuote] = useState<Quotation | null>(null);
  const [notification, setNotification] = useState<Notification | null>(null);
  const debounced = useDebounced(search);
  const canSeeQuotes = me.access.permissions.includes("quotations.view");
  const quotes = useQuery({
    queryKey: ["quotations", debounced],
    queryFn: () => salesApi.quotations(debounced),
    enabled: section === "quotes" && canSeeQuotes,
  });
  const notifications = useQuery({
    queryKey: ["notifications", debounced],
    queryFn: () => salesApi.notifications(debounced),
    enabled: section === "notifications",
  });
  const markRead = useMutation({
    mutationFn: (notificationId: string) =>
      salesApi.markNotificationRead(notificationId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["notifications"] });
      setNotification(null);
    },
    onError: (error) => {
      Alert.alert(
        tr(locale, "تعذر تحديث الإشعار", "Couldn't update notification"),
        errorText(error, locale),
      );
    },
  });

  const available: { id: MoreSection; label: string }[] = [
    ...(canSeeQuotes
      ? [{ id: "quotes" as const, label: tr(locale, "العروض", "Quotes") }]
      : []),
    { id: "notifications", label: tr(locale, "الإشعارات", "Notifications") },
    { id: "profile", label: tr(locale, "حسابي", "Profile") },
  ];

  useEffect(() => {
    if (!canSeeQuotes && section === "quotes") setSection("notifications");
  }, [canSeeQuotes, section]);

  return (
    <Page>
      <ScreenTitle
        title={tr(locale, "المزيد", "More")}
        subtitle={tr(
          locale,
          "عروض الأسعار والإشعارات والحساب",
          "Quotes, notifications and account",
        )}
        locale={locale}
      />
      <View style={[localStyles.segment, { backgroundColor: p.surfaceAlt }]}>
        {available.map((item) => (
          <Pressable
            key={item.id}
            onPress={() => {
              setSection(item.id);
              setSearch("");
            }}
            style={[
              localStyles.segmentButton,
              section === item.id ? { backgroundColor: p.surface } : null,
            ]}
          >
            <Text
              style={{
                color: section === item.id ? p.red : p.muted,
                fontWeight: "800",
                fontSize: 12,
              }}
            >
              {item.label}
            </Text>
          </Pressable>
        ))}
      </View>
      {section !== "profile" ? (
        <SearchField value={search} onChangeText={setSearch} locale={locale} />
      ) : null}
      {section === "quotes" ? (
        quotes.isLoading ? (
          <LoadingState locale={locale} />
        ) : quotes.error ? (
          <MessageState
            title={tr(locale, "تعذر تحميل العروض", "Couldn't load quotes")}
            detail={errorText(quotes.error, locale)}
            locale={locale}
            onRetry={() => void quotes.refetch()}
          />
        ) : (
          <FlatList
            data={quotes.data?.data ?? []}
            keyExtractor={(item) => item.quotationId}
            refreshing={quotes.isRefetching}
            onRefresh={() => void quotes.refetch()}
            contentContainerStyle={ui.content}
            renderItem={({ item }) => (
              <Card
                onPress={() => {
                  setQuote(item);
                }}
              >
                <View style={[ui.cardRow, rowDirection(locale)]}>
                  <View style={{ flex: 1 }}>
                    <Text
                      style={[ui.cardTitle, rtlText(locale), { color: p.text }]}
                    >
                      {item.quoteRef ??
                        tr(locale, "عرض بدون رقم", "Unnumbered quote")}
                    </Text>
                    <Text
                      style={[ui.cardMeta, rtlText(locale), { color: p.muted }]}
                    >
                      {humanize(item.documentTypeCode)} · {item.countryCode}
                    </Text>
                  </View>
                  <Pill value={item.statusCode} />
                </View>
                <View
                  style={[ui.cardRow, rowDirection(locale), { marginTop: 9 }]}
                >
                  <Text style={[ui.cardMeta, { color: p.muted }]}>
                    {tr(locale, "صالح حتى", "Expires")}{" "}
                    {shortDate(item.expiresOn, locale)}
                  </Text>
                  <Money
                    amount={item.grandTotalAmount}
                    currency={item.currencyCode}
                  />
                </View>
              </Card>
            )}
            ListEmptyComponent={
              <MessageState
                title={tr(locale, "لا توجد عروض", "No quotations found")}
                locale={locale}
              />
            }
          />
        )
      ) : section === "notifications" ? (
        notifications.isLoading ? (
          <LoadingState locale={locale} />
        ) : notifications.error ? (
          <MessageState
            title={tr(
              locale,
              "تعذر تحميل الإشعارات",
              "Couldn't load notifications",
            )}
            detail={errorText(notifications.error, locale)}
            locale={locale}
            onRetry={() => void notifications.refetch()}
          />
        ) : (
          <FlatList
            data={notifications.data?.data ?? []}
            keyExtractor={(item) => item.notificationId}
            refreshing={notifications.isRefetching}
            onRefresh={() => void notifications.refetch()}
            contentContainerStyle={ui.content}
            renderItem={({ item }) => (
              <Card
                onPress={() => {
                  setNotification(item);
                }}
                accent={item.readAt ? undefined : p.red}
              >
                <View style={[ui.cardRow, rowDirection(locale)]}>
                  <Text
                    style={[
                      ui.cardTitle,
                      rtlText(locale),
                      { color: p.text, flex: 1 },
                    ]}
                  >
                    {item.titleSafe}
                  </Text>
                  {!item.readAt ? (
                    <View
                      style={[localStyles.unread, { backgroundColor: p.red }]}
                    />
                  ) : null}
                </View>
                {item.bodySafe ? (
                  <Text
                    style={[ui.cardMeta, rtlText(locale), { color: p.muted }]}
                    numberOfLines={2}
                  >
                    {item.bodySafe}
                  </Text>
                ) : null}
                <Text
                  style={[ui.cardMeta, rtlText(locale), { color: p.muted }]}
                >
                  {shortDate(item.createdAt, locale)}
                </Text>
              </Card>
            )}
            ListEmptyComponent={
              <MessageState
                title={tr(locale, "لا توجد إشعارات", "No notifications")}
                locale={locale}
              />
            }
          />
        )
      ) : (
        <ScrollView contentContainerStyle={ui.content}>
          <Card>
            <View style={[localStyles.avatarRow, rowDirection(locale)]}>
              <View style={[localStyles.avatar, { backgroundColor: p.navy }]}>
                <Text style={localStyles.avatarText}>
                  {me.user.displayName.slice(0, 2).toUpperCase()}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text
                  style={[ui.cardTitle, rtlText(locale), { color: p.text }]}
                >
                  {me.user.displayName}
                </Text>
                <Text
                  style={[ui.cardMeta, rtlText(locale), { color: p.muted }]}
                >
                  {me.user.email}
                </Text>
              </View>
            </View>
          </Card>
          <Card>
            <LabelValue
              label={tr(locale, "المسمى الوظيفي", "Job title")}
              value={me.user.jobTitle ?? "—"}
              locale={locale}
            />
            <LabelValue
              label={tr(locale, "الدول المتاحة", "Country scope")}
              value={me.access.countryScope.countryCodes.join(", ") || "—"}
              locale={locale}
            />
            <LabelValue
              label={tr(locale, "الأدوار", "Roles")}
              value={me.access.roles.map((role) => role.name).join(", ")}
              locale={locale}
            />
            <LabelValue
              label={tr(locale, "آخر تسجيل دخول", "Last sign in")}
              value={shortDate(me.user.lastSignInAt, locale)}
              locale={locale}
            />
          </Card>
          <ActionButton
            label={tr(locale, "تسجيل الخروج", "Sign out")}
            danger
            onPress={() => void onLogout()}
          />
        </ScrollView>
      )}
      <DetailSheet
        visible={Boolean(quote)}
        onClose={() => {
          setQuote(null);
        }}
        title={quote?.quoteRef ?? ""}
        locale={locale}
      >
        {quote ? (
          <>
            <LabelValue
              label={tr(locale, "الحالة", "Status")}
              value={humanize(quote.statusCode)}
              locale={locale}
            />
            <LabelValue
              label={tr(locale, "الإجمالي", "Grand total")}
              value={`${quote.grandTotalAmount ?? "—"} ${quote.currencyCode}`}
              locale={locale}
            />
            <LabelValue
              label={tr(locale, "الخصم", "Discount")}
              value={quote.discountAmount ?? "—"}
              locale={locale}
            />
            <LabelValue
              label={tr(locale, "الضريبة", "Tax")}
              value={quote.taxAmount ?? "—"}
              locale={locale}
            />
            <LabelValue
              label={tr(locale, "Incoterm", "Incoterm")}
              value={quote.incotermCode ?? "—"}
              locale={locale}
            />
            <LabelValue
              label={tr(locale, "صالح حتى", "Expires")}
              value={shortDate(quote.expiresOn, locale)}
              locale={locale}
            />
          </>
        ) : null}
      </DetailSheet>
      <DetailSheet
        visible={Boolean(notification)}
        onClose={() => {
          setNotification(null);
        }}
        title={notification?.titleSafe ?? ""}
        locale={locale}
      >
        {notification ? (
          <>
            <LabelValue
              label={tr(locale, "التفاصيل", "Details")}
              value={notification.bodySafe ?? "—"}
              locale={locale}
            />
            <LabelValue
              label={tr(locale, "النوع", "Type")}
              value={humanize(notification.typeCode)}
              locale={locale}
            />
            <LabelValue
              label={tr(locale, "التاريخ", "Date")}
              value={shortDate(notification.createdAt, locale)}
              locale={locale}
            />
            {!notification.readAt ? (
              <ActionButton
                label={
                  markRead.isPending
                    ? tr(locale, "جاري التحديث...", "Updating...")
                    : tr(locale, "تعليم كمقروء", "Mark as read")
                }
                disabled={markRead.isPending}
                onPress={() => {
                  markRead.mutate(notification.notificationId);
                }}
              />
            ) : null}
          </>
        ) : null}
      </DetailSheet>
    </Page>
  );
}

const localStyles = StyleSheet.create({
  eyebrow: {
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 1.1,
    marginBottom: 6,
  },
  hero: { fontSize: 27, fontWeight: "900", lineHeight: 34 },
  stats: { gap: 8, marginBottom: 14 },
  stat: {
    flex: 1,
    minHeight: 86,
    borderWidth: 1,
    borderRadius: 15,
    padding: 12,
    justifyContent: "center",
  },
  statValue: { fontSize: 24, fontWeight: "900" },
  statLabel: { fontSize: 11, lineHeight: 15, marginTop: 2 },
  percent: { fontSize: 24, fontWeight: "900" },
  sectionTitle: {
    fontSize: 19,
    fontWeight: "800",
    marginTop: 7,
    marginBottom: 11,
  },
  chips: { paddingHorizontal: 16, paddingBottom: 12, gap: 8 },
  chip: {
    paddingHorizontal: 13,
    paddingVertical: 9,
    borderRadius: 999,
    borderWidth: 1,
  },
  segment: {
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: 13,
    padding: 4,
    flexDirection: "row",
  },
  segmentButton: {
    flex: 1,
    minHeight: 39,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    paddingHorizontal: 4,
  },
  unread: { width: 9, height: 9, borderRadius: 99 },
  avatarRow: { alignItems: "center", gap: 13 },
  avatar: {
    width: 54,
    height: 54,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: "white", fontWeight: "900", fontSize: 18 },
});
