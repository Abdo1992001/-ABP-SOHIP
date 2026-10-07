import type { ReactNode } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useColorScheme,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export type Locale = "ar" | "en";

export const tr = (locale: Locale, ar: string, en: string) =>
  locale === "ar" ? ar : en;

export function usePalette() {
  const dark = useColorScheme() === "dark";
  return {
    dark,
    page: dark ? "#090b12" : "#f3f6f8",
    surface: dark ? "#151923" : "#ffffff",
    surfaceAlt: dark ? "#202634" : "#edf2f5",
    text: dark ? "#f4f7fb" : "#142537",
    muted: dark ? "#aab4c3" : "#66788a",
    border: dark ? "#2d3544" : "#dce4e9",
    navy: "#171253",
    red: "#c8202f",
    green: "#14804a",
    amber: "#b66b08",
    dangerSoft: dark ? "#47212a" : "#fee9ec",
    successSoft: dark ? "#17392b" : "#e4f5ec",
    infoSoft: dark ? "#202a54" : "#e9edff",
  };
}

export function Page({ children }: { children: ReactNode }) {
  const p = usePalette();
  return (
    <SafeAreaView
      style={[styles.page, { backgroundColor: p.page }]}
      edges={["left", "right"]}
    >
      {children}
    </SafeAreaView>
  );
}

export function ScreenTitle({
  title,
  subtitle,
  locale,
}: {
  title: string;
  subtitle?: string;
  locale: Locale;
}) {
  const p = usePalette();
  return (
    <View style={styles.titleBlock}>
      <Text style={[styles.screenTitle, rtlText(locale), { color: p.text }]}>
        {title}
      </Text>
      {subtitle ? (
        <Text style={[styles.subtitle, rtlText(locale), { color: p.muted }]}>
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
}

export function SearchField({
  value,
  onChangeText,
  locale,
  placeholder,
}: {
  value: string;
  onChangeText: (value: string) => void;
  locale: Locale;
  placeholder?: string;
}) {
  const p = usePalette();
  return (
    <View
      style={[
        styles.searchWrap,
        { backgroundColor: p.surface, borderColor: p.border },
      ]}
    >
      <Text style={{ color: p.muted, fontSize: 18 }}>⌕</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder ?? tr(locale, "بحث...", "Search...")}
        placeholderTextColor={p.muted}
        style={[styles.search, rtlText(locale), { color: p.text }]}
        autoCapitalize="none"
        returnKeyType="search"
        accessibilityLabel={tr(locale, "بحث", "Search")}
      />
      {value ? (
        <Pressable
          onPress={() => {
            onChangeText("");
          }}
          hitSlop={12}
        >
          <Text style={{ color: p.muted, fontSize: 18 }}>×</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function Card({
  children,
  onPress,
  accent,
}: {
  children: ReactNode;
  onPress?: () => void;
  accent?: string;
}) {
  const p = usePalette();
  const content = (
    <View
      style={[
        styles.card,
        { backgroundColor: p.surface, borderColor: p.border },
        accent ? { borderLeftColor: accent, borderLeftWidth: 4 } : null,
      ]}
    >
      {children}
    </View>
  );
  return onPress ? <Pressable onPress={onPress}>{content}</Pressable> : content;
}

export function Pill({ value }: { value?: string | null }) {
  const p = usePalette();
  const normalized = value?.toUpperCase() ?? "—";
  const positive = ["WON", "ACTIVE", "SENT", "COMPLETED", "READY"].includes(
    normalized,
  );
  const negative = [
    "LOST",
    "CANCELLED",
    "ARCHIVED",
    "EXPIRED",
    "OVERDUE",
  ].includes(normalized);
  const backgroundColor = positive
    ? p.successSoft
    : negative
      ? p.dangerSoft
      : p.infoSoft;
  const color = positive ? p.green : negative ? p.red : p.navy;
  return (
    <View style={[styles.pill, { backgroundColor }]}>
      <Text
        style={[
          styles.pillText,
          { color: p.dark && !positive && !negative ? "#cbd3ff" : color },
        ]}
      >
        {humanize(normalized)}
      </Text>
    </View>
  );
}

export function Money({
  amount,
  currency,
}: {
  amount?: string | null;
  currency?: string | null;
}) {
  const p = usePalette();
  const number = Number(amount);
  const shown = Number.isFinite(number)
    ? new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(
        number,
      )
    : (amount ?? "—");
  return (
    <Text style={[styles.money, { color: p.text }]}>
      {shown} {currency ?? ""}
    </Text>
  );
}

export function LabelValue({
  label,
  value,
  locale,
}: {
  label: string;
  value?: ReactNode;
  locale: Locale;
}) {
  const p = usePalette();
  return (
    <View style={styles.labelValue}>
      <Text style={[styles.label, rtlText(locale), { color: p.muted }]}>
        {label}
      </Text>
      <Text style={[styles.value, rtlText(locale), { color: p.text }]}>
        {value ?? "—"}
      </Text>
    </View>
  );
}

export function LoadingState({ locale }: { locale: Locale }) {
  const p = usePalette();
  return (
    <View style={styles.center}>
      <ActivityIndicator color={p.red} size="large" />
      <Text style={{ color: p.muted, marginTop: 12 }}>
        {tr(locale, "جاري التحميل...", "Loading...")}
      </Text>
    </View>
  );
}

export function MessageState({
  title,
  detail,
  locale,
  onRetry,
}: {
  title: string;
  detail?: string;
  locale: Locale;
  onRetry?: () => void;
}) {
  const p = usePalette();
  return (
    <View style={styles.center}>
      <Text style={[styles.emptyIcon, { color: p.muted }]}>◎</Text>
      <Text style={[styles.emptyTitle, rtlText(locale), { color: p.text }]}>
        {title}
      </Text>
      {detail ? (
        <Text style={[styles.emptyDetail, rtlText(locale), { color: p.muted }]}>
          {detail}
        </Text>
      ) : null}
      {onRetry ? (
        <ActionButton
          label={tr(locale, "إعادة المحاولة", "Retry")}
          onPress={onRetry}
          secondary
        />
      ) : null}
    </View>
  );
}

export function ActionButton({
  label,
  onPress,
  disabled,
  secondary,
  danger,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  secondary?: boolean;
  danger?: boolean;
}) {
  const p = usePalette();
  const backgroundColor = secondary ? p.surfaceAlt : danger ? p.red : p.navy;
  const color = secondary ? p.text : "white";
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor, opacity: disabled ? 0.45 : pressed ? 0.82 : 1 },
      ]}
    >
      <Text style={[styles.buttonText, { color }]}>{label}</Text>
    </Pressable>
  );
}

export function DetailSheet({
  visible,
  onClose,
  title,
  locale,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  locale: Locale;
  children: ReactNode;
}) {
  const p = usePalette();
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { backgroundColor: p.page }]}>
          <View
            style={[
              styles.sheetHeader,
              rowDirection(locale),
              { borderBottomColor: p.border },
            ]}
          >
            <Text
              style={[styles.sheetTitle, rtlText(locale), { color: p.text }]}
              numberOfLines={2}
            >
              {title}
            </Text>
            <Pressable
              onPress={onClose}
              hitSlop={14}
              accessibilityLabel={tr(locale, "إغلاق", "Close")}
            >
              <Text style={{ color: p.text, fontSize: 28, lineHeight: 30 }}>
                ×
              </Text>
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.sheetBody}>
            {children}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

export function humanize(value?: string | null) {
  if (!value) return "—";
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function shortDate(value?: string | null, locale: Locale = "en") {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

export function rtlText(locale: Locale) {
  return {
    textAlign: locale === "ar" ? ("right" as const) : ("left" as const),
    writingDirection: locale === "ar" ? ("rtl" as const) : ("ltr" as const),
  };
}

export function rowDirection(locale: Locale) {
  return {
    flexDirection:
      locale === "ar" ? ("row-reverse" as const) : ("row" as const),
  };
}

export const styles = StyleSheet.create({
  page: { flex: 1 },
  content: { padding: 16, paddingBottom: 32 },
  titleBlock: { paddingHorizontal: 16, paddingTop: 18, paddingBottom: 12 },
  screenTitle: { fontSize: 28, fontWeight: "800", letterSpacing: -0.4 },
  subtitle: { fontSize: 14, marginTop: 4, lineHeight: 20 },
  searchWrap: {
    marginHorizontal: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
  },
  search: { flex: 1, minHeight: 48, paddingHorizontal: 10, fontSize: 16 },
  card: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    shadowColor: "#000",
    shadowOpacity: 0.04,
    shadowRadius: 7,
    elevation: 1,
  },
  cardTitle: { fontSize: 17, fontWeight: "700", lineHeight: 23 },
  cardMeta: { fontSize: 13, lineHeight: 19, marginTop: 5 },
  cardRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  pill: {
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 5,
    alignSelf: "flex-start",
  },
  pillText: { fontSize: 11, fontWeight: "800" },
  money: { fontSize: 16, fontWeight: "800" },
  labelValue: { marginBottom: 15 },
  label: { fontSize: 12, fontWeight: "700", marginBottom: 4 },
  value: { fontSize: 16, lineHeight: 22 },
  center: {
    flex: 1,
    minHeight: 280,
    justifyContent: "center",
    alignItems: "center",
    padding: 28,
  },
  emptyIcon: { fontSize: 40, marginBottom: 12 },
  emptyTitle: { fontSize: 18, fontWeight: "800", textAlign: "center" },
  emptyDetail: {
    fontSize: 14,
    textAlign: "center",
    lineHeight: 21,
    marginTop: 6,
    marginBottom: 12,
  },
  button: {
    minHeight: 46,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
    marginTop: 10,
  },
  buttonText: { fontSize: 15, fontWeight: "800" },
  backdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,.52)",
  },
  sheet: {
    maxHeight: "88%",
    minHeight: "38%",
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    overflow: "hidden",
  },
  sheetHeader: {
    padding: 18,
    borderBottomWidth: 1,
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  sheetTitle: { flex: 1, fontSize: 20, fontWeight: "800" },
  sheetBody: { padding: 18, paddingBottom: 36 },
});
