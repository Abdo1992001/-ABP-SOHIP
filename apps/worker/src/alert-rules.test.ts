import { describe, expect, it } from "vitest";
import {
  askForFeedback,
  backupProblem,
  lateComplaintStage,
  overduePayment,
  overduePaymentForManager,
  productionRisk,
  quotationExpired,
  quotationExpiring,
  wants,
} from "./alert-rules.js";

const today = new Date("2026-10-03T08:00:00Z");

describe("alert rules", () => {
  it("announces an overdue payment once per due date, to the order owner", () => {
    const alert = overduePayment({
      id: "i1",
      label: "Cheque 1",
      dueDate: new Date("2026-10-01"),
      outstanding: 2478738.74,
      currencyCode: "EGP",
      orderId: "o1",
      orderRef: "SO-000007",
      orderOwnerUserId: "u1",
      accountName: "Hassan Allam",
    });
    expect(alert?.key).toBe("PAYMENT_OVERDUE:i1:2026-10-01");
    expect(alert?.recipients).toEqual(["u1"]);
    expect(alert?.body).toContain("2,478,738.74 EGP");
    expect(
      overduePayment({
        id: "i1",
        label: "x",
        dueDate: today,
        outstanding: 0,
        currencyCode: "EGP",
        orderId: "o1",
        orderRef: "SO",
        orderOwnerUserId: "u1",
        accountName: "A",
      }),
    ).toBeNull();
  });

  it("sends a late complaint stage to whoever holds it", () => {
    const alert = lateComplaintStage({
      id: "c1",
      complaintRef: "CMP-1",
      statusCode: "QUALITY_REVIEW",
      stageEnteredAt: new Date("2026-09-25T10:00:00Z"),
      stageDueAt: new Date("2026-09-30T10:00:00Z"),
      assigneeUserId: null,
      ownerUserId: "owner",
    });
    expect(alert.recipients).toEqual(["owner"]);
    expect(alert.key).toBe("COMPLAINT_LATE:c1:2026-09-25T10:00:00.000Z");
  });

  it("flags production behind plan or too close to the customer's date", () => {
    const base = {
      id: "w1",
      workOrderRef: "WO-1",
      statusCode: "IN_PROGRESS",
      orderRef: "SO-1",
      orderOwnerUserId: "sales",
      createdByUserId: "ops",
      today,
    };
    expect(
      productionRisk({
        ...base,
        plannedEndDate: new Date("2026-10-01"),
        requestedDeliveryDate: null,
      })?.body,
    ).toContain("was planned to finish");
    expect(
      productionRisk({
        ...base,
        plannedEndDate: new Date("2026-10-09"),
        requestedDeliveryDate: new Date("2026-10-10"),
      })?.recipients,
    ).toEqual(["sales", "ops"]);
    expect(
      productionRisk({
        ...base,
        plannedEndDate: new Date("2026-10-05"),
        requestedDeliveryDate: new Date("2026-10-15"),
      }),
    ).toBeNull();
    expect(
      productionRisk({
        ...base,
        statusCode: "COMPLETED",
        plannedEndDate: new Date("2026-09-01"),
        requestedDeliveryDate: null,
      }),
    ).toBeNull();
  });

  it("asks for feedback once per order", () => {
    expect(
      askForFeedback({
        orderId: "o9",
        orderRef: "SO-9",
        orderOwnerUserId: "u",
        accountName: "A",
      }).key,
    ).toBe("FEEDBACK_REQUEST:o9");
  });

  it("honours muted categories", () => {
    expect(
      wants({ mutedNotifications: ["DELIVERY_LATE"] }, "DELIVERY_LATE"),
    ).toBe(false);
    expect(wants(null, "DELIVERY_LATE")).toBe(true);
  });

  it("warns the owner three days before an offer lapses, not earlier", () => {
    const offer = {
      id: "q1",
      quotationRef: "QT-2026-0020",
      ownerUserId: "rep",
      accountName: "Arab Contractors",
      today: new Date("2026-10-03T00:00:00Z"),
    };
    expect(
      quotationExpiring({ ...offer, expiresOn: new Date("2026-10-07") }),
    ).toBeNull();
    const soon = quotationExpiring({
      ...offer,
      expiresOn: new Date("2026-10-04"),
    });
    expect(soon?.title).toBe(
      "QT-2026-0020 for Arab Contractors expires tomorrow",
    );
    expect(soon?.recipients).toEqual(["rep"]);
    expect(soon?.key).toBe("QUOTATION_EXPIRING:q1:2026-10-04");
    expect(
      quotationExpiring({ ...offer, expiresOn: new Date("2026-10-02") }),
    ).toBeNull();
  });

  it("tells the owner an offer lapsed and how to re-quote", () => {
    const alert = quotationExpired({
      id: "q1",
      quotationRef: "QT-2026-0020",
      expiresOn: new Date("2026-10-01"),
      ownerUserId: "rep",
      accountName: "Arab Contractors",
    });
    expect(alert.key).toBe("QUOTATION_EXPIRED:q1");
    expect(alert.typeCode).toBe("QUOTATION_EXPIRING");
    expect(alert.body).toContain("Copy it");
  });

  it("tells administrators when a backup failed or is missing", () => {
    const now = new Date("2026-10-05T08:00:00Z");
    const administrators = ["admin"];
    expect(
      backupProblem({
        status: {
          name: "20261005-020000",
          ok: true,
          finishedAt: "2026-10-05T02:00:20+0300",
        },
        now,
        administrators,
      }),
    ).toBeNull();
    const failed = backupProblem({
      status: {
        name: "20261005-020000",
        ok: false,
        finishedAt: "2026-10-05T02:00:20+0300",
        error: "Database dump failed",
      },
      now,
      administrators,
    });
    expect(failed?.key).toBe("BACKUP_FAILED:20261005-020000");
    expect(failed?.body).toContain("Database dump failed");
    const old = backupProblem({
      status: {
        name: "20261002-020000",
        ok: true,
        finishedAt: "2026-10-02T02:00:20+0300",
      },
      now,
      administrators,
    });
    expect(old?.key).toBe("BACKUP_MISSING:2026-10-05");
    expect(backupProblem({ status: null, now, administrators })?.title).toBe(
      "No backup in the last 36 hours",
    );
  });

  it("tells the manager about a late payment of even one pound", () => {
    const base = {
      id: "i1",
      label: "Final payment",
      dueDate: new Date("2026-10-01"),
      currencyCode: "EGP",
      orderId: "o1",
      orderRef: "SO-000001",
      ownerName: "Sara Ibrahim",
      accountName: "Arab Contractors",
    };
    const alert = overduePaymentForManager({
      ...base,
      outstanding: 1,
      managerUserIds: ["manager"],
    });
    expect(alert?.recipients).toEqual(["manager"]);
    expect(alert?.title).toBe(
      "Sara Ibrahim's customer is late — Arab Contractors",
    );
    expect(alert?.key).toBe("PAYMENT_OVERDUE_MANAGER:i1:2026-10-01");
    expect(
      overduePaymentForManager({
        ...base,
        outstanding: 0,
        managerUserIds: ["manager"],
      }),
    ).toBeNull();
    expect(
      overduePaymentForManager({ ...base, outstanding: 5, managerUserIds: [] }),
    ).toBeNull();
  });
});
