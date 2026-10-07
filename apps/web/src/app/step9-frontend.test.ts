import { describe, expect, it } from "vitest";
import { operationCatalog, operationById } from "../api/operation-runtime.ts";
import { screens } from "./screen-registry.ts";

const criticalJourneys = [
  "customer-contact",
  "pricing-quotation",
  "approval-pdf-send-supersede",
  "erp-import-dq-reconciliation",
  "capacity-estimate",
  "logistics-plan",
  "finance-payment-cheque",
  "returned-scrap-target-documents",
] as const;

describe("Step 9 locked frontend contract", () => {
  it("implements every authoritative screen contract including CR-001", () => {
    // 67: the locked Step 9 set of 64, plus the pricing-rules admin screen
    // — pricing rules are data, so there has to be somewhere to edit them
    // that is not a SQL prompt — plus the team directory, which is where a
    // person's profile becomes something colleagues can actually reach, plus
    // that person's own profile, which is where they edit it.
    // 71: and the sales command centre and the support desk. Both had a route
    // and a page and no registry entry, so the sidebar never offered them --
    // a Sales Support user was landed on theirs at sign-in and, once they
    // navigated away, had no way back to it.
    // 73: and customer orders, list and detail -- what a won quotation turns
    // into, booked here rather than only mirrored from the ERP.
    // 74: and receivables, what customers still owe on those orders.
    // 75: and the delivery calendar.
    // 78: and operations -- work orders, one work order, the production
    // timeline.
    // 80: and customer feedback, the inbox and one entry.
    // 81: and the customer map. 82: and the system page.
    expect(screens).toHaveLength(82);
    expect(new Set(screens.map((screen) => screen.id)).size).toBe(82);
    expect(new Set(screens.map((screen) => screen.route)).size).toBe(82);
    expect(
      screens.every(
        (screen) =>
          screen.permission.length > 0 && screen.operations.length > 0,
      ),
    ).toBe(true);
  });

  it("maps every screen operation to the generated current runtime client", () => {
    const missing = screens.flatMap((screen) =>
      screen.operations
        .filter((operationId) => !operationById.has(operationId))
        .map((operationId) => `${screen.id}:${operationId}`),
    );
    // 277: the client-portal admin screen gained the read it was
    // missing, the pricing rules gained a list, a create and a retire so they
    // stopped being editable only by hand in SQL, and a commercial record
    // gained a conversation of its own — read and post, two operations —
    // and a person gained a profile of their own: read it, edit the parts
    // they control, upload a photo, remove it, and serve a colleague's
    // avatar. That is five more.
    // 283: and a colleague's profile, filtered to what they chose to show.
    // 284: and one user's effective access — roles, countries, permissions.
    // The two access PUTs returned it only *after* replacing it, so an
    // administrator setting roles was overwriting a list nothing could read.
    // 285: and the formwork-customer mix. This number had been 284 while the
    // contract said 285: the catalog generator had not been re-run after the
    // mix endpoint was added, so the one screen that drives operations by id
    // could not have driven that one. A frozen count is what let the drift
    // sit — it is the same trap the contract baseline fell into.
    // 286: and reading a past quotation PDF.
    // 288: and the company-wide list of document subject lines, read by every
    // quotation and added to from any of them.
    // 289: and what a role really grants, so "View as" previews the role and
    // not a guess at it.
    // 291: and each salesperson's own target, read and set.
    // 297: and customer orders -- list, book, the bookable quotations, detail,
    // amend and move.
    // 301: and receivables -- the list, the aging summary, recording a
    // collection and writing off a balance.
    // 305: and shipment execution -- dispatch, delivery, proof of delivery --
    // and the delivery calendar.
    // 311: and work orders -- list, plan, detail, reschedule, move -- and the
    // production schedule.
    // 317: and customer feedback -- the public form, the inbox, its summary,
    // one entry, following it up and matching it to a customer.
    // 319: and the customer map -- the places, and pinning one.
    // 320: and the order-to-cash overview on the dashboard.
    // 321: and a contact directory across every customer.
    // 325: and email and backup status for administrators.
    // 326: and emailing the order confirmation.
    expect(operationCatalog).toHaveLength(326);
    expect(operationById.has("get_documents_by_documentId_content")).toBe(true);
    expect(missing).toEqual([]);
  });

  it("contains the approved CD-S9-001 operations", () => {
    const required = [
      "get_jobs_by_jobId",
      "get_admin_document_templates",
      "post_admin_document_templates",
      "get_finance_payments_by_paymentId",
      "get_documents",
      "get_documents_by_documentId_versions",
      "get_data_quality_issues",
      "get_reconciliation_runs",
    ];
    expect(
      required.every((operationId) => operationById.has(operationId)),
    ).toBe(true);
  });

  it("retains the eight governed critical journey identifiers", () => {
    expect(criticalJourneys).toHaveLength(8);
    expect(new Set(criticalJourneys).size).toBe(8);
  });

  it("keeps immutable V1 boundary labels in the screens", () => {
    const quotation = screens.find(
      (screen) => screen.id === "QUOTATION_DETAIL",
    );
    const orders = screens.find((screen) => screen.id === "ERP_ORDERS");
    const capacity = screens.find((screen) => screen.id === "CAPACITY");
    const logistics = screens.find((screen) => screen.id === "LOGISTICS");
    expect(quotation?.workflowActions).toContain("supersede");
    expect(orders?.operations).toEqual(["get_sales_orders"]);
    expect(capacity?.workflowActions ?? []).not.toContain("reservation");
    expect(logistics?.workflowActions ?? []).not.toContain("shipment");
  });
});
