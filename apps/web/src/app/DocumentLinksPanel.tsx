import { useState } from "react";
import { Link } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ApiClient } from "@abp/api-client";
import type { Me } from "../api/customer-api.ts";
import { useI18n } from "../i18n/i18n.tsx";
import { enumLabel } from "../i18n/enum-labels.ts";
import { commercialRequest, isObject, str } from "./commercial-api.ts";
import { ErrorBanner, SlideOver, useToast } from "./CommercialUI.tsx";

/**
 * Where else a document is filed.
 *
 * A document is filed against one record, and `POST /documents/{id}/links`
 * adds the others — a delivery note that belongs to a shipment *and* the
 * quotation it came from. That endpoint has always worked, and
 * `DELETE /document-links/{id}` has always undone it, but **no read returned
 * the links**: a link once made could be neither seen nor removed. The
 * document detail now carries them, which is what makes this screen possible.
 */

interface DocumentLink {
  linkId: string;
  resourceTypeCode: string;
  resourceId: string;
  relationshipTypeCode: string;
  createdAt: string;
}

function toLink(row: Record<string, unknown>): DocumentLink {
  return {
    linkId: str(row.linkId),
    resourceTypeCode: str(row.resourceTypeCode),
    resourceId: str(row.resourceId),
    relationshipTypeCode: str(row.relationshipTypeCode),
    createdAt: str(row.createdAt),
  };
}

/** Where a linked record actually lives, so the link is worth following. */
const ROUTE_FOR: Readonly<Record<string, string>> = {
  ACCOUNT: "/customers",
  PROJECT: "/projects",
  OPPORTUNITY: "/opportunities",
  QUOTATION: "/quotations",
  SHIPMENT: "/shipments",
  COMPLAINT: "/complaints",
};

export function DocumentLinksPanel({
  client,
  me,
  documentId,
  documentName,
  onClose,
}: {
  client: ApiClient;
  me: Me;
  documentId: string;
  documentName: string;
  onClose: () => void;
}) {
  const { locale } = useI18n();
  const txt = (en: string, ar: string) => (locale === "ar" ? ar : en);
  const toast = useToast();
  const cache = useQueryClient();
  const canLink = me.access.permissions.includes("documents.link");

  const [removing, setRemoving] = useState<string | null>(null);

  const detail = useQuery({
    queryKey: ["document", documentId],
    queryFn: () =>
      commercialRequest(client, "GET", "/documents/{documentId}", {
        path: { documentId },
      }),
  });

  const payload =
    isObject(detail.data?.data) && isObject(detail.data.data.data)
      ? detail.data.data.data
      : {};
  const links = Array.isArray(payload.links)
    ? payload.links.filter(isObject).map(toLink)
    : [];

  const unlink = useMutation({
    mutationFn: (link: DocumentLink) =>
      commercialRequest(client, "DELETE", "/document-links/{linkId}", {
        path: { linkId: link.linkId },
        // The endpoint validates the precondition's shape rather than a
        // per-link counter — links carry no row version of their own.
        ifMatch:
          str(payload.rowVersion) === "—" ? '"rv-1"' : str(payload.rowVersion),
        idempotencyKey: crypto.randomUUID(),
      }),
    onSuccess: async () => {
      setRemoving(null);
      await cache.invalidateQueries({ queryKey: ["document", documentId] });
      toast.success(txt("Link removed", "تم حذف الربط"));
    },
  });

  const when = (iso: string) => {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "—";
    return new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", {
      dateStyle: "medium",
    }).format(date);
  };

  return (
    <SlideOver
      title={txt("Where this is filed", "الملف ده مربوط بإيه")}
      onClose={onClose}
    >
      <p className="settings-hint">
        <strong>{documentName}</strong>
      </p>
      <p className="settings-hint">
        {txt(
          "A document is filed against one record and can be linked to others — a delivery note belongs to its shipment and to the quotation it came from.",
          "المستند بيتحفظ على سجل واحد وممكن يتربط بغيره — إذن التسليم بتاع الشحنة وكمان بتاع العرض اللي جه منه.",
        )}
      </p>

      <ErrorBanner
        error={detail.error ?? unlink.error}
        retry={() => {
          unlink.reset();
          void detail.refetch();
        }}
      />

      {links.length === 0 ? (
        <p className="today-empty">
          {txt(
            "This document is not linked to anything beyond the record it was filed against.",
            "المستند ده مش مربوط بحاجة غير السجل اللي اتحفظ عليه.",
          )}
        </p>
      ) : (
        <ul className="document-links">
          {links.map((link) => {
            const base = ROUTE_FOR[link.resourceTypeCode];
            return (
              <li key={link.linkId}>
                <div className="document-link-identity">
                  {base === undefined ? (
                    <span>{enumLabel(link.resourceTypeCode, locale)}</span>
                  ) : (
                    <Link to={`${base}/${link.resourceId}`}>
                      {enumLabel(link.resourceTypeCode, locale)}
                    </Link>
                  )}
                  <small>{enumLabel(link.relationshipTypeCode, locale)}</small>
                </div>
                <span className="document-link-when">
                  {when(link.createdAt)}
                </span>
                {canLink &&
                  (removing === link.linkId ? (
                    <>
                      <button
                        type="button"
                        className="danger"
                        disabled={unlink.isPending}
                        onClick={() => {
                          unlink.mutate(link);
                        }}
                      >
                        {txt("Yes, remove", "أيوه، شيله")}
                      </button>
                      <button
                        type="button"
                        className="ghost-button"
                        onClick={() => {
                          setRemoving(null);
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
                        setRemoving(link.linkId);
                      }}
                    >
                      {txt("Remove", "حذف")}
                    </button>
                  ))}
              </li>
            );
          })}
        </ul>
      )}

      {/* Removing a link does not remove the document — worth saying, because
          "Remove" next to a file reads as deletion. */}
      {links.length > 0 && (
        <p className="settings-hint">
          {txt(
            "Removing a link only unfiles it from that record. The document itself is untouched.",
            "حذف الربط بيشيله من السجل ده بس. المستند نفسه مبيتأثرش.",
          )}
        </p>
      )}
    </SlideOver>
  );
}
