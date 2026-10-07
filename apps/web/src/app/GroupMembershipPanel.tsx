import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ApiClient } from "@abp/api-client";
import { permissions } from "@abp/contracts";
import type { Me } from "../api/customer-api.ts";
import { useI18n } from "../i18n/i18n.tsx";
import { enumLabel } from "../i18n/enum-labels.ts";
import { commercialRequest, isObject, str } from "./commercial-api.ts";
import { ErrorBanner, SlideOver, useToast } from "./CommercialUI.tsx";

/**
 * Which group of companies a customer belongs to.
 *
 * The customer screen has always *shown* effective group membership, and
 * there was no way to change it: `POST /group-networks/{groupId}/memberships`
 * and `DELETE /group-memberships/{membershipId}` both worked and nothing
 * called either. The delete could not have been called even deliberately —
 * it checks an `If-Match` derived from the membership's creation instant, and
 * no read published that value, so the precondition was unknowable. The
 * customer detail now carries it, which is what makes ending one possible.
 *
 * This matters commercially rather than cosmetically: group membership is
 * what lets a buying company's subsidiaries be seen as one account when a
 * price or a credit decision is being made.
 */

/** Exactly the shape the customer detail carries, nulls included. */
interface Membership {
  readonly membershipId: string;
  readonly groupNetworkId: string;
  readonly groupCode: string;
  readonly groupName: string;
  readonly groupTypeCode: string | null;
  readonly effectiveFrom: string | null;
  readonly effectiveTo: string | null;
  readonly rowVersion: string;
}

interface GroupOption {
  groupNetworkId: string;
  groupCode: string;
  name: string;
}

function toGroup(row: Record<string, unknown>): GroupOption {
  return {
    groupNetworkId: str(row.groupNetworkId),
    groupCode: str(row.groupCode),
    name: str(row.name),
  };
}

export function GroupMembershipPanel({
  client,
  me,
  accountId,
  accountName,
  memberships,
  onChanged,
  onClose,
}: {
  client: ApiClient;
  me: Me;
  accountId: string;
  accountName: string;
  memberships: readonly Membership[];
  onChanged: () => void;
  onClose: () => void;
}) {
  const { locale } = useI18n();
  const txt = (en: string, ar: string) => (locale === "ar" ? ar : en);
  const toast = useToast();
  const cache = useQueryClient();
  const canManage = me.access.permissions.includes(permissions.groupsManage);

  const [groupNetworkId, setGroupNetworkId] = useState("");
  const [validFrom, setValidFrom] = useState("");
  const [ending, setEnding] = useState<string | null>(null);

  const groups = useQuery({
    queryKey: ["group-networks"],
    queryFn: () =>
      commercialRequest(client, "GET", "/group-networks", {
        path: {},
        query: { page: 1, limit: 100 },
      }),
    enabled: canManage,
  });

  const options: GroupOption[] =
    isObject(groups.data?.data) && Array.isArray(groups.data.data.data)
      ? groups.data.data.data.filter(isObject).map(toGroup)
      : [];
  // A group the customer is already in is not a choice.
  const joined = new Set(memberships.map((row) => row.groupNetworkId));
  const available = options.filter(
    (option) => !joined.has(option.groupNetworkId),
  );

  const refresh = async () => {
    await cache.invalidateQueries({ queryKey: ["customer", accountId] });
    await cache.invalidateQueries({ queryKey: ["customers"] });
    onChanged();
  };

  const add = useMutation({
    mutationFn: () =>
      commercialRequest(
        client,
        "POST",
        "/group-networks/{groupId}/memberships",
        {
          path: { groupId: groupNetworkId },
          body: {
            accountId,
            ...(validFrom === "" ? {} : { validFrom }),
          },
          idempotencyKey: crypto.randomUUID(),
        },
      ),
    onSuccess: async () => {
      setGroupNetworkId("");
      setValidFrom("");
      await refresh();
      toast.success(txt("Added to the group.", "اتضاف للمجموعة."));
    },
  });

  const end = useMutation({
    mutationFn: (membership: Membership) =>
      commercialRequest(client, "DELETE", "/group-memberships/{membershipId}", {
        path: { membershipId: membership.membershipId },
        ifMatch: membership.rowVersion,
        idempotencyKey: crypto.randomUUID(),
      }),
    onSuccess: async () => {
      setEnding(null);
      await refresh();
      toast.success(
        txt(
          "Membership ended, and the history is kept.",
          "العضوية اتقفلت، والتاريخ محفوظ.",
        ),
      );
    },
  });

  const when = (value: string | null) => {
    if (value === null || value === "") return txt("open-ended", "مفتوح");
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", {
      dateStyle: "medium",
    }).format(date);
  };

  return (
    <SlideOver
      title={txt("Group membership", "عضوية المجموعة")}
      onClose={onClose}
    >
      <p className="settings-hint">
        <strong>{accountName}</strong>
      </p>
      <p className="settings-hint">
        {txt(
          "Companies that buy together are treated as one group, so their history and their pricing can be judged as a whole rather than one subsidiary at a time.",
          "الشركات اللي بتشتري مع بعض بتتحسب مجموعة واحدة، عشان تاريخها وأسعارها تتقرا كوحدة مش شركة شركة.",
        )}
      </p>

      <ErrorBanner
        error={groups.error ?? add.error ?? end.error}
        retry={() => {
          add.reset();
          end.reset();
          void groups.refetch();
        }}
      />

      {memberships.length === 0 ? (
        <p className="today-empty">
          {txt(
            "This customer is not in any group.",
            "العميل ده مش في أي مجموعة.",
          )}
        </p>
      ) : (
        <ul className="document-links">
          {memberships.map((membership) => (
            <li key={membership.membershipId}>
              <div className="document-link-identity">
                <span>{membership.groupName}</span>
                <small>
                  {membership.groupCode}
                  {membership.groupTypeCode === null ||
                  membership.groupTypeCode === ""
                    ? ""
                    : ` · ${enumLabel(membership.groupTypeCode, locale)}`}
                </small>
              </div>
              <span className="document-link-when">
                {when(membership.effectiveFrom)} →{" "}
                {when(membership.effectiveTo)}
              </span>
              {canManage &&
                (ending === membership.membershipId ? (
                  <>
                    <button
                      type="button"
                      className="danger"
                      disabled={end.isPending}
                      onClick={() => {
                        end.mutate(membership);
                      }}
                    >
                      {txt("Yes, end it", "أيوه، اقفلها")}
                    </button>
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={() => {
                        setEnding(null);
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
                      setEnding(membership.membershipId);
                    }}
                  >
                    {txt("End", "اقفل")}
                  </button>
                ))}
            </li>
          ))}
        </ul>
      )}

      {canManage && (
        <form
          className="share-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!add.isPending && groupNetworkId !== "") add.mutate();
          }}
        >
          <label className="settings-field">
            {txt("Add to a group", "ضيفه لمجموعة")}
            <select
              value={groupNetworkId}
              onChange={(event) => {
                setGroupNetworkId(event.target.value);
              }}
            >
              <option value="">
                {groups.isLoading
                  ? txt("Loading…", "بيحمّل…")
                  : available.length === 0
                    ? txt("Already in every group", "موجود في كل المجموعات")
                    : txt("Choose a group", "اختار مجموعة")}
              </option>
              {available.map((option) => (
                <option
                  key={option.groupNetworkId}
                  value={option.groupNetworkId}
                >
                  {option.name} · {option.groupCode}
                </option>
              ))}
            </select>
          </label>

          <label className="settings-field">
            {txt("In the group since (optional)", "عضو من تاريخ (اختياري)")}
            <input
              type="date"
              value={validFrom}
              onChange={(event) => {
                setValidFrom(event.target.value);
              }}
            />
          </label>

          <button
            type="submit"
            className="primary"
            disabled={add.isPending || groupNetworkId === ""}
          >
            {add.isPending
              ? txt("Adding…", "بيضيف…")
              : txt("Add to group", "ضيفه للمجموعة")}
          </button>
        </form>
      )}

      {/* Ending is not deleting, and the difference decides whether anyone
          dares press it. */}
      {memberships.length > 0 && canManage && (
        <p className="settings-hint">
          {txt(
            "Ending a membership closes it from today. Past quotations and orders keep the group they were placed under.",
            "قفل العضوية بيقفلها من النهاردة. العروض والأوامر القديمة بتفضل بالمجموعة اللي اتعملت تحتها.",
          )}
        </p>
      )}
    </SlideOver>
  );
}
