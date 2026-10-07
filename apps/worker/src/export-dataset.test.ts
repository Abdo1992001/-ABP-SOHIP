import { describe, expect, it } from "vitest";
import { exportDataset } from "./workflow-handlers.js";

/**
 * The export job used to build the accounts CSV whatever the request asked
 * for, and return it successfully. These pin the two things that made that
 * possible: the dataset is chosen by the request, and an unknown one fails
 * instead of falling back to somebody else's data.
 */
function stubDatabase(captured: { where?: unknown }) {
  const rows = {
    account: [
      {
        id: "a1",
        accountRef: "ACC-00000001",
        canonicalName: "Orascom",
        countryCode: "EG",
        recordStatusCode: "ACTIVE",
        createdAt: new Date("2026-01-02T00:00:00.000Z"),
      },
    ],
    quotation: [
      {
        id: "q1",
        quotationRef: "Q-1",
        statusCode: "SENT",
        countryCode: "EG",
        currencyCode: "EGP",
        subtotalAmount: 100,
        taxAmount: 14,
        totalAmount: 114,
        expiresOn: new Date("2026-03-01T00:00:00.000Z"),
        createdAt: new Date("2026-01-02T00:00:00.000Z"),
        account: { canonicalName: "Orascom" },
      },
    ],
    opportunity: [
      {
        id: "o1",
        opportunityRef: "OPP-1",
        title: "Tower",
        stageCode: "HOT_LEAD",
        countryCode: "EG",
        currencyCode: "USD",
        estimatedValue: 5000,
        expectedCloseDate: new Date("2026-05-01T00:00:00.000Z"),
        createdAt: new Date("2026-01-02T00:00:00.000Z"),
        account: { canonicalName: "Orascom" },
      },
    ],
  };
  const table = (key: keyof typeof rows) => ({
    findMany: (args: { where?: unknown }) => {
      captured.where = args.where;
      return Promise.resolve(rows[key]);
    },
  });
  return {
    account: table("account"),
    quotation: table("quotation"),
    opportunity: table("opportunity"),
  } as never;
}

describe("exportDataset", () => {
  it("exports quotations when quotations were asked for", async () => {
    const captured = {};
    const dataset = await exportDataset(stubDatabase(captured), "QUOTATIONS", [
      "EG",
    ]);
    expect(dataset.code).toBe("QUOTATIONS");
    expect(dataset.headers).toContain("grandTotal");
    expect(dataset.rows[0]).toContain("Orascom");
    expect(dataset.rows[0]).toContain(114);
  });

  it("exports opportunities when opportunities were asked for", async () => {
    const dataset = await exportDataset(stubDatabase({}), "OPPORTUNITIES", [
      "EG",
    ]);
    expect(dataset.code).toBe("OPPORTUNITIES");
    expect(dataset.headers).toContain("estimatedValue");
  });

  it("still exports accounts, and by default", async () => {
    expect(
      (await exportDataset(stubDatabase({}), "ACCOUNTS", ["EG"])).code,
    ).toBe("ACCOUNTS");
    expect((await exportDataset(stubDatabase({}), "", ["EG"])).code).toBe(
      "ACCOUNTS",
    );
  });

  it("is case and whitespace forgiving about the dataset name", async () => {
    expect(
      (await exportDataset(stubDatabase({}), "  quotations  ", ["EG"])).code,
    ).toBe("QUOTATIONS");
  });

  it("refuses a dataset it does not have instead of returning another one", async () => {
    await expect(
      exportDataset(stubDatabase({}), "PAYROLL", ["EG"]),
    ).rejects.toThrow();
  });

  it("filters every dataset to the country scope it was given", async () => {
    const captured: { where?: unknown } = {};
    await exportDataset(stubDatabase(captured), "QUOTATIONS", ["EG", "SA"]);
    expect(captured.where).toMatchObject({ countryCode: { in: ["EG", "SA"] } });
  });
});
