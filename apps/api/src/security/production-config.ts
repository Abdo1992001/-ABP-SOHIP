const requiredProductionVariables = [
  "DATABASE_URL",
  "ABP_ALLOWED_ORIGINS",
  "ABP_ENTRA_TENANT_ID",
  "ABP_ENTRA_CLIENT_ID",
  "ABP_KEY_VAULT_URI",
  "APPLICATIONINSIGHTS_CONNECTION_STRING",
] as const;

export function assertProductionConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
): void {
  if (environment.NODE_ENV !== "production") return;
  const failures: string[] = [];
  const selfHosted =
    (environment.ABP_DEPLOYMENT_MODE ?? "").toLowerCase() === "self-hosted";
  const externalAiEnabled = environment.ABP_EXTERNAL_AI_ENABLED === "true";
  if (externalAiEnabled) {
    if ((environment.OPENAI_API_KEY ?? "").trim().length === 0)
      failures.push("missing:OPENAI_API_KEY");
    if ((environment.OPENAI_MODEL ?? "").trim().length === 0)
      failures.push("missing:OPENAI_MODEL");
    const baseUrl = environment.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
    if (!baseUrl.startsWith("https://"))
      failures.push("unsafe:OPENAI_BASE_URL");
  }
  if (selfHosted) {
    for (const name of [
      "DATABASE_URL",
      "ABP_ALLOWED_ORIGINS",
      "ABP_LOCAL_SECRET_DIR",
      "ABP_MFA_MASTER_KEY",
    ]) {
      if ((environment[name] ?? "").trim().length === 0)
        failures.push(`missing:${name}`);
    }
    const origins = (environment.ABP_ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((x) => x.trim());
    if (
      origins.some((origin) => origin === "*" || origin.startsWith("http://"))
    )
      failures.push("unsafe:ABP_ALLOWED_ORIGINS");
    if (environment.ABP_TEST_AUTH_ENABLED === "true")
      failures.push("unsafe:test-auth");
    if (environment.ABP_DEMO_SEED_ENABLED === "true")
      failures.push("unsafe:demo-seed");
    if (environment.ABP_SESSION_COOKIE_SECURE !== "true")
      failures.push("unsafe:cookie");
    if ((environment.DATABASE_URL ?? "").includes("localhost"))
      failures.push("unsafe:localhost-db");
    if (
      Buffer.from(environment.ABP_MFA_MASTER_KEY ?? "", "base64").length !== 32
    )
      failures.push("unsafe:mfa-master-key");
    if (failures.length > 0)
      throw new Error(`PRODUCTION_CONFIG_REJECTED:${failures.join(",")}`);
    return;
  }
  for (const name of requiredProductionVariables) {
    if ((environment[name] ?? "").trim().length === 0)
      failures.push(`missing:${name}`);
  }
  const origins = (environment.ABP_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((x) => x.trim());
  if (
    origins.some(
      (origin) => origin === "*" || origin.startsWith("http://localhost"),
    )
  ) {
    failures.push("unsafe:ABP_ALLOWED_ORIGINS");
  }
  if (environment.ABP_TEST_AUTH_ENABLED === "true")
    failures.push("unsafe:test-auth");
  if (environment.ABP_DEMO_SEED_ENABLED === "true")
    failures.push("unsafe:demo-seed");
  if (environment.ABP_SESSION_COOKIE_SECURE !== "true")
    failures.push("unsafe:cookie");
  if ((environment.DATABASE_URL ?? "").includes("localhost"))
    failures.push("unsafe:localhost-db");
  if (!(environment.ABP_KEY_VAULT_URI ?? "").startsWith("https://"))
    failures.push("unsafe:key-vault");
  if (failures.length > 0)
    throw new Error(`PRODUCTION_CONFIG_REJECTED:${failures.join(",")}`);
}
