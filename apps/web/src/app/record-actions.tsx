import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { ApiClient } from "@abp/api-client";
import type { Me } from "../api/customer-api.ts";
import { useI18n } from "../i18n/i18n.tsx";
import { enumLabel } from "../i18n/enum-labels.ts";
import { commercialRequest, str } from "./commercial-api.ts";
import { ErrorBanner, useToast } from "./CommercialUI.tsx";

/**
 * What you can *do* to a record, on the screens that are generic lists.
 *
 * `RecordScreen` could show any record and change none of them. That was fine
 * while those tables were empty; now that they have rows it is the obvious
 * gap — a cheque register you can read but not mark as cleared is a report,
 * not a screen.
 *
 * Rather than promote each of those screens to a bespoke component, the
 * generic one looks up an action panel by screen id. The id comes from the
 * route's own context, so nothing has to be threaded through.
 */
export interface RecordActionProps {
  client: ApiClient;
  me: Me;
  row: Record<string, unknown>;
  onDone: () => Promise<void>;
}

/**
 * A cheque's life, as the server actually models it.
 *
 * The transitions are the server's own table, not a guess: RECEIVED can be
 * deposited or cancelled, a DEPOSITED cheque clears or bounces, a BOUNCED one
 * can be re-deposited, and CLEARED and CANCELLED are final. Offering a button
 * the server will refuse teaches people to distrust the screen, so a terminal
 * cheque offers nothing and says why.
 */
const CHEQUE_TRANSITIONS: Readonly<Record<string, readonly string[]>> = {
  RECEIVED: ["DEPOSITED", "CANCELLED"],
  DEPOSITED: ["CLEARED", "BOUNCED", "CANCELLED"],
  BOUNCED: ["DEPOSITED", "CANCELLED"],
  CLEARED: [],
  CANCELLED: [],
};

function ChequeActions({ client, me, row, onDone }: RecordActionProps) {
  const { locale } = useI18n();
  const txt = (en: string, ar: string) => (locale === "ar" ? ar : en);
  const toast = useToast();
  const [reason, setReason] = useState("");
  const [target, setTarget] = useState<string | null>(null);

  const status = str(row.statusCode);
  const allowed = CHEQUE_TRANSITIONS[status] ?? [];
  const canManage = me.access.permissions.includes("cheques.manage");

  const move = useMutation({
    mutationFn: (targetStatusCode: string) =>
      commercialRequest(
        client,
        "POST",
        "/finance/cheques/{chequeId}/status-transitions",
        {
          path: { chequeId: str(row.chequeId) },
          body: {
            targetStatusCode,
            expectedRowVersion: str(row.rowVersion),
            reason: reason.trim(),
          },
          idempotencyKey: crypto.randomUUID(),
        },
      ),
    onSuccess: async () => {
      setTarget(null);
      setReason("");
      await onDone();
      toast.success(txt("Cheque updated", "تم تحديث الشيك"));
    },
  });

  if (!canManage) return null;

  if (allowed.length === 0) {
    return (
      <p className="settings-hint">
        {txt(
          `A ${enumLabel(status, "en").toLowerCase()} cheque is final — there is nothing further to record.`,
          `الشيك ${enumLabel(status, "ar")} نهائي — مفيش حاجة تانية تتسجّل.`,
        )}
      </p>
    );
  }

  return (
    <div className="record-actions">
      <h3>{txt("Record what happened", "سجّل اللي حصل")}</h3>
      <ErrorBanner
        error={move.error}
        retry={() => {
          move.reset();
        }}
      />
      {/* The server requires a reason on every transition, and it is right to:
          a bounced cheque with no note is a phone call to the customer that
          nobody can prepare for. */}
      <label className="settings-field">
        {txt("Reason", "السبب")}
        <input
          value={reason}
          onChange={(event) => {
            setReason(event.target.value);
          }}
        />
      </label>
      <div className="approval-actions">
        {allowed.map((option) =>
          target === option ? (
            <button
              key={option}
              type="button"
              className={
                option === "BOUNCED" || option === "CANCELLED"
                  ? "danger"
                  : "primary"
              }
              disabled={move.isPending || reason.trim() === ""}
              onClick={() => {
                move.mutate(option);
              }}
            >
              {txt("Confirm", "تأكيد")} · {enumLabel(option, locale)}
            </button>
          ) : (
            <button
              key={option}
              type="button"
              className="secondary"
              disabled={reason.trim() === ""}
              onClick={() => {
                setTarget(option);
              }}
            >
              {enumLabel(option, locale)}
            </button>
          ),
        )}
      </div>
      {reason.trim() === "" && (
        <p className="settings-hint">
          {txt(
            "Give a reason first — the server requires one on every change.",
            "اكتب السبب الأول — السيرفر بيطلبه مع كل تغيير.",
          )}
        </p>
      )}
    </div>
  );
}

/**
 * Correcting a shipment that was recorded wrongly.
 *
 * Recording without correcting means the first typo is permanent. That matters
 * more here than it looks: transit times are measured from these dates, and
 * those averages are what the next quotation's delivery promise is built on.
 * A wrong date does not stay wrong in one place — it travels to another
 * customer.
 *
 * The event log models this properly (`event_type_code` is MILESTONE or
 * CORRECTION), so a correction is recorded as a correction rather than
 * overwriting history.
 */
export function ShipmentCorrection({
  client,
  me,
  row,
  onDone,
}: RecordActionProps) {
  const { locale } = useI18n();
  const txt = (en: string, ar: string) => (locale === "ar" ? ar : en);
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [occurredOn, setOccurredOn] = useState("");
  const [blDate, setBlDate] = useState(str(row.blDate).slice(0, 10));
  const [port, setPort] = useState(
    typeof row.portOfDischarge === "string" ? row.portOfDischarge : "",
  );

  const correct = useMutation({
    mutationFn: () =>
      commercialRequest(client, "POST", "/shipments/{shipmentId}/corrections", {
        path: { shipmentId: str(row.shipmentId) },
        body: {
          reason: reason.trim(),
          businessOccurredAt: `${occurredOn}T12:00:00.000Z`,
          expectedRowVersion: str(row.rowVersion),
          ...(blDate === "" ? {} : { blDate }),
          ...(port.trim() === "" ? {} : { portOfDischarge: port.trim() }),
        },
        idempotencyKey: crypto.randomUUID(),
      }),
    onSuccess: async () => {
      setOpen(false);
      setReason("");
      await onDone();
      toast.success(txt("Correction recorded", "تم تسجيل التصحيح"));
    },
  });

  if (!me.access.permissions.includes("shipments.edit")) return null;

  if (!open) {
    return (
      <button
        type="button"
        className="ghost-button"
        onClick={() => {
          setOpen(true);
        }}
      >
        {txt("Something here is wrong", "فيه حاجة هنا غلط")}
      </button>
    );
  }

  return (
    <div className="record-actions">
      <h3>{txt("Correct this shipment", "صحّح الشحنة دي")}</h3>
      <p className="settings-hint">
        {txt(
          "Recorded as a correction, not an overwrite — the original entry stays in the history.",
          "بيتسجّل كتصحيح مش كاستبدال — الإدخال الأصلي بيفضل في السجل.",
        )}
      </p>
      <ErrorBanner
        error={correct.error}
        retry={() => {
          correct.reset();
        }}
      />
      <label className="settings-field">
        {txt("What was wrong", "إيه اللي كان غلط")}
        <input
          value={reason}
          onChange={(event) => {
            setReason(event.target.value);
          }}
        />
      </label>
      <label className="settings-field">
        {txt("Correct date of the event", "التاريخ الصح للحدث")}
        <input
          type="date"
          value={occurredOn}
          onChange={(event) => {
            setOccurredOn(event.target.value);
          }}
        />
      </label>
      <label className="settings-field">
        {txt("B/L date", "تاريخ البوليصة")}
        <input
          type="date"
          value={blDate}
          onChange={(event) => {
            setBlDate(event.target.value);
          }}
        />
      </label>
      <label className="settings-field">
        {txt("Port of discharge", "ميناء التفريغ")}
        <input
          value={port}
          onChange={(event) => {
            setPort(event.target.value);
          }}
        />
      </label>
      <div className="approval-actions">
        <button
          type="button"
          className="primary"
          disabled={
            correct.isPending || reason.trim() === "" || occurredOn === ""
          }
          onClick={() => {
            correct.mutate();
          }}
        >
          {correct.isPending
            ? txt("Recording…", "بيتسجّل…")
            : txt("Record the correction", "سجّل التصحيح")}
        </button>
        <button
          type="button"
          className="ghost-button"
          onClick={() => {
            setOpen(false);
          }}
        >
          {txt("Cancel", "إلغاء")}
        </button>
      </div>
    </div>
  );
}

/** Screen id → what you can do to one of its records. */
export const recordActions: Readonly<
  Record<string, (props: RecordActionProps) => React.ReactNode>
> = {
  FINANCE_CHEQUES: ChequeActions,
};
