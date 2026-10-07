import nodemailer from "nodemailer";
import type { MailConfig } from "./mail-config.js";

export interface OutgoingEmail {
  to: string[];
  cc: string[];
  replyTo: string | null;
  subject: string;
  html: string;
  text: string;
  attachments: { fileName: string; mimeType: string; content: Buffer }[];
}

export interface MailTransport {
  send(email: OutgoingEmail): Promise<{ messageId: string | null }>;
}

/**
 * A failure that retrying will not fix -- an address the server refuses, a
 * file too big to attach -- as against one that might pass in five minutes.
 */
export class MailError extends Error {
  constructor(
    message: string,
    readonly permanent: boolean,
  ) {
    super(message);
  }
}

/** Microsoft Graph accepts attachments up to 3 MB in a single sendMail. */
export const GRAPH_ATTACHMENT_LIMIT = 3 * 1024 * 1024;

export function createMailTransport(
  config: MailConfig,
  fetcher: typeof fetch = fetch,
): MailTransport | null {
  if (config.provider === "GRAPH") return graphTransport(config, fetcher);
  if (config.provider === "SMTP") return smtpTransport(config);
  return null;
}

function graphTransport(
  config: Extract<MailConfig, { provider: "GRAPH" }>,
  fetcher: typeof fetch,
): MailTransport {
  let token: { value: string; expiresAt: number } | null = null;

  const accessToken = async () => {
    if (token && token.expiresAt > Date.now() + 60_000) return token.value;
    const response = await fetcher(
      `https://login.microsoftonline.com/${encodeURIComponent(config.tenantId)}/oauth2/v2.0/token`,
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: config.clientId,
          client_secret: config.clientSecret,
          scope: "https://graph.microsoft.com/.default",
          grant_type: "client_credentials",
        }).toString(),
      },
    );
    const body = (await response.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    if (!response.ok || typeof body.access_token !== "string")
      // A wrong secret or a missing permission: retrying will not change it,
      // but an administrator fixing it should not lose the queue either.
      throw new MailError(
        `Microsoft sign-in failed (${String(response.status)}): ${reasonOf(body).slice(0, 300)}`,
        false,
      );
    token = {
      value: body.access_token,
      expiresAt: Date.now() + Number(body.expires_in ?? 3000) * 1000,
    };
    return token.value;
  };

  return {
    async send(email) {
      for (const file of email.attachments)
        if (file.content.length > GRAPH_ATTACHMENT_LIMIT)
          throw new MailError(
            `${file.fileName} is larger than the 3 MB Outlook allows in one message.`,
            true,
          );
      const address = (value: string) => ({ emailAddress: { address: value } });
      const response = await fetcher(
        `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(config.sender)}/sendMail`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${await accessToken()}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            message: {
              subject: email.subject,
              body: { contentType: "HTML", content: email.html },
              toRecipients: email.to.map(address),
              ccRecipients: email.cc.map(address),
              ...(email.replyTo ? { replyTo: [address(email.replyTo)] } : {}),
              attachments: email.attachments.map((file) => ({
                "@odata.type": "#microsoft.graph.fileAttachment",
                name: file.fileName,
                contentType: file.mimeType,
                contentBytes: file.content.toString("base64"),
              })),
            },
            saveToSentItems: true,
          }),
        },
      );
      if (response.status === 202 || response.ok)
        return {
          messageId: response.headers.get("request-id") ?? null,
        };
      const detail = await response.text().catch(() => "");
      throw new MailError(
        `Outlook refused the message (${String(response.status)}): ${detail.slice(0, 300)}`,
        response.status >= 400 &&
          response.status < 500 &&
          response.status !== 401 &&
          response.status !== 429,
      );
    },
  };
}

function smtpTransport(
  config: Extract<MailConfig, { provider: "SMTP" }>,
): MailTransport {
  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    // 587 is the submission port: Outlook and Exchange insist on STARTTLS.
    requireTLS: !config.secure && config.port === 587,
    ...(config.user
      ? { auth: { user: config.user, pass: config.password } }
      : {}),
    connectionTimeout: 20_000,
    greetingTimeout: 20_000,
    socketTimeout: 60_000,
  });
  return {
    async send(email) {
      try {
        const info = await transporter.sendMail({
          from: { name: config.fromName, address: config.sender },
          to: email.to,
          cc: email.cc,
          ...(email.replyTo ? { replyTo: email.replyTo } : {}),
          subject: email.subject,
          html: email.html,
          text: email.text,
          attachments: email.attachments.map((file) => ({
            filename: file.fileName,
            contentType: file.mimeType,
            content: file.content,
          })),
        });
        return { messageId: info.messageId || null };
      } catch (error) {
        const code = Number((error as { responseCode?: unknown }).responseCode);
        // 550-554: the server will never take this message for this address.
        const permanent = code >= 550 && code <= 554;
        throw new MailError(
          `The mail server refused the message${Number.isFinite(code) ? ` (${String(code)})` : ""}: ${(error as Error).message.slice(0, 300)}`,
          permanent,
        );
      }
    },
  };
}

/** What Microsoft said went wrong, as text. */
function reasonOf(body: Record<string, unknown>): string {
  for (const key of ["error_description", "error"])
    if (typeof body[key] === "string") return body[key];
  return "no reason given";
}
