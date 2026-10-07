import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import type { ApiClient } from "@abp/api-client";
import type { Me } from "../api/customer-api.ts";
import { useI18n } from "../i18n/i18n.tsx";
import { commercialRequest, isObject, str } from "./commercial-api.ts";
import {
  ErrorBanner,
  LoadingSkeleton,
  PageHeader,
  SlideOver,
} from "./CommercialUI.tsx";
import { UserAvatar } from "./UserAvatar.tsx";
import { UserProfileCard } from "./UserProfileCard.tsx";

/**
 * Who works here.
 *
 * The directory this reads is the same one the Messages screen uses to start
 * a conversation, so there is one list of colleagues rather than two that can
 * disagree. Every row shows only what its owner allows: the server applies
 * the visibility rules, which is why there is no filtering in this file.
 */
export function PeoplePage({ client, me }: { client: ApiClient; me: Me }) {
  const { locale } = useI18n();
  const txt = (en: string, ar: string) => (locale === "ar" ? ar : en);
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [openUserId, setOpenUserId] = useState<string | null>(null);

  const people = useQuery({
    queryKey: ["people-directory", search],
    queryFn: () =>
      commercialRequest(client, "GET", "/messages/directory", {
        path: {},
        // Below two characters the endpoint returns everyone, which is the
        // right default for a directory you are browsing rather than filtering.
        ...(search.trim().length >= 2
          ? { query: { search: search.trim(), limit: 100 } }
          : { query: { limit: 100 } }),
      }),
  });
  const rows =
    isObject(people.data?.data) && Array.isArray(people.data.data.data)
      ? people.data.data.data.filter(isObject)
      : [];

  return (
    <section className="workspace-page people-page">
      <PageHeader
        kicker={txt("People", "الزملاء")}
        title={txt("Team directory", "دليل الفريق")}
        sub={txt(
          "Everyone you can work with, shown as they chose to appear.",
          "كل زمايلك، كل واحد بالشكل اللي اختاره.",
        )}
      />
      <label className="people-search">
        {txt("Find a colleague", "ابحث عن زميل")}
        <input
          value={search}
          placeholder={txt("Name or email", "الاسم أو البريد")}
          onChange={(event) => {
            setSearch(event.target.value);
          }}
        />
      </label>

      <ErrorBanner error={people.error} retry={() => void people.refetch()} />
      {people.isLoading && <LoadingSkeleton rows={4} variant="cards" />}

      {!people.isLoading && rows.length === 0 && (
        <p className="empty-inline">
          {search.trim()
            ? txt("Nobody matches that.", "مفيش حد بالاسم ده.")
            : txt("No colleagues to show.", "لا يوجد زملاء لعرضهم.")}
        </p>
      )}

      <ul className="people-grid">
        {rows.map((person) => {
          const userId = str(person.userId);
          const displayName = str(person.displayName);
          return (
            <li key={userId}>
              <button
                type="button"
                className="people-row"
                onClick={() => {
                  setOpenUserId(userId);
                }}
              >
                <UserAvatar
                  userId={userId}
                  displayName={displayName}
                  photoUpdatedAt={
                    typeof person.photoUpdatedAt === "string"
                      ? person.photoUpdatedAt
                      : null
                  }
                  size="md"
                />
                <span className="people-row-copy">
                  <strong>{displayName}</strong>
                  <small>{str(person.email)}</small>
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {openUserId !== null && (
        <SlideOver
          title={txt("Profile", "الملف الشخصي")}
          onClose={() => {
            setOpenUserId(null);
          }}
        >
          <UserProfileCard
            client={client}
            userId={openUserId}
            onMessage={
              openUserId === me.user.userId
                ? undefined
                : () => {
                    setOpenUserId(null);
                    void navigate("/messages");
                  }
            }
          />
        </SlideOver>
      )}
    </section>
  );
}
