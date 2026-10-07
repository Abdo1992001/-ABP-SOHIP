import { useState } from "react";
import { Link } from "react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { ApiClient, components } from "@abp/api-client";
import { permissions } from "@abp/contracts";
import { useI18n } from "../i18n/i18n.tsx";
import { listContacts } from "../api/contact-api.ts";
import type { Me } from "../api/customer-api.ts";
import { commercialRequest } from "./commercial-api.ts";
import { ErrorBanner, StatusChip, useToast } from "./CommercialUI.tsx";

/**
 * Who is on this site, and in what capacity.
 *
 * The tab this replaces listed the parties as `Name · DEVELOPER · Primary` in
 * English only, with no way to remove one and no way to say which person at
 * that company plays which role. Both endpoints for that existed:
 * `DELETE /project-parties/{partyId}` and
 * `POST /project-parties/{partyId}/contact-roles`.
 *
 * The delete could not in fact have been called before this session: it
 * requires the party's own `rowVersion` in `If-Match`, and the project
 * response did not carry one — the project's rowVersion is a different
 * counter, which the endpoint rejects. That is fixed in the contract, so the
 * precondition can now be satisfied honestly rather than guessed at.
 */

type Party = components["schemas"]["ProjectPartySummary"];

export function ProjectPartiesPanel({
  client,
  me,
  parties,
  onChanged,
}: {
  client: ApiClient;
  me: Me;
  parties: readonly Party[];
  onChanged: () => Promise<void>;
}) {
  const { locale } = useI18n();
  const txt = (en: string, ar: string) => (locale === "ar" ? ar : en);
  const toast = useToast();
  const canEdit = me.access.permissions.includes(permissions.projectsEdit);

  const [confirming, setConfirming] = useState<string | null>(null);
  const [roleFor, setRoleFor] = useState<Party | null>(null);

  const remove = useMutation({
    mutationFn: (party: Party) =>
      commercialRequest(client, "DELETE", "/project-parties/{partyId}", {
        path: { partyId: party.projectPartyId },
        ifMatch: party.rowVersion,
        idempotencyKey: crypto.randomUUID(),
      }),
    onSuccess: async () => {
      setConfirming(null);
      await onChanged();
      toast.success(txt("Party removed", "تم حذف الطرف"));
    },
  });

  return (
    <div className="project-parties">
      <p className="settings-hint">
        {txt(
          "The companies on this site. Quotations and orders are raised against them, so a party removed here stops appearing as a choice — it does not touch work already recorded.",
          "الشركات اللي على الموقع ده. عروض الأسعار والأوردرات بتتعمل عليهم، فالطرف اللي بيتشال من هنا بيبطل يظهر كاختيار — ومبيأثرش على شغل اتسجّل خلاص.",
        )}
      </p>

      <ErrorBanner
        error={remove.error}
        retry={() => {
          remove.reset();
        }}
      />

      <ul className="party-list">
        {parties.map((party) => (
          <li key={party.projectPartyId}>
            <div className="party-identity">
              <Link to={`/customers/${party.account.accountId}`}>
                {party.account.canonicalName}
              </Link>
              <span className="party-ref" data-abp-num>
                {party.account.accountRef}
              </span>
            </div>
            <StatusChip code={party.roleCode} />
            {party.primaryFlag && (
              <span className="party-primary">
                {txt("Primary", "الطرف الرئيسي")}
              </span>
            )}

            {canEdit && (
              <div className="party-actions">
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => {
                    setRoleFor(
                      roleFor?.projectPartyId === party.projectPartyId
                        ? null
                        : party,
                    );
                  }}
                >
                  {txt("Who to contact", "مين نكلّمه")}
                </button>
                {/* The primary party cannot be removed — the server refuses to
                    leave a project with none, and offering a control that is
                    going to 409 is worse than not offering it. */}
                {!party.primaryFlag &&
                  (confirming === party.projectPartyId ? (
                    <>
                      <button
                        type="button"
                        className="danger"
                        disabled={remove.isPending}
                        onClick={() => {
                          remove.mutate(party);
                        }}
                      >
                        {remove.isPending
                          ? txt("Removing…", "بيتشال…")
                          : txt("Yes, remove", "أيوه، شيله")}
                      </button>
                      <button
                        type="button"
                        className="ghost-button"
                        onClick={() => {
                          setConfirming(null);
                        }}
                      >
                        {txt("Cancel", "إلغاء")}
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={() => {
                        setConfirming(party.projectPartyId);
                      }}
                    >
                      {txt("Remove", "حذف")}
                    </button>
                  ))}
              </div>
            )}

            {roleFor?.projectPartyId === party.projectPartyId && (
              <ContactRoleForm
                client={client}
                party={party}
                onDone={async () => {
                  setRoleFor(null);
                  await onChanged();
                }}
              />
            )}
          </li>
        ))}
      </ul>

      {parties.length === 1 && (
        <p className="settings-hint">
          {txt(
            "Only the primary party is on this project. A project always keeps at least one.",
            "الطرف الرئيسي بس هو اللي على المشروع ده. المشروع دايمًا بيفضل فيه واحد على الأقل.",
          )}
        </p>
      )}
    </div>
  );
}

/**
 * Naming the person at a party who plays a role on this project.
 *
 * The contact list is fetched from the party's own account, so you cannot
 * accidentally attach somebody from a different company — which is the mistake
 * a free-text field would invite.
 */
function ContactRoleForm({
  client,
  party,
  onDone,
}: {
  client: ApiClient;
  party: Party;
  onDone: () => Promise<void>;
}) {
  const { locale } = useI18n();
  const txt = (en: string, ar: string) => (locale === "ar" ? ar : en);
  const toast = useToast();
  const [contactId, setContactId] = useState("");
  const [roleCode, setRoleCode] = useState<string>("SITE_ENGINEER");

  const contacts = useQuery({
    queryKey: ["account-contacts", party.account.accountId],
    queryFn: () =>
      listContacts(client, party.account.accountId, { page: 1, limit: 50 }),
  });

  const assign = useMutation({
    mutationFn: () =>
      commercialRequest(
        client,
        "POST",
        "/project-parties/{partyId}/contact-roles",
        {
          path: { partyId: party.projectPartyId },
          body: { contactId, roleCode },
          idempotencyKey: crypto.randomUUID(),
        },
      ),
    onSuccess: async () => {
      toast.success(txt("Contact assigned", "تم تعيين جهة الاتصال"));
      await onDone();
    },
  });

  const people = contacts.data?.data ?? [];

  return (
    <form
      className="party-role-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!assign.isPending && contactId !== "") assign.mutate();
      }}
    >
      <ErrorBanner
        error={assign.error ?? contacts.error}
        retry={() => {
          assign.reset();
          void contacts.refetch();
        }}
      />
      {people.length === 0 && !contacts.isLoading ? (
        <p className="settings-hint">
          {txt(
            "No contacts are on file for this company yet — add one on the customer first.",
            "مفيش جهات اتصال متسجّلة للشركة دي لسه — ضيف واحدة على العميل الأول.",
          )}
        </p>
      ) : (
        <>
          <label className="settings-field">
            {txt("Person", "الشخص")}
            <select
              value={contactId}
              onChange={(event) => {
                setContactId(event.target.value);
              }}
            >
              <option value="">
                {contacts.isLoading
                  ? txt("Loading…", "جارٍ التحميل…")
                  : txt("Choose a contact", "اختر جهة اتصال")}
              </option>
              {people.map((person) => (
                <option key={person.contactId} value={person.contactId}>
                  {person.displayName}
                  {person.jobTitle ? ` — ${person.jobTitle}` : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="settings-field">
            {txt("Role on this project", "دوره في المشروع ده")}
            <select
              value={roleCode}
              onChange={(event) => {
                setRoleCode(event.target.value);
              }}
            >
              {PROJECT_CONTACT_ROLES.map((role) => (
                <option key={role.code} value={role.code}>
                  {locale === "ar" ? role.ar : role.en}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            className="secondary"
            disabled={assign.isPending || contactId === ""}
          >
            {txt("Assign", "تعيين")}
          </button>
        </>
      )}
    </form>
  );
}

/** What a person does on a site, rather than their job title at the company. */
const PROJECT_CONTACT_ROLES = [
  { code: "SITE_ENGINEER", en: "Site engineer", ar: "مهندس الموقع" },
  { code: "PROJECT_MANAGER", en: "Project manager", ar: "مدير المشروع" },
  { code: "PROCUREMENT", en: "Procurement", ar: "المشتريات" },
  { code: "TECHNICAL_OFFICE", en: "Technical office", ar: "المكتب الفني" },
  { code: "SITE_FOREMAN", en: "Foreman", ar: "المشرف" },
] as const;
