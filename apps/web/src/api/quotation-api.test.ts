import type { ApiClient } from "@abp/api-client";
import { describe, expect, it, vi } from "vitest";
import {
  createQuotation,
  createQuotationFromReading,
} from "./quotation-api.ts";

function clientWithPost(post: ReturnType<typeof vi.fn>): ApiClient {
  return { POST: post } as unknown as ApiClient;
}

const created = {
  quotationId: "11111111-1111-4111-8111-111111111111",
  rowVersion: '"rv-2"',
};

describe("atomic quotation creation client", () => {
  it("sends the full draft with the caller's stable idempotency key", async () => {
    const post = vi.fn().mockResolvedValue({
      data: { data: created },
      response: new Response(null, { status: 201 }),
    });
    const client = clientWithPost(post);
    const input = {
      opportunityId: "22222222-2222-4222-8222-222222222222",
      currencyCode: "EGP",
      draft: {
        paymentTermsCode: "CASH_IN_ADVANCE",
        lines: [
          {
            productId: "33333333-3333-4333-8333-333333333333",
            description: "Acrow Board",
            qty: "2",
            unitCode: "PIECE",
            unitPrice: "125",
          },
        ],
      },
    } as const;

    await expect(
      createQuotation(client, input, "wizard-attempt-1"),
    ).resolves.toEqual(created);
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith("/quotations", {
      params: { header: { "Idempotency-Key": "wizard-attempt-1" } },
      body: input,
    });
  });

  it("imports a PDF reading with one POST instead of create-then-save", async () => {
    const post = vi.fn().mockResolvedValue({
      data: { data: created },
      response: new Response(null, { status: 201 }),
    });
    const client = clientWithPost(post);

    await createQuotationFromReading(client, {
      opportunityId: "22222222-2222-4222-8222-222222222222",
      lines: [{ description: "Read line", qty: 3, unitPrice: 40 }],
    });

    expect(post).toHaveBeenCalledTimes(1);
    const call = post.mock.calls[0] as unknown as readonly [
      string,
      {
        body: {
          draft: {
            lines: Array<{
              description: string;
              qty: string;
              unitCode: string;
              unitPrice: string;
            }>;
          };
        };
      },
    ];
    expect(call[0]).toBe("/quotations");
    expect(call[1].body.draft.lines).toEqual([
      {
        description: "Read line",
        qty: "3",
        unitCode: "PIECE",
        unitPrice: "40",
      },
    ]);
  });
});
