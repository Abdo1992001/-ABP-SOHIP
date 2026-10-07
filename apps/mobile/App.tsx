import { Component, useEffect, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  NavigationContainer,
  DarkTheme,
  DefaultTheme,
} from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { salesApi, type AuthResult, type Me } from "./src/api";
import {
  CustomersScreen,
  MoreScreen,
  PipelineScreen,
  TodayScreen,
  WorkScreen,
} from "./src/screens";
import {
  ActionButton,
  LoadingState,
  MessageState,
  rtlText,
  tr,
  type Locale,
  usePalette,
} from "./src/ui";

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
});
const Tabs = createBottomTabNavigator();

function AuthShell({
  children,
  locale,
  onLocale,
}: {
  children: ReactNode;
  locale: Locale;
  onLocale: () => void;
}) {
  const p = usePalette();
  return (
    <SafeAreaView style={[auth.page, { backgroundColor: p.page }]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={auth.scroll}
          keyboardShouldPersistTaps="handled"
        >
          <View style={auth.brandRow}>
            <View style={[auth.logo, { backgroundColor: p.navy }]}>
              <Text style={auth.logoText}>ABP</Text>
            </View>
            <Pressable
              onPress={onLocale}
              style={[auth.locale, { borderColor: p.border }]}
            >
              <Text style={{ color: p.text, fontWeight: "800" }}>
                {locale === "ar" ? "EN" : "عربي"}
              </Text>
            </Pressable>
          </View>
          <View
            style={[
              auth.panel,
              { backgroundColor: p.surface, borderColor: p.border },
            ]}
          >
            {children}
          </View>
          <Text style={[auth.server, { color: p.muted }]} numberOfLines={1}>
            API · {salesApi.baseUrl}
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Field({
  label,
  value,
  onChangeText,
  locale,
  secure,
  keyboardType,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  locale: Locale;
  secure?: boolean;
  keyboardType?: "default" | "email-address" | "number-pad";
}) {
  const p = usePalette();
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={[auth.label, rtlText(locale), { color: p.muted }]}>
        {label}
      </Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        secureTextEntry={secure}
        keyboardType={keyboardType}
        autoCapitalize="none"
        autoCorrect={false}
        style={[
          auth.input,
          rtlText(locale),
          { color: p.text, borderColor: p.border, backgroundColor: p.page },
        ]}
      />
    </View>
  );
}

function AuthHeading({
  title,
  detail,
  locale,
}: {
  title: string;
  detail: string;
  locale: Locale;
}) {
  const p = usePalette();
  return (
    <View style={{ marginBottom: 22 }}>
      <Text style={[auth.title, rtlText(locale), { color: p.text }]}>
        {title}
      </Text>
      <Text style={[auth.detail, rtlText(locale), { color: p.muted }]}>
        {detail}
      </Text>
    </View>
  );
}

function SignIn({
  locale,
  onAuthenticated,
}: {
  locale: Locale;
  onAuthenticated: () => Promise<void>;
}) {
  const p = usePalette();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [challenge, setChallenge] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function finish(result: AuthResult) {
    if (result.state === "MFA_REQUIRED" && result.challengeToken) {
      setChallenge(result.challengeToken);
      return;
    }
    await onAuthenticated();
  }

  const login = useMutation({
    mutationFn: () => salesApi.login(identifier.trim(), password),
    onSuccess: finish,
    onError: (value) => {
      setError(
        value instanceof Error
          ? value.message
          : tr(locale, "فشل تسجيل الدخول.", "Sign in failed."),
      );
    },
  });
  const mfa = useMutation({
    mutationFn: () =>
      recovery
        ? salesApi.recoverMfa(challenge ?? "", code.trim())
        : salesApi.verifyMfa(challenge ?? "", code.trim()),
    onSuccess: finish,
    onError: (value) => {
      setError(
        value instanceof Error
          ? value.message
          : tr(locale, "الكود غير صحيح.", "Invalid code."),
      );
    },
  });

  return (
    <>
      <AuthHeading
        title={
          challenge
            ? tr(locale, "التحقق بخطوتين", "Two-step verification")
            : tr(locale, "دخول فريق السيلز", "Sales sign in")
        }
        detail={
          challenge
            ? tr(
                locale,
                recovery
                  ? "اكتب كود الاسترداد لمرة واحدة."
                  : "اكتب الكود المكوّن من 6 أرقام من تطبيق المصادقة.",
                recovery
                  ? "Enter a one-time recovery code."
                  : "Enter the 6-digit code from your authenticator app.",
              )
            : tr(
                locale,
                "تابع عملاءك وفرصك ومهامك من الموبايل.",
                "Customers, pipeline and daily work in your pocket.",
              )
        }
        locale={locale}
      />
      {challenge ? (
        <>
          <Field
            label={
              recovery
                ? tr(locale, "كود الاسترداد", "Recovery code")
                : tr(locale, "كود التحقق", "Verification code")
            }
            value={code}
            onChangeText={(value) => {
              setCode(value);
              setError(null);
            }}
            locale={locale}
            keyboardType={recovery ? "default" : "number-pad"}
          />
          <ActionButton
            label={
              mfa.isPending
                ? tr(locale, "جاري التحقق...", "Verifying...")
                : tr(locale, "تحقق ودخول", "Verify and sign in")
            }
            disabled={mfa.isPending || code.trim().length < 6}
            onPress={() => {
              mfa.mutate();
            }}
          />
          <Pressable
            onPress={() => {
              setRecovery(!recovery);
              setCode("");
              setError(null);
            }}
            style={auth.linkButton}
          >
            <Text style={{ color: p.red, fontWeight: "800" }}>
              {recovery
                ? tr(locale, "استخدم تطبيق المصادقة", "Use authenticator app")
                : tr(locale, "استخدم كود استرداد", "Use a recovery code")}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => {
              setChallenge(null);
              setCode("");
              setError(null);
            }}
            style={auth.linkButton}
          >
            <Text style={{ color: p.muted }}>
              {tr(locale, "العودة لتسجيل الدخول", "Back to sign in")}
            </Text>
          </Pressable>
        </>
      ) : (
        <>
          <Field
            label={tr(locale, "البريد أو اسم المستخدم", "Email or username")}
            value={identifier}
            onChangeText={(value) => {
              setIdentifier(value);
              setError(null);
            }}
            locale={locale}
            keyboardType="email-address"
          />
          <Field
            label={tr(locale, "كلمة المرور", "Password")}
            value={password}
            onChangeText={(value) => {
              setPassword(value);
              setError(null);
            }}
            locale={locale}
            secure
          />
          <ActionButton
            label={
              login.isPending
                ? tr(locale, "جاري الدخول...", "Signing in...")
                : tr(locale, "تسجيل الدخول", "Sign in")
            }
            disabled={login.isPending || !identifier.trim() || !password}
            onPress={() => {
              login.mutate();
            }}
          />
        </>
      )}
      {error ? (
        <Text style={[auth.error, rtlText(locale)]}>{error}</Text>
      ) : null}
    </>
  );
}

function PasswordChange({
  locale,
  onComplete,
}: {
  locale: Locale;
  onComplete: () => Promise<void>;
}) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: () => salesApi.changePassword(current, next),
    onSuccess: onComplete,
    onError: (value) => {
      setError(
        value instanceof Error
          ? value.message
          : tr(locale, "تعذر تغيير كلمة المرور.", "Couldn't change password."),
      );
    },
  });
  const valid = current.length > 0 && next.length >= 12 && next === confirm;
  return (
    <>
      <AuthHeading
        title={tr(locale, "غيّر كلمة المرور", "Change your password")}
        detail={tr(
          locale,
          "مطلوب تعيين كلمة مرور جديدة قبل فتح مساحة العمل.",
          "Set a new password before opening the workspace.",
        )}
        locale={locale}
      />
      <Field
        label={tr(locale, "كلمة المرور الحالية", "Current password")}
        value={current}
        onChangeText={setCurrent}
        locale={locale}
        secure
      />
      <Field
        label={tr(locale, "كلمة المرور الجديدة", "New password")}
        value={next}
        onChangeText={setNext}
        locale={locale}
        secure
      />
      <Field
        label={tr(locale, "تأكيد كلمة المرور", "Confirm password")}
        value={confirm}
        onChangeText={setConfirm}
        locale={locale}
        secure
      />
      {next && next.length < 12 ? (
        <Text style={[auth.hint, rtlText(locale)]}>
          {tr(
            locale,
            "استخدم 12 حرفًا على الأقل.",
            "Use at least 12 characters.",
          )}
        </Text>
      ) : null}
      {confirm && next !== confirm ? (
        <Text style={[auth.hint, rtlText(locale)]}>
          {tr(locale, "كلمتا المرور غير متطابقتين.", "Passwords don't match.")}
        </Text>
      ) : null}
      <ActionButton
        label={
          mutation.isPending
            ? tr(locale, "جاري الحفظ...", "Saving...")
            : tr(locale, "حفظ والمتابعة", "Save and continue")
        }
        disabled={!valid || mutation.isPending}
        onPress={() => {
          mutation.mutate();
        }}
      />
      {error ? (
        <Text style={[auth.error, rtlText(locale)]}>{error}</Text>
      ) : null}
    </>
  );
}

function MfaEnrollment({
  locale,
  onComplete,
}: {
  locale: Locale;
  onComplete: () => Promise<void>;
}) {
  const p = usePalette();
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState<readonly string[] | null>(null);
  const setup = useQuery({
    queryKey: ["mfa-setup"],
    queryFn: () => salesApi.setupMfa(),
    retry: false,
  });
  const confirm = useMutation({
    mutationFn: () => salesApi.confirmMfa(code),
    onSuccess: (data) => {
      setCodes(data.recoveryCodes);
    },
  });
  if (setup.isLoading) return <LoadingState locale={locale} />;
  if (setup.error)
    return (
      <MessageState
        title={tr(locale, "تعذر إعداد التحقق", "Couldn't set up MFA")}
        detail={setup.error.message}
        locale={locale}
        onRetry={() => void setup.refetch()}
      />
    );
  return (
    <>
      <AuthHeading
        title={
          codes
            ? tr(locale, "احفظ أكواد الاسترداد", "Save recovery codes")
            : tr(locale, "أمّن حسابك", "Secure your account")
        }
        detail={
          codes
            ? tr(
                locale,
                "احتفظ بها في مكان آمن. كل كود يُستخدم مرة واحدة.",
                "Keep these somewhere safe. Each code works once.",
              )
            : tr(
                locale,
                "أضف المفتاح في تطبيق المصادقة ثم اكتب الكود الظاهر.",
                "Add the key to your authenticator app, then enter the code.",
              )
        }
        locale={locale}
      />
      {codes ? (
        <>
          <View
            style={[
              auth.codes,
              { backgroundColor: p.page, borderColor: p.border },
            ]}
          >
            {codes.map((item) => (
              <Text key={item} style={[auth.code, { color: p.text }]}>
                {item}
              </Text>
            ))}
          </View>
          <ActionButton
            label={tr(locale, "حفظتها — افتح التطبيق", "Saved — open app")}
            onPress={() => void onComplete()}
          />
        </>
      ) : (
        <>
          <Text style={[auth.label, rtlText(locale), { color: p.muted }]}>
            {tr(locale, "المفتاح اليدوي", "Manual key")}
          </Text>
          <Text
            selectable
            style={[
              auth.secret,
              { color: p.text, backgroundColor: p.page, borderColor: p.border },
            ]}
          >
            {setup.data?.manualSecret}
          </Text>
          <Field
            label={tr(locale, "كود التحقق", "Verification code")}
            value={code}
            onChangeText={setCode}
            locale={locale}
            keyboardType="number-pad"
          />
          <ActionButton
            label={
              confirm.isPending
                ? tr(locale, "جاري التفعيل...", "Enabling...")
                : tr(locale, "تفعيل التحقق", "Enable verification")
            }
            disabled={confirm.isPending || code.trim().length !== 6}
            onPress={() => {
              confirm.mutate();
            }}
          />
          {confirm.error ? (
            <Text style={[auth.error, rtlText(locale)]}>
              {confirm.error.message}
            </Text>
          ) : null}
        </>
      )}
    </>
  );
}

function Workspace({
  me,
  locale,
  toggleLocale,
  onLogout,
}: {
  me: Me;
  locale: Locale;
  toggleLocale: () => void;
  onLogout: () => Promise<void>;
}) {
  const p = usePalette();
  const permissions = me.access.permissions;
  const screens = [
    {
      name: "Today",
      ar: "اليوم",
      icon: "⌂",
      show: true,
      component: TodayScreen,
    },
    {
      name: "Customers",
      ar: "العملاء",
      icon: "◉",
      show: permissions.includes("accounts.view"),
      component: CustomersScreen,
    },
    {
      name: "Pipeline",
      ar: "الفرص",
      icon: "↗",
      show: permissions.includes("opportunities.view"),
      component: PipelineScreen,
    },
    {
      name: "Work",
      ar: "المتابعات",
      icon: "✓",
      show: permissions.includes("activities.view"),
      component: WorkScreen,
    },
  ];
  return (
    <NavigationContainer theme={p.dark ? DarkTheme : DefaultTheme}>
      <Tabs.Navigator
        screenOptions={{
          headerStyle: { backgroundColor: p.navy },
          headerTintColor: "white",
          headerTitle: "ABP Commercial",
          headerTitleStyle: { fontWeight: "900" },
          tabBarActiveTintColor: p.red,
          tabBarInactiveTintColor: p.muted,
          tabBarStyle: {
            backgroundColor: p.surface,
            borderTopColor: p.border,
            height: 62,
            paddingBottom: 7,
            paddingTop: 5,
          },
          headerRight: () => (
            <Pressable
              onPress={toggleLocale}
              style={{ paddingHorizontal: 16, paddingVertical: 8 }}
            >
              <Text style={{ color: "white", fontWeight: "900" }}>
                {locale === "ar" ? "EN" : "AR"}
              </Text>
            </Pressable>
          ),
        }}
      >
        {screens
          .filter((item) => item.show)
          .map((item) => (
            <Tabs.Screen
              key={item.name}
              name={item.name}
              options={{
                title: locale === "ar" ? item.ar : item.name,
                tabBarIcon: ({ color }) => (
                  <Text style={{ color, fontSize: 19, fontWeight: "900" }}>
                    {item.icon}
                  </Text>
                ),
              }}
            >
              {() => <item.component locale={locale} me={me} />}
            </Tabs.Screen>
          ))}
        <Tabs.Screen
          name="More"
          options={{
            title: tr(locale, "المزيد", "More"),
            tabBarIcon: ({ color }) => (
              <Text style={{ color, fontSize: 20, fontWeight: "900" }}>
                •••
              </Text>
            ),
          }}
        >
          {() => <MoreScreen locale={locale} me={me} onLogout={onLogout} />}
        </Tabs.Screen>
      </Tabs.Navigator>
    </NavigationContainer>
  );
}

function Root() {
  const [locale, setLocale] = useState<Locale>("ar");
  const queryClient = useQueryClient();
  useEffect(() => {
    void AsyncStorage.getItem("abp.locale").then((value) => {
      if (value === "ar" || value === "en") setLocale(value);
    });
  }, []);
  const me = useQuery({
    queryKey: ["me"],
    queryFn: () => salesApi.me(),
    retry: false,
  });
  const toggleLocale = () => {
    const next = locale === "ar" ? "en" : "ar";
    setLocale(next);
    void AsyncStorage.setItem("abp.locale", next);
  };
  const refreshMe = async () => {
    await queryClient.invalidateQueries({ queryKey: ["me"] });
  };
  const logout = async () => {
    await salesApi.logout();
    queryClient.clear();
    await queryClient.invalidateQueries({ queryKey: ["me"] });
  };

  if (me.isLoading)
    return (
      <SafeAreaView style={{ flex: 1 }}>
        <ActivityIndicator style={{ flex: 1 }} color="#c8202f" size="large" />
      </SafeAreaView>
    );
  if (!me.data)
    return (
      <AuthShell locale={locale} onLocale={toggleLocale}>
        <SignIn locale={locale} onAuthenticated={refreshMe} />
      </AuthShell>
    );
  if (me.data.user.mustChangePassword)
    return (
      <AuthShell locale={locale} onLocale={toggleLocale}>
        <PasswordChange locale={locale} onComplete={refreshMe} />
      </AuthShell>
    );
  if (me.data.user.mfaRequired && !me.data.user.mfaEnabled)
    return (
      <AuthShell locale={locale} onLocale={toggleLocale}>
        <MfaEnrollment locale={locale} onComplete={refreshMe} />
      </AuthShell>
    );
  return (
    <Workspace
      me={me.data}
      locale={locale}
      toggleLocale={toggleLocale}
      onLogout={logout}
    />
  );
}

class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <SafeAreaView style={{ flex: 1 }}>
        <MessageState
          title="تعذر فتح الشاشة / Couldn't open this screen"
          locale="ar"
          onRetry={() => {
            this.setState({ failed: false });
          }}
        />
      </SafeAreaView>
    ) : (
      this.props.children
    );
  }
}

export default function App() {
  return (
    <SafeAreaProvider>
      <Boundary>
        <QueryClientProvider client={queryClient}>
          <Root />
        </QueryClientProvider>
      </Boundary>
    </SafeAreaProvider>
  );
}

const auth = StyleSheet.create({
  page: { flex: 1 },
  scroll: { flexGrow: 1, justifyContent: "center", padding: 20 },
  brandRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  logo: {
    width: 58,
    height: 58,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  logoText: { color: "white", fontWeight: "900", fontSize: 17 },
  locale: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  panel: { borderWidth: 1, borderRadius: 24, padding: 22 },
  title: { fontSize: 28, fontWeight: "900", lineHeight: 35 },
  detail: { fontSize: 14, lineHeight: 21, marginTop: 7 },
  label: { fontSize: 13, fontWeight: "800", marginBottom: 7 },
  input: {
    minHeight: 51,
    borderWidth: 1,
    borderRadius: 13,
    paddingHorizontal: 14,
    fontSize: 16,
  },
  hint: { color: "#b66b08", fontSize: 12, marginBottom: 4 },
  error: {
    backgroundColor: "#fee9ec",
    color: "#a51224",
    borderRadius: 10,
    padding: 11,
    marginTop: 12,
    fontSize: 13,
  },
  linkButton: { alignItems: "center", paddingVertical: 11 },
  server: { fontSize: 10, textAlign: "center", marginTop: 14 },
  secret: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 13,
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace" }),
    marginBottom: 17,
  },
  codes: { borderWidth: 1, borderRadius: 14, padding: 15, gap: 7 },
  code: {
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace" }),
    fontSize: 16,
    textAlign: "center",
  },
});
