import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import type { ApiClient } from "@abp/api-client";
import { permissions } from "@abp/contracts";
import {
  addContactChannel,
  getContact,
  removeContactChannel,
  updateContact,
} from "../api/contact-api.ts";
import { CustomerApiError, type Me } from "../api/customer-api.ts";
import { useI18n } from "../i18n/i18n.tsx";
import { enumLabel } from "../i18n/enum-labels.ts";
import {
  ErrorBanner,
  LoadingSkeleton,
  PageHeader,
  StatusChip,
  useToast,
} from "./CommercialUI.tsx";

/**
 * One contact's file.
 *
 * This screen used to say "Contact-only projection" above a list that read
 * `WHATSAPP: +20…` — a field name and a value, with no way to act on either.
 * The point of a contact is that you can reach the person, so the channels are
 * now links you can press, and the two endpoints that maintain them — which
 * the screen's own registry entry has always declared and never called — are
 * wired up.
 *
 * The narrow-visibility notice stays, because it is true and it matters: this
 * projection is what a colleague sees when a contact has been shared with them
 * without the customer behind it. It is phrased as what you can and cannot do
 * rather than as a warning about the data model.
 */

export function ContactPage({ client, me }: { client: ApiClient; me: Me }) {
  const { contactId } = useParams();
  const { locale } = useI18n();
  const txt = (en: string, ar: string) => (locale === "ar" ? ar : en);
  const queryClient = useQueryClient();
  const toast = useToast();
  const granted = new Set(me.access.permissions);
  const canEdit = granted.has(permissions.contactsEdit);

  const detail = useQuery({
    queryKey: ["contact", contactId],
    queryFn: () => {
      if (contactId === undefined)
        return Promise.reject(new Error("CONTACT_ID_REQUIRED"));
      return getContact(client, contactId);
    },
    enabled: contactId !== undefined,
  });

  const [displayName, setDisplayName] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [channelValue, setChannelValue] = useState("");

  useEffect(() => {
    if (!detail.data) return;
    setDisplayName(detail.data.data.displayName);
    setJobTitle(detail.data.data.jobTitle ?? "");
  }, [detail.data]);

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["contact", contactId] });

  const update = useMutation({
    mutationFn: () => {
      if (!detail.data) throw new Error("CONTACT_REQUIRED");
      return updateContact(
        client,
        detail.data.data.contactId,
        detail.data.data.rowVersion,
        { displayName, jobTitle: jobTitle || null },
      );
    },
    onSuccess: async () => {
      await refresh();
      toast.success(txt("Contact saved", "تم حفظ جهة الاتصال"));
    },
  });

  const addChannel = useMutation({
    mutationFn: () => {
      if (!detail.data) throw new Error("CONTACT_REQUIRED");
      return addContactChannel(client, detail.data.data.contactId, {
        channelTypeCode: "EMAIL",
        value: channelValue.trim(),
        // The first email is the one documents go to.
        isPrimary: !detail.data.data.channels.some(
          (channel) => channel.channelTypeCode === "EMAIL",
        ),
      });
    },
    onSuccess: async () => {
      setChannelValue("");
      await refresh();
      toast.success(txt("Channel added", "تم إضافة وسيلة تواصل"));
    },
  });

  const dropChannel = useMutation({
    mutationFn: (input: { channelId: string }) => {
      if (!detail.data) throw new Error("CONTACT_REQUIRED");
      return removeContactChannel(
        client,
        input.channelId,
        detail.data.data.rowVersion,
      );
    },
    onSuccess: async () => {
      await refresh();
    },
  });

  if (detail.isLoading) return <LoadingSkeleton rows={3} variant="cards" />;
  if (detail.error !== null || !detail.data) {
    return (
      <section className="workspace-page">
        <ErrorBanner
          error={detail.error ?? new Error("FORBIDDEN")}
          retry={() => void detail.refetch()}
        />
      </section>
    );
  }

  const contact = detail.data.data;
  const dirty =
    displayName !== contact.displayName ||
    jobTitle !== (contact.jobTitle ?? "");

  return (
    <section className="workspace-page contact-only-page">
      <PageHeader
        kicker={txt("Contacts", "جهات الاتصال")}
        title={contact.displayName}
        {...(contact.jobTitle !== null && contact.jobTitle !== undefined
          ? { sub: contact.jobTitle }
          : {})}
        actions={<StatusChip code={contact.statusCode} />}
      />

      <p className="settings-hint">
        <Link to={`/customers/${contact.account.accountId}`}>
          {contact.account.canonicalName}
        </Link>{" "}
        · <span data-abp-num>{contact.account.accountRef}</span>
      </p>

      {/* True and worth saying: a shared contact does not carry the customer
          with it. Phrased as what this screen can do, not as a caveat about
          projections. */}
      <p className="settings-hint">
        {txt(
          "This is the contact only. Opening the customer above needs access to that account in its own right.",
          "دي جهة الاتصال بس. فتح العميل اللي فوق محتاج صلاحية على الحساب ده بنفسه.",
        )}
      </p>

      <ErrorBanner
        error={update.error ?? addChannel.error ?? dropChannel.error}
        retry={() => {
          update.reset();
          addChannel.reset();
          dropChannel.reset();
        }}
      />

      <h2 className="settings-section-title">{txt("Email", "الإيميل")}</h2>
      {contact.channels.length === 0 ? (
        <p className="today-empty">
          {txt(
            "No email on file. Quotations can still be emailed by typing the address when sending.",
            "مفيش إيميل مسجّل. تقدر تكتب الإيميل وقت إرسال عرض السعر.",
          )}
        </p>
      ) : (
        <ul className="channel-list">
          {contact.channels.map((channel) => {
            const href = `mailto:${channel.value.trim()}`;
            return (
              <li key={channel.contactChannelId}>
                <span className="channel-kind">
                  {enumLabel(channel.channelTypeCode, locale)}
                </span>
                <a href={href} data-abp-num>
                  {channel.value}
                </a>
                {channel.isPrimary && (
                  <span className="channel-primary">
                    {txt("Primary", "الأساسي")}
                  </span>
                )}
                {canEdit && (
                  <button
                    type="button"
                    className="ghost-button"
                    disabled={dropChannel.isPending}
                    onClick={() => {
                      dropChannel.mutate({
                        channelId: channel.contactChannelId,
                      });
                    }}
                  >
                    {txt("Remove", "حذف")}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {canEdit && (
        <>
          <form
            className="channel-add"
            onSubmit={(event) => {
              event.preventDefault();
              if (!addChannel.isPending && channelValue.trim() !== "")
                addChannel.mutate();
            }}
          >
            <label className="settings-field">
              {txt("Email address", "عنوان الإيميل")}
              <input
                type="email"
                value={channelValue}
                onChange={(event) => {
                  setChannelValue(event.target.value);
                }}
              />
            </label>
            <button
              type="submit"
              className="secondary"
              disabled={addChannel.isPending || channelValue.trim() === ""}
            >
              {txt("Add email", "ضيف الإيميل")}
            </button>
          </form>

          <h2 className="settings-section-title">
            {txt("Details", "البيانات")}
          </h2>
          <form
            className="contact-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (!update.isPending) update.mutate();
            }}
          >
            <label className="settings-field">
              {txt("Contact name", "اسم جهة الاتصال")}
              <input
                value={displayName}
                onChange={(event) => {
                  setDisplayName(event.target.value);
                }}
              />
            </label>
            <label className="settings-field">
              {txt("Job title", "المسمى الوظيفي")}
              <input
                value={jobTitle}
                onChange={(event) => {
                  setJobTitle(event.target.value);
                }}
              />
            </label>
            <button
              type="submit"
              className="primary"
              disabled={update.isPending || !dirty}
            >
              {update.isPending
                ? txt("Saving…", "جارٍ الحفظ…")
                : txt("Save contact", "حفظ")}
            </button>
          </form>
        </>
      )}
    </section>
  );
}

/**
 * 412 means somebody else saved this contact while it was open. Reloading is
 * the fix, so the message says that rather than reporting the status code.
 */
export function contactError(error: unknown, locale: "en" | "ar"): string {
  if (error instanceof CustomerApiError && error.status === 412) {
    return locale === "ar"
      ? "جهة الاتصال دي اتغيّرت من مكان تاني. حدّث الصفحة قبل ما تحفظ تاني."
      : "This contact changed elsewhere. Reload before saving again.";
  }
  return locale === "ar" ? "الطلب فشل. جرّب تاني." : "Contact request failed.";
}
