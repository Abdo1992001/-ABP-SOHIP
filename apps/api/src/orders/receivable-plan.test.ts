import { describe, expect, it } from "vitest";
import {
  addDays,
  agingBucket,
  outstanding,
  planInstallments,
  settleStatus,
  splitByWeights,
} from "./receivable-plan.js";

const schedule = {
  referenceDate: null,
  rows: [
    {
      label: "Advance Payment",
      stage: "ADVANCE",
      amount: "3186949.81",
      method: "CHEQUE",
      dueDate: null,
      daysAfter: null,
      dueTiming: "BEFORE_DELIVERY",
    },
    {
      label: "Cheque 1",
      stage: "INSTALLMENT",
      amount: "2478738.74",
      method: "CHEQUE",
      dueDate: null,
      daysAfter: 30,
      dueTiming: "DAYS_AFTER_REFERENCE",
    },
    {
      label: "Cheque 2",
      stage: "INSTALLMENT",
      amount: "2478738.74",
      method: "CHEQUE",
      dueDate: null,
      daysAfter: 60,
      dueTiming: "DAYS_AFTER_REFERENCE",
    },
    {
      label: "Cheque 3",
      stage: "INSTALLMENT",
      amount: "2478738.75",
      method: "CHEQUE",
      dueDate: null,
      daysAfter: 90,
      dueTiming: "DAYS_AFTER_REFERENCE",
    },
  ],
};

describe("planInstallments", () => {
  it("owes one full payment, due on confirmation, when there is no schedule", () => {
    expect(
      planInstallments({
        schedule: null,
        total: "1560000",
        confirmedOn: "2026-10-02",
      }),
    ).toEqual([
      {
        installmentNo: 1,
        label: "Full payment",
        stageCode: "FULL",
        dueBasisCode: "BEFORE_DELIVERY",
        daysAfter: null,
        dueDate: "2026-10-02",
        amount: "1560000.00",
        methodCode: null,
      },
    ]);
  });

  it("dates the advance on confirmation and leaves after-delivery cheques undated", () => {
    const plan = planInstallments({
      schedule,
      total: "10623166.04",
      confirmedOn: "2026-10-02",
    });
    expect(
      plan.map((row) => [row.label, row.dueBasisCode, row.dueDate, row.amount]),
    ).toEqual([
      ["Advance Payment", "BEFORE_DELIVERY", "2026-10-02", "3186949.81"],
      ["Cheque 1", "AFTER_HANDOVER", null, "2478738.74"],
      ["Cheque 2", "AFTER_HANDOVER", null, "2478738.74"],
      ["Cheque 3", "AFTER_HANDOVER", null, "2478738.75"],
    ]);
  });

  it("dates the cheques from the hand-over", () => {
    const plan = planInstallments({
      schedule,
      total: "10623166.04",
      confirmedOn: "2026-10-02",
      handedOverOn: "2026-11-15",
    });
    expect(plan.map((row) => row.dueDate)).toEqual([
      "2026-10-02",
      "2026-12-15",
      "2027-01-14",
      "2027-02-13",
    ]);
  });

  it("splits an amended total across the schedule and still adds up", () => {
    const plan = planInstallments({
      schedule,
      total: "1000000",
      confirmedOn: "2026-10-02",
    });
    const sum = plan.reduce(
      (acc, row) => acc + Math.round(Number(row.amount) * 100),
      0,
    );
    expect(sum).toBe(100_000_000);
    expect(plan[0]?.amount).toBe("300000.00");
  });

  it("uses a fixed reference date when the schedule has one", () => {
    const plan = planInstallments({
      schedule: { ...schedule, referenceDate: "2026-12-01" },
      total: "10623166.04",
      confirmedOn: "2026-10-02",
    });
    expect(plan[1]).toMatchObject({
      dueBasisCode: "FIXED_DATE",
      dueDate: "2026-12-31",
    });
  });
});

describe("splitByWeights", () => {
  it("leaves the rounding on the last part", () => {
    expect(splitByWeights("100", [1, 1, 1])).toEqual([
      "33.33",
      "33.33",
      "33.34",
    ]);
  });
});

describe("settleStatus and outstanding", () => {
  it("moves from open to partial to paid", () => {
    expect(settleStatus("100", "0", "0")).toBe("OPEN");
    expect(settleStatus("100", "40", "0")).toBe("PARTIAL");
    expect(settleStatus("100", "100", "0")).toBe("PAID");
    expect(settleStatus("100", "40", "60")).toBe("WRITTEN_OFF");
    expect(outstanding("100", "40", "10")).toBe("50.00");
  });
});

describe("agingBucket", () => {
  it("does not age what is paid or not yet dated", () => {
    expect(
      agingBucket({
        dueDate: "2026-01-01",
        outstanding: "0",
        today: "2026-10-02",
      }),
    ).toBe("SETTLED");
    expect(
      agingBucket({ dueDate: null, outstanding: "5", today: "2026-10-02" }),
    ).toBe("NOT_SCHEDULED");
  });
  it("buckets by days past due", () => {
    const at = (due: string) =>
      agingBucket({ dueDate: due, outstanding: "5", today: "2026-10-02" });
    expect(at("2026-10-02")).toBe("NOT_DUE");
    expect(at(addDays("2026-10-02", -1))).toBe("OVERDUE_1_30");
    expect(at(addDays("2026-10-02", -45))).toBe("OVERDUE_31_60");
    expect(at(addDays("2026-10-02", -61))).toBe("OVERDUE_61_90");
    expect(at(addDays("2026-10-02", -120))).toBe("OVERDUE_90_PLUS");
  });
});
