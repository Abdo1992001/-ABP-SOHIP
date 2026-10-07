import { describe, expect, it, vi } from "vitest";
import { readMailConfig } from "./mail-config.js";
import {
  MAX_ATTEMPTS,
  nextAttempt,
  notificationPath,
  wantsEmail,
} from "./mail-outbox.js";
import {
  escapeHtml,
  notificationDigest,
  quotationEmail,
} from "./mail-templates.js";
import {
  GRAPH_ATTACHMENT_LIMIT,
  MailError,
  createMailTransport,
} from "./mail-transport.js";

describe("mail settings", () => {
  it("is off until a provider is fully configured", () => {
    expect(readMailConfig({}).provider).toBe("NONE");
    expect(
      readMailConfig({
        ABP_MAIL_PROVIDER: "graph",
        ABP_MAIL_SENDER: "sales@acrow.test",
      }).provider,
    ).toBe("NONE");
  });

  it("reads Microsoft 365 and Exchange settings", () => {
    const graph = readMailConfig({
      ABP_MAIL_PROVIDER: "GRAPH",
      ABP_MAIL_GRAPH_TENANT_ID: "tenant",
      ABP_MAIL_GRAPH_CLIENT_ID: "client",
      ABP_MAIL_GRAPH_CLIENT_SECRET: "secret",
      ABP_MAIL_SENDER: "sales@acrow.test",
      ABP_PUBLIC_APP_URL: "https://crm.acrow.test/",
    });
    expect(graph).toMatchObject({
      provider: "GRAPH",
      appUrl: "https://crm.acrow.test",
    });
    const smtp = readMailConfig({
      ABP_MAIL_PROVIDER: "smtp",
      ABP_MAIL_SMTP_HOST: "mail.acrow.local",
      ABP_MAIL_SENDER: "sales@acrow.test",
    });
    expect(smtp).toMatchObject({ provider: "SMTP", port: 587, secure: false });
  });
});

describe("retries", () => {
  const now = new Date("2026-10-04T10:00:00Z");
  it("waits longer each time, then gives up", () => {
    expect(nextAttempt(1, false, now)?.toISOString()).toBe(
      "2026-10-04T10:01:00.000Z",
    );
    expect(nextAttempt(2, false, now)?.toISOString()).toBe(
      "2026-10-04T10:05:00.000Z",
    );
    expect(nextAttempt(MAX_ATTEMPTS, false, now)).toBeNull();
  });
  it("does not retry what can never be delivered", () => {
    expect(nextAttempt(1, true, now)).toBeNull();
  });
});

describe("notification emails", () => {
  it("are on unless the person turned them off", () => {
    expect(wantsEmail(null)).toBe(true);
    expect(wantsEmail({ emailNotifications: false })).toBe(false);
  });
  it("link each item to its record", () => {
    expect(notificationPath("CUSTOMER_ORDER", "o1")).toBe(
      "/customer-orders/o1",
    );
    expect(notificationPath(null, null)).toBe("/notifications");
  });
  it("gather several into one message", () => {
    const email = notificationDigest({
      lang: "en",
      name: "Mona",
      appUrl: "https://crm.acrow.test",
      items: [
        { title: "Payment overdue", body: null, path: "/customer-orders/o1" },
        { title: "Complaint late", body: "Stage due", path: "/complaints/c1" },
      ],
    });
    expect(email.subject).toBe("2 updates in ABP Commercial");
    expect(email.html).toContain("https://crm.acrow.test/complaints/c1");
  });
});

describe("quotation email", () => {
  it("escapes what the salesperson typed and names the attachment", () => {
    const email = quotationEmail({
      lang: "en",
      subject: null,
      message: "Hello <b>team</b>",
      quotationRef: "QT-2026-0011",
      customerName: "Arab Contractors",
      salesName: "Mohamed Ramadan",
      salesEmail: "m.ramadan@acrow.test",
    });
    expect(email.subject).toBe(
      "Quotation QT-2026-0011 — ACROW Building Products",
    );
    expect(email.html).toContain("Hello &lt;b&gt;team&lt;/b&gt;");
    expect(email.html).toContain("QT-2026-0011.pdf");
    expect(escapeHtml(`"'&`)).toBe("&quot;&#39;&amp;");
  });
  it("writes Arabic right to left", () => {
    const email = quotationEmail({
      lang: "ar",
      subject: null,
      message: null,
      quotationRef: "QT-1",
      customerName: "المقاولون العرب",
      salesName: "محمد",
      salesEmail: null,
    });
    expect(email.html).toContain('dir="rtl"');
    expect(email.subject).toContain("عرض سعر");
  });
});

/** The address a mocked fetch was called with. */
const urlOf = (url: string | URL | Request) =>
  typeof url === "string" ? url : url instanceof URL ? url.href : url.url;

describe("Microsoft Graph", () => {
  const config = readMailConfig({
    ABP_MAIL_PROVIDER: "GRAPH",
    ABP_MAIL_GRAPH_TENANT_ID: "tenant",
    ABP_MAIL_GRAPH_CLIENT_ID: "client",
    ABP_MAIL_GRAPH_CLIENT_SECRET: "secret",
    ABP_MAIL_SENDER: "sales@acrow.test",
  });
  const email = {
    to: ["buyer@customer.test"],
    cc: [],
    replyTo: "rep@acrow.test",
    subject: "Quotation",
    html: "<p>Hi</p>",
    text: "Hi",
    attachments: [
      {
        fileName: "QT.pdf",
        mimeType: "application/pdf",
        content: Buffer.from("%PDF-"),
      },
    ],
  };

  it("signs in once and sends as the company mailbox", async () => {
    const fetcher = vi.fn((url: string | URL | Request, init?: RequestInit) => {
      if (urlOf(url).includes("login.microsoftonline.com"))
        return Promise.resolve(
          new Response(
            JSON.stringify({ access_token: "token", expires_in: 3600 }),
            { status: 200 },
          ),
        );
      expect(urlOf(url)).toBe(
        "https://graph.microsoft.com/v1.0/users/sales%40acrow.test/sendMail",
      );
      const body = JSON.parse(init?.body as string) as {
        message: Record<string, unknown>;
      };
      expect(body.message.replyTo).toEqual([
        { emailAddress: { address: "rep@acrow.test" } },
      ]);
      expect((body.message.attachments as unknown[]).length).toBe(1);
      return Promise.resolve(new Response(null, { status: 202 }));
    });
    const transport = createMailTransport(config, fetcher);
    await transport?.send(email);
    await transport?.send(email);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("refuses an attachment over Outlook's limit without retrying", async () => {
    const transport = createMailTransport(config, vi.fn());
    const big = {
      ...email,
      attachments: [
        {
          fileName: "QT.pdf",
          mimeType: "application/pdf",
          content: Buffer.alloc(GRAPH_ATTACHMENT_LIMIT + 1),
        },
      ],
    };
    await expect(transport?.send(big)).rejects.toMatchObject({
      permanent: true,
    });
    expect(new MailError("x", true).permanent).toBe(true);
  });

  it("retries when Outlook is busy, gives up when it refuses", async () => {
    const respond = (status: number) =>
      vi.fn((url: string | URL | Request) =>
        Promise.resolve(
          urlOf(url).includes("login")
            ? new Response(
                JSON.stringify({ access_token: "t", expires_in: 3600 }),
              )
            : new Response("nope", { status }),
        ),
      );
    await expect(
      createMailTransport(config, respond(429))?.send(email),
    ).rejects.toMatchObject({ permanent: false });
    await expect(
      createMailTransport(config, respond(400))?.send(email),
    ).rejects.toMatchObject({ permanent: true });
  });
});
