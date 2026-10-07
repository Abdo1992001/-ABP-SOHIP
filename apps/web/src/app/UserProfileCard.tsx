import { useQuery } from "@tanstack/react-query";
import type { ApiClient } from "@abp/api-client";
import { useI18n } from "../i18n/i18n.tsx";
import { commercialRequest, isObject, str } from "./commercial-api.ts";
import { ErrorBanner, LoadingSkeleton } from "./CommercialUI.tsx";
import { UserAvatar } from "./UserAvatar.tsx";
import { enumLabel } from "../i18n/enum-labels.ts";

/**
 * One colleague, shown the way they chose to be shown.
 *
 * The card draws whatever the server sends and nothing else. It does not
 * receive a person's full record and decide what to omit — the visibility
 * rules are applied before the data leaves the API, so a field the owner has
 * hidden is simply not in the object. That is deliberate: a card that had to
 * remember to hide a phone number is a card that will one day forget.
 */
export function UserProfileCard({
  client,
  userId,
  onMessage,
}: {
  client: ApiClient;
  userId: string;
  /** Omitted where there is nowhere to send them, e.g. viewing yourself. */
  onMessage?: (() => void) | undefined;
}) {
  const { locale } = useI18n();
  const txt = (en: string, ar: string) => (locale === "ar" ? ar : en);
  const query = useQuery({
    queryKey: ["colleague", userId],
    queryFn: () =>
      commercialRequest(client, "GET", "/users/{userId}/profile", {
        path: { userId },
      }),
  });
  const person =
    isObject(query.data?.data) && isObject(query.data.data.data)
      ? query.data.data.data
      : null;

  if (query.isLoading) return <LoadingSkeleton rows={2} variant="detail" />;
  if (!person)
    return (
      <ErrorBanner error={query.error} retry={() => void query.refetch()} />
    );

  const displayName = str(person.displayName);
  const phone = typeof person.phone === "string" ? person.phone : null;
  const jobTitle = typeof person.jobTitle === "string" ? person.jobTitle : null;
  const roles = Array.isArray(person.roles)
    ? person.roles.map((code) => enumLabel(str(code), locale))
    : [];
  const portfolio = isObject(person.commercialPortfolio)
    ? person.commercialPortfolio
    : null;

  return (
    <article className="profile-card">
      <UserAvatar
        userId={userId}
        displayName={displayName}
        photoUpdatedAt={
          typeof person.photoUpdatedAt === "string"
            ? person.photoUpdatedAt
            : null
        }
        size="lg"
      />
      <div className="profile-card-body">
        <h3>
          {displayName}
          {person.active === false && (
            // A deactivated colleague keeps appearing in the history they are
            // part of; the badge says so rather than the record vanishing.
            <span className="profile-card-inactive">
              {txt("Inactive", "غير نشط")}
            </span>
          )}
        </h3>
        {/* Clean omissions: a field with nothing in it is left out, never
            rendered as "No phone available". */}
        {jobTitle !== null && <p className="profile-card-title">{jobTitle}</p>}
        {roles.length > 0 && (
          <p className="profile-card-role">{roles.join(" · ")}</p>
        )}
        <dl className="profile-card-contact">
          <dt>{txt("Email", "البريد")}</dt>
          <dd>{str(person.email)}</dd>
          {phone !== null && (
            <>
              <dt>{txt("Phone", "الهاتف")}</dt>
              <dd>{phone}</dd>
            </>
          )}
        </dl>
      </div>
      {portfolio && <CommercialPortfolio value={portfolio} />}
      {onMessage && person.active !== false && (
        <button type="button" className="primary" onClick={onMessage}>
          {txt("Message", "راسله")}
        </button>
      )}
    </article>
  );
}

export function CommercialPortfolio({
  value,
}: {
  value: Record<string, unknown>;
}) {
  const { locale } = useI18n();
  const ar = locale === "ar";
  const metrics = [
    ["customers", "Customers", "العملاء"],
    ["openOpportunities", "Open deals", "الفرص المفتوحة"],
    ["wonThisYear", "Won this year", "مكسب السنة"],
    ["draftQuotations", "Draft quotations", "مسودات الأسعار"],
    ["sentQuotations", "Sent / reviewing", "مرسل / تحت المراجعة"],
    ["openActivities", "Open activities", "المهام المفتوحة"],
  ] as const;
  const overdue = Number(value.overdueActivities ?? 0);
  return (
    <section className="sales-portfolio">
      <header>
        <div>
          <span>{ar ? "محفظة المبيعات" : "Sales portfolio"}</span>
          <h4>{ar ? "كل اللي عنده دلوقتي" : "Current commercial workload"}</h4>
        </div>
        {overdue > 0 && (
          <b>
            {ar ? `${String(overdue)} متأخر` : `${String(overdue)} overdue`}
          </b>
        )}
      </header>
      <dl>
        {metrics.map(([key, en, arText]) => (
          <div key={key}>
            <dt>{ar ? arText : en}</dt>
            <dd>
              {Number(value[key] ?? 0).toLocaleString(ar ? "ar-EG" : "en")}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
