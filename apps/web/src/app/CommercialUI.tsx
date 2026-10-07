import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../i18n/i18n.tsx";
import { enumLabel, enumTone, type ChipTone } from "../i18n/enum-labels.ts";
import { screenPurpose } from "./screen-purpose.ts";

export function ErrorBanner({
  error,
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  const { locale, t } = useI18n();
  if (!error) return null;
  const rawMessage =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "Unknown error";
  const message =
    {
      "errors.external_ai_disabled":
        locale === "ar"
          ? "مساعدة OpenAI غير مفعّلة على الخادم. أضف المفتاح وفعّل التكامل من إعدادات التشغيل."
          : "OpenAI assistance is disabled on the server. Add the key and enable the integration in runtime settings.",
      "errors.external_ai_unavailable":
        locale === "ar"
          ? "تعذر الوصول إلى OpenAI حالياً. لم يتم حفظ أي نتيجة؛ حاول مرة أخرى لاحقاً."
          : "OpenAI is currently unavailable. No result was saved; try again later.",
      "errors.unauthenticated":
        locale === "ar"
          ? "انتهت جلسة الدخول. سجّل الدخول مرة أخرى للمتابعة."
          : "Your session has ended. Sign in again to continue.",
      "errors.forbidden":
        locale === "ar"
          ? "ليس لديك صلاحية لتنفيذ هذا الإجراء."
          : "You do not have permission to perform this action.",
      "errors.not_found":
        locale === "ar"
          ? "السجل المطلوب غير موجود أو لم يعد متاحًا."
          : "The requested record was not found or is no longer available.",
      "errors.concurrency_conflict":
        locale === "ar"
          ? "تم تحديث السجل من مستخدم آخر. حدّث الصفحة ثم حاول مرة أخرى."
          : "Another user updated this record. Refresh and try again.",
      HTTP_401:
        locale === "ar"
          ? "انتهت جلسة الدخول. سجّل الدخول مرة أخرى للمتابعة."
          : "Your session has ended. Sign in again to continue.",
      HTTP_403:
        locale === "ar"
          ? "ليس لديك صلاحية لتنفيذ هذا الإجراء."
          : "You do not have permission to perform this action.",
      "errors.quotation_content_hash_required":
        locale === "ar"
          ? "عرض السعر لسه متجهّزش للإرسال. اضغط «تجهيز العرض» الأول، وبعدين اطلب الموافقة."
          : "This quotation has not been prepared for sending yet. Prepare it first, then request approval.",
      "errors.quotation_approval_required":
        locale === "ar"
          ? "النسخة دي محتاجة موافقة قبل ما تتبعت. اطلب الموافقة من تبويب الموافقات."
          : "This version needs an approval before it can be sent. Request one on the Approval tab.",
      "errors.email_not_configured":
        locale === "ar"
          ? "الإيميل مش متظبط على السيرفر لسه. اختار «أنا بعته بنفسي»، أو اطلب من الأدمن يظبطه."
          : 'Email is not set up on the server yet. Choose "I sent it myself", or ask an administrator to set it up.',
      "errors.recipient_email_required":
        locale === "ar"
          ? "كل مستلم لازم يكون ليه إيميل."
          : "Every recipient needs an email address.",
      "errors.recipient_required":
        locale === "ar"
          ? "اختار مستلم واحد على الأقل."
          : "Choose at least one recipient.",
      "errors.your_email_is_missing":
        locale === "ar"
          ? "حسابك ملوش إيميل، فمش هينفع نبعتلك الإيميل التجريبي."
          : "Your account has no email address to send the test to.",
    }[rawMessage] ?? readable(rawMessage, locale);
  return (
    <div className="error-banner" role="alert">
      <span>{message}</span>
      <button type="button" onClick={retry}>
        {t("retry")}
      </button>
    </div>
  );
}

/**
 * A code the table above has no words for, made readable rather than shown as
 * "errors.something_went_wrong" -- the key itself means nothing to the person
 * reading it.
 */
function readable(message: string, locale: string): string {
  const code = /^errors\.([a-z0-9_]+)$/i.exec(message)?.[1];
  if (code === undefined) return message;
  const words = code.replace(/_/g, " ").toLowerCase();
  const sentence = `${words.charAt(0).toUpperCase()}${words.slice(1)}.`;
  return locale === "ar" ? `مقدرناش نكمّل: ${sentence}` : sentence;
}

export function StatusChip({
  code,
  tone,
}: {
  code: string | null | undefined;
  tone?: ChipTone;
}) {
  const { locale } = useI18n();
  if (!code) return null;
  const resolvedTone = tone ?? enumTone(code);
  return (
    <span className={`abp2-chip abp2-chip-${resolvedTone}`}>
      <span className="abp2-chip-dot" aria-hidden="true" />
      {enumLabel(code, locale)}
    </span>
  );
}

export function InfoTooltip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <span className="info-tooltip">
      <button
        type="button"
        className="info-tooltip-trigger"
        aria-label={text}
        aria-describedby={id}
        onClick={() => {
          setOpen((value) => !value);
        }}
        onMouseEnter={() => {
          setOpen(true);
        }}
        onMouseLeave={() => {
          setOpen(false);
        }}
        onBlur={() => {
          setOpen(false);
        }}
      >
        i
      </button>
      {open && (
        <span role="tooltip" id={id} className="info-tooltip-bubble">
          {text}
        </span>
      )}
    </span>
  );
}

export function TabBar({
  tabs,
  active,
  onChange,
}: {
  tabs: readonly { id: string; en: string; ar: string }[];
  active: string;
  onChange: (id: string) => void;
}) {
  const { locale } = useI18n();
  return (
    <nav className="tab-bar" role="tablist">
      {tabs.map((tab, index) => (
        <button
          type="button"
          role="tab"
          key={tab.id}
          aria-selected={active === tab.id}
          tabIndex={active === tab.id ? 0 : -1}
          onClick={() => {
            onChange(tab.id);
          }}
          onKeyDown={(event) => {
            const step =
              event.key === "ArrowRight"
                ? 1
                : event.key === "ArrowLeft"
                  ? -1
                  : 0;
            if (step || event.key === "Home" || event.key === "End") {
              event.preventDefault();
              const next =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? tabs.length - 1
                    : (index + step + tabs.length) % tabs.length;
              const target = tabs[next];
              if (target) onChange(target.id);
              (
                event.currentTarget.parentElement?.children[next] as
                  HTMLElement | undefined
              )?.focus({ preventScroll: true });
            }
          }}
        >
          {tab[locale]}
        </button>
      ))}
    </nav>
  );
}

export function Sparkline({
  data,
  color = "#0e0b53",
}: {
  data: readonly number[];
  color?: string;
}) {
  const id = useId().replaceAll(":", "");
  const values = data.length > 0 ? data : [0];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(max - min, 1);
  const points = values
    .map((value, index) => {
      const x = values.length === 1 ? 50 : (index / (values.length - 1)) * 100;
      const y = 54 - ((value - min) / span) * 48;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
  return (
    <div
      className="metric-sparkline"
      role="img"
      aria-label={`Trend: ${values.join(", ")}`}
    >
      <svg viewBox="0 0 100 60" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.3" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon points={`0,60 ${points} 100,60`} fill={`url(#${id})`} />
        <polyline
          points={points}
          fill="none"
          stroke={color}
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
        />
        {values.length === 1 && <circle cx="50" cy="54" r="2" fill={color} />}
      </svg>
    </div>
  );
}

export function SlideOver({
  title,
  children,
  onClose,
  // "side" is the editing drawer this component was built for. "centre" is a
  // dialog for reading: a ranked table or a record's detail, where a panel
  // pinned to one edge wastes the width the content needs.
  variant = "side",
  width,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  variant?: "side" | "centre";
  width?: number | undefined;
}) {
  const ref = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const { t } = useI18n();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.focus({ preventScroll: true });
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeRef.current();
      if (event.key === "Tab") {
        const nodes = Array.from(
          ref.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input:not(:disabled), select, textarea, a[href], [tabindex="0"]',
          ) ?? [],
        );
        const first = nodes[0],
          last = nodes.at(-1);
        if (
          event.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === ref.current)
        ) {
          event.preventDefault();
          last?.focus({ preventScroll: true });
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus({ preventScroll: true });
        }
      }
    };
    document.addEventListener("keydown", keydown);
    return () => {
      document.removeEventListener("keydown", keydown);
      previous?.focus({ preventScroll: true });
    };
  }, []);
  /**
   * Rendered into the app shell, not in place, and deliberately not into
   * `document.body`.
   *
   * `position: fixed` is only fixed to the viewport while no ancestor has a
   * transform, filter or containment -- any one of those makes that ancestor
   * the containing block instead. `.route-content` animates in, and an
   * interpolated transform stays applied as a matrix while it does, so a
   * dialog inside it was centred within the full height of the page content
   * rather than the screen: on a long page it opened around y=2048 and you
   * had to scroll down to find it.
   *
   * The escape has to stop at `.app-shell`. Going all the way to `document.
   * body` also leaves the `.app-shell`/`.abp2-shell` scope that every panel,
   * field and button style is written against, and the dialog renders in the
   * base light palette on top of the dark app -- pale text on a white card.
   * `.app-shell` is outside `.route-content` and carries both class hooks, so
   * it escapes the transform and keeps the theme.
   */
  const host =
    document.querySelector<HTMLElement>(".app-shell") ?? document.body;
  return createPortal(
    <div
      className={`slideover-backdrop${variant === "centre" ? " is-centre" : ""}`}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={ref}
        tabIndex={-1}
        className={`slideover${variant === "centre" ? " slideover-centre" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        {...(width === undefined
          ? {}
          : { style: { width: `min(${String(width)}px, 96vw)` } })}
      >
        <header className="slideover-header">
          <h2>{title}</h2>
          <button type="button" onClick={onClose} aria-label={t("close")}>
            ×
          </button>
        </header>
        <div className="slideover-body">{children}</div>
      </section>
    </div>,
    host,
  );
}

type ToastKind = "success" | "error" | "info";
type ToastApi = Record<ToastKind, (message: string) => void>;
const ToastContext = createContext<ToastApi>({
  success: () => {},
  error: () => {},
  info: () => {},
});
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<
    { id: number; kind: ToastKind; message: string }[]
  >([]);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const sequence = useRef(0);
  useEffect(
    () => () => {
      timers.current.forEach(clearTimeout);
    },
    [],
  );
  const add = (kind: ToastKind, message: string) => {
    const id = ++sequence.current;
    setItems((current) => [...current, { id, kind, message }]);
    timers.current.push(
      setTimeout(() => {
        setItems((current) => current.filter((item) => item.id !== id));
      }, 5000),
    );
  };
  return (
    <ToastContext.Provider
      value={{
        success: (message) => {
          add("success", message);
        },
        error: (message) => {
          add("error", message);
        },
        info: (message) => {
          add("info", message);
        },
      }}
    >
      {children}
      <div className="toast-container" aria-live="polite">
        {items.map((item) => (
          <div className={`toast ${item.kind}`} key={item.id}>
            {item.message}
            <button
              onClick={() => {
                setItems((current) =>
                  current.filter((value) => value.id !== item.id),
                );
              }}
              aria-label="Close"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
export const useToast = () => useContext(ToastContext);

// ---- Redesign shared primitives (see README handoff: Page header, KPI
// card, Stat card, Table, Filter bar, Tabs). All scoped under .abp2-shell
// (applied once at the app root in App.tsx), so these compose with the
// existing abp2-* token layer without touching any un-migrated screen.

/**
 * Which screen is on the page, so a shared header can describe it.
 *
 * The alternative is a `sub` prop threaded through sixty-nine components, which
 * is sixty-nine places for the wording to drift and one place — the screen that
 * gets forgotten — for it to go missing entirely. The route already knows which
 * screen it is; this just lets the header ask.
 */
const ScreenIdContext = createContext<string | null>(null);

export function ScreenIdProvider({
  screenId,
  children,
}: {
  screenId: string;
  children: ReactNode;
}) {
  return (
    <ScreenIdContext.Provider value={screenId}>
      {children}
    </ScreenIdContext.Provider>
  );
}

export const useScreenId = () => useContext(ScreenIdContext);

/**
 * "What is this screen, and where do its numbers come from."
 *
 * The purpose is one line and always shown — it takes the space a subtitle was
 * already using. The provenance is a disclosure, closed by default: it answers
 * a question somebody asks once about a screen and then never again, so
 * printing it permanently would add exactly the clutter it exists to reduce.
 *
 * Rendered as a plain <details> so it works before hydration, keyboard-opens
 * without a handler, and is found by the browser's own in-page search even
 * while closed.
 */
export function ScreenIntro({
  screenId,
  hidePurpose = false,
}: {
  screenId?: string;
  hidePurpose?: boolean;
}) {
  const { locale } = useI18n();
  const contextId = useScreenId();
  const id = screenId ?? contextId;
  const entry = id === null ? undefined : screenPurpose[id];
  if (entry === undefined) return null;
  const ar = locale === "ar";
  return (
    <div className="screen-intro">
      {!hidePurpose && (
        <p className="screen-intro-purpose">
          {ar ? entry.purpose.ar : entry.purpose.en}
        </p>
      )}
      <details className="screen-intro-source">
        <summary>
          {ar ? "الداتا دي جاية منين؟" : "Where this comes from"}
        </summary>
        <p>{ar ? entry.source.ar : entry.source.en}</p>
      </details>
    </div>
  );
}

export function PageHeader({
  kicker,
  title,
  titleId,
  count,
  sub,
  status,
  actions,
  screenId,
}: {
  kicker: string;
  title: string;
  titleId?: string;
  count?: number | string;
  /**
   * This screen's own explanation of itself, when it can say something more
   * specific than the registry line — which it then replaces.
   */
  sub?: string;
  /**
   * How things stand right now: "3 items are past due", "results for …".
   * A status is not an explanation, so unlike `sub` it sits *alongside* the
   * registry line instead of replacing it. Conflating the two left the action
   * queue introducing itself as "Nothing is overdue", which tells somebody
   * opening it for the first time nothing at all about what it is.
   */
  status?: string;
  actions?: ReactNode;
  /** Overrides the screen the route is on; normally left to the context. */
  screenId?: string;
}) {
  return (
    <header className="abp2-page-header">
      <div>
        <p className="abp2-page-kicker" data-abp-caption>
          {kicker}
        </p>
        <div className="abp2-page-title-row">
          <h1 id={titleId}>{title}</h1>
          {count !== undefined && (
            <span className="abp2-count-pill">{count}</span>
          )}
        </div>
        {sub && <p className="abp2-page-sub">{sub}</p>}
        {status !== undefined && status !== "" && (
          <p className="abp2-page-status">{status}</p>
        )}
        {/* A screen's own `sub` wins when it has one — it is usually more
            specific than the registry line. The provenance is added either
            way, because that is the half nobody thinks to write. */}
        <ScreenIntro
          {...(screenId === undefined ? {} : { screenId })}
          hidePurpose={sub !== undefined}
        />
      </div>
      {actions && <div className="abp2-page-actions">{actions}</div>}
    </header>
  );
}

export function KpiCard({
  icon,
  label,
  value,
  tone = "neutral",
  caption,
  progressPct,
  index = 0,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  tone?: ChipTone | "brand";
  caption?: string;
  progressPct?: number;
  index?: number;
}) {
  return (
    <div
      className={`abp2-kpi-card abp2-tone-${tone}`}
      style={{ animationDelay: `${String(80 + index * 70)}ms` }}
    >
      <span className="abp2-kpi-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="abp2-kpi-label">{label}</span>
      <strong className="abp2-kpi-value">{value}</strong>
      {progressPct !== undefined && (
        <div className="abp2-kpi-progress">
          <div className="abp2-kpi-progress-track">
            <div
              className="abp2-kpi-progress-fill"
              style={{
                width: `${String(Math.max(0, Math.min(100, progressPct)))}%`,
              }}
            />
          </div>
          <span className="abp2-kpi-progress-pct">
            {progressPct.toFixed(2)}%
          </span>
        </div>
      )}
      {caption && <span className="abp2-kpi-caption">{caption}</span>}
    </div>
  );
}

export function StatCard({
  label,
  value,
  tone = "neutral",
  index = 0,
}: {
  label: string;
  value: ReactNode;
  tone?: ChipTone;
  index?: number;
}) {
  return (
    <div
      className={`abp2-stat-card abp2-tone-${tone}`}
      style={{ animationDelay: `${String(80 + index * 70)}ms` }}
    >
      <span className="abp2-stat-label">
        <span className="abp2-stat-dot" aria-hidden="true" />
        {label}
      </span>
      <strong className="abp2-stat-value">{value}</strong>
    </div>
  );
}

export function EmptyScreen({
  title,
  message,
  action,
}: {
  title: string;
  message?: string;
  action?: ReactNode;
}) {
  return (
    <div className="abp2-empty-screen">
      <span className="abp2-empty-icon" aria-hidden="true">
        ◌
      </span>
      <h2>{title}</h2>
      {message && <p>{message}</p>}
      {action}
    </div>
  );
}

export function FilterBar({ children }: { children: ReactNode }) {
  return <div className="abp2-filter-bar">{children}</div>;
}

export function FilterField({
  label,
  children,
  span,
}: {
  label: string;
  children: ReactNode;
  span?: 2;
}) {
  return (
    <label
      className={`abp2-filter-field${span === 2 ? " abp2-filter-field-wide" : ""}`}
    >
      <span>{label}</span>
      {children}
    </label>
  );
}

export type TableColumn = { label: string; alignEnd?: boolean };
export type TableCell =
  | { kind: "default" | "strong" | "muted" | "mono" | "num"; text: string }
  | { kind: "chip"; text: string; tone: ChipTone }
  | { kind: "node"; node: ReactNode };

export function DataTable({
  columns,
  rows,
  rowKey,
  minWidth = 640,
}: {
  columns: readonly TableColumn[];
  rows: readonly (readonly TableCell[])[];
  rowKey?: (rowIndex: number) => string | number;
  minWidth?: number;
}) {
  return (
    <div className="abp2-table-scroll">
      <table className="abp2-data-table" style={{ minWidth }}>
        <thead>
          <tr>
            {columns.map((column, index) => (
              <th
                key={index}
                style={{ textAlign: column.alignEnd ? "end" : "start" }}
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr
              key={rowKey ? rowKey(rowIndex) : rowIndex}
              style={{
                animationDelay: `${String(Math.min(160 + rowIndex * 50, 900))}ms`,
              }}
            >
              {row.map((cell, cellIndex) => (
                <td
                  key={cellIndex}
                  className={
                    cell.kind !== "chip" && cell.kind !== "node"
                      ? `abp2-cell-${cell.kind}`
                      : undefined
                  }
                >
                  {cell.kind === "chip" ? (
                    <span className={`abp2-chip abp2-chip-${cell.tone}`}>
                      <span className="abp2-chip-dot" aria-hidden="true" />
                      {cell.text}
                    </span>
                  ) : cell.kind === "node" ? (
                    cell.node
                  ) : (
                    cell.text
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AppIcon({ id }: { id: string }) {
  const paths: Record<string, ReactNode> = {
    HOME: (
      <>
        <path d="M3 10.5 12 3l9 7.5" />
        <path d="M5.5 9.5V21h13V9.5" />
        <path d="M9.5 21v-7h5v7" />
      </>
    ),
    CUSTOMERS: (
      <>
        <circle cx="9" cy="8" r="3" />
        <circle cx="17" cy="9" r="2.5" />
        <path d="M3.5 20c.3-4 2-6 5.5-6s5.2 2 5.5 6" />
        <path d="M14 15c3.9-.7 6 1 6.5 4" />
      </>
    ),
    CONTACTS: (
      <>
        <rect x="4" y="3" width="16" height="18" rx="3" />
        <circle cx="12" cy="9" r="2.5" />
        <path d="M8 17c.5-2.3 1.8-3.5 4-3.5s3.5 1.2 4 3.5" />
      </>
    ),
    PROJECTS: (
      <>
        <path d="M3 7h7l2 2h9v11H3z" />
        <path d="M3 7V5h7l2 2" />
      </>
    ),
    OPPORTUNITIES: (
      <>
        <path d="M12 3a7 7 0 0 0-4 12.7V19h8v-3.3A7 7 0 0 0 12 3Z" />
        <path d="M9 22h6M9 11h6" />
      </>
    ),
    ACTIVITIES: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="m8 12 2.5 2.5L16.5 9" />
      </>
    ),
    CALENDAR: (
      <>
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M7 3v4m10-4v4M3 10h18" />
      </>
    ),
    PRODUCTS: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </>
    ),
    QUOTATIONS: (
      <>
        <path d="M6 2h9l4 4v16H6z" />
        <path d="M14 2v5h5M9 12h6m-6 4h6" />
      </>
    ),
    CUSTOMER_ORDERS: (
      <>
        <rect x="5" y="4" width="14" height="18" rx="2" />
        <path d="M9 4V2.5h6V4M8.5 13l2.5 2.5 4.5-5" />
      </>
    ),
    REPORTS: (
      <>
        <path d="M4 20V10m6 10V4m6 16v-7m4 7H2" />
      </>
    ),
    NOTIFICATIONS: (
      <>
        <path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
        <path d="M10 22h4" />
      </>
    ),
    ACTIONS: (
      <>
        <path d="M5 4h14v16H5z" />
        <path d="m8 9 1.5 1.5L12 8m2 2h3M8 15l1.5 1.5L12 14m2 2h3" />
      </>
    ),
    MANAGEMENT: (
      <>
        <path d="M4 20V9m6 11V4m6 16v-7m4 7H2" />
        <path d="m4 6 5-3 6 4 5-4" />
      </>
    ),
    SUPPORT: (
      <>
        <path d="M4 5h16v11H8l-4 4z" />
        <path d="M8 9h8m-8 3h5" />
      </>
    ),
    SEARCH: (
      <>
        <circle cx="11" cy="11" r="7" />
        <path d="m16.5 16.5 4 4" />
      </>
    ),
    MOON: <path d="M20 15.5A8 8 0 0 1 8.5 4 8.5 8.5 0 1 0 20 15.5Z" />,
    SUN: (
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </>
    ),
    COLLAPSE: (
      <>
        <path d="M15 18 9 12l6-6" />
        <path d="M21 4v16" />
      </>
    ),
    TARGET: (
      <>
        <circle cx="12" cy="12" r="9" />
        <circle cx="12" cy="12" r="5" />
        <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
      </>
    ),
    TROPHY: (
      <>
        <path d="M7 4h10v5a5 5 0 0 1-10 0Z" />
        <path d="M7 5H4v2a3 3 0 0 0 3 3M17 5h3v2a3 3 0 0 1-3 3" />
        <path d="M12 14v3m-3 3h6M9 20h6" />
      </>
    ),
    CLOCK: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3.5 2" />
      </>
    ),
    CHECK: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="m8 12 2.5 2.5L16.5 9" />
      </>
    ),
    PIPELINE: (
      <>
        <path d="M4 6h16l-6 7v6l-4 2v-8z" />
      </>
    ),
    TEAM_VALUE: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v10M9 9.5c0-1.4 1.3-2.5 3-2.5s3 1.1 3 2.2c0 3-6 1.5-6 4.5 0 1.4 1.3 2.5 3 2.5s3-1.1 3-2.3" />
      </>
    ),
    TREND_UP: (
      <>
        <path d="m4 16 6-6 4 4 6-8" />
        <path d="M14 6h6v6" />
      </>
    ),
    RECEIPT: (
      <>
        <path d="M6 3h12v18l-3-2-3 2-3-2-3 2Z" />
        <path d="M9 8h6M9 12h6" />
      </>
    ),
    IMPORT_DOWN: (
      <>
        <path d="M12 3v12m0 0 4-4m-4 4-4-4" />
        <path d="M4 17v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />
      </>
    ),
    CAPACITY_BOX: (
      <>
        <path d="M12 3 4 7v10l8 4 8-4V7z" />
        <path d="M4 7l8 4 8-4M12 11v10" />
      </>
    ),
  };
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[id] ?? <circle cx="12" cy="12" r="7" />}
    </svg>
  );
}

/**
 * The four cross-cutting states every screen needs and none of them had.
 *
 * Before these, a screen that was loading showed nothing, a screen whose
 * query failed showed nothing, and a screen the user lacked permission for
 * showed an empty list — which reads as "there is no data" rather than
 * "you may not see this". Those are three different messages and a user
 * cannot act on any of them if they all look the same.
 */

/** Shape-matched shimmer blocks, not a spinner: the page keeps its layout
 *  while it loads, so nothing jumps when the data lands. */
export function LoadingSkeleton({
  rows = 5,
  variant = "table",
  label,
}: {
  rows?: number;
  variant?: "table" | "cards" | "detail";
  label?: string;
}) {
  return (
    <div
      className={`abp-skeleton abp-skeleton-${variant}`}
      role="status"
      aria-live="polite"
      aria-label={label ?? "Loading"}
    >
      {Array.from({ length: Math.max(1, rows) }, (_unused, index) => (
        <span
          key={index}
          className="abp-skeleton-block"
          style={{ animationDelay: `${String(index * 90)}ms` }}
        />
      ))}
    </div>
  );
}

/** A failed query, with the retry that actually re-fires it. */
export function ErrorState({
  title,
  message,
  retryLabel,
  onRetry,
}: {
  title: string;
  message?: string;
  retryLabel: string;
  onRetry: () => void;
}) {
  return (
    <div className="abp-state abp-state-error" role="alert">
      <span className="abp-state-icon" aria-hidden="true">
        ◍
      </span>
      <h2>{title}</h2>
      {message !== undefined && message !== "" && <p>{message}</p>}
      <button
        type="button"
        className="abp-btn abp-btn-secondary"
        onClick={onRetry}
      >
        {retryLabel}
      </button>
    </div>
  );
}

/** 403. Says it is a permission, not an absence, and offers the way back. */
export function ForbiddenState({
  title,
  message,
  backLabel,
  backHref = "/",
}: {
  title: string;
  message?: string;
  backLabel: string;
  backHref?: string;
}) {
  return (
    <div className="abp-state abp-state-forbidden" role="alert">
      <span className="abp-state-icon" aria-hidden="true">
        ⬡
      </span>
      <h2>{title}</h2>
      {message !== undefined && message !== "" && <p>{message}</p>}
      <a className="abp-btn abp-btn-secondary" href={backHref}>
        {backLabel}
      </a>
    </div>
  );
}

export interface TabDefinition {
  id: string;
  label: string;
  /** Shown after the label, e.g. a row count. */
  badge?: string | number;
}

/** The tab strip from the handoff: 38px tall, 2px active underline in the
 *  brand colour, horizontally scrollable so a nine-tab record still works
 *  on a laptop. */
export function TabStrip({
  tabs,
  activeId,
  onSelect,
  label,
}: {
  tabs: readonly TabDefinition[];
  activeId: string;
  onSelect: (id: string) => void;
  label: string;
}) {
  return (
    <div className="abp-tabstrip" role="tablist" aria-label={label}>
      {tabs.map((tab, index) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          id={`tab-${tab.id}`}
          aria-selected={tab.id === activeId}
          aria-controls={`panel-${tab.id}`}
          className={`abp-tab${tab.id === activeId ? " is-active" : ""}`}
          style={{ animationDelay: `${String(60 + index * 35)}ms` }}
          onClick={() => {
            onSelect(tab.id);
          }}
        >
          {tab.label}
          {tab.badge !== undefined && (
            <span className="abp-tab-badge">{tab.badge}</span>
          )}
        </button>
      ))}
    </div>
  );
}
