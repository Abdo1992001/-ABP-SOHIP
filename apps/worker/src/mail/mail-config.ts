/**
 * How email leaves the building, read from the environment.
 *
 * Two ways, because Outlook comes two ways:
 *
 * - GRAPH: Outlook on Microsoft 365. Microsoft is retiring password sign-in
 *   for SMTP on Microsoft 365, so mail goes through Microsoft Graph with an
 *   app registration (tenant, client id, client secret) allowed to send as
 *   the company mailbox.
 * - SMTP: Outlook on the company's own Exchange server, or any mail server
 *   that takes a user name and password.
 *
 * Nothing configured is a valid state: the system then records quotations as
 * sent by hand, exactly as before, and keeps notifications in the app.
 */

export type MailConfig =
  | { provider: "NONE" }
  | {
      provider: "GRAPH";
      tenantId: string;
      clientId: string;
      clientSecret: string;
      sender: string;
      fromName: string;
      appUrl: string;
    }
  | {
      provider: "SMTP";
      host: string;
      port: number;
      /** true: TLS from the first byte (465). false: STARTTLS (587, 25). */
      secure: boolean;
      user: string;
      password: string;
      sender: string;
      fromName: string;
      appUrl: string;
    };

const value = (env: NodeJS.ProcessEnv, name: string) =>
  (env[name] ?? "").trim();

export function readMailConfig(
  env: NodeJS.ProcessEnv = process.env,
): MailConfig {
  const provider = value(env, "ABP_MAIL_PROVIDER").toUpperCase();
  const fromName =
    value(env, "ABP_MAIL_FROM_NAME") || "ACROW Building Products";
  const appUrl = (
    value(env, "ABP_PUBLIC_APP_URL") || "http://localhost:8080"
  ).replace(/\/+$/, "");
  const sender = value(env, "ABP_MAIL_SENDER");
  if (provider === "GRAPH") {
    const tenantId = value(env, "ABP_MAIL_GRAPH_TENANT_ID");
    const clientId = value(env, "ABP_MAIL_GRAPH_CLIENT_ID");
    const clientSecret = value(env, "ABP_MAIL_GRAPH_CLIENT_SECRET");
    if (!tenantId || !clientId || !clientSecret || !sender)
      return { provider: "NONE" };
    return {
      provider,
      tenantId,
      clientId,
      clientSecret,
      sender,
      fromName,
      appUrl,
    };
  }
  if (provider === "SMTP") {
    const host = value(env, "ABP_MAIL_SMTP_HOST");
    const port = Number(value(env, "ABP_MAIL_SMTP_PORT") || "587");
    if (!host || !sender || !Number.isInteger(port))
      return { provider: "NONE" };
    return {
      provider,
      host,
      port,
      secure: value(env, "ABP_MAIL_SMTP_SECURE").toLowerCase() === "true",
      user: value(env, "ABP_MAIL_SMTP_USER"),
      password: value(env, "ABP_MAIL_SMTP_PASSWORD"),
      sender,
      fromName,
      appUrl,
    };
  }
  return { provider: "NONE" };
}
