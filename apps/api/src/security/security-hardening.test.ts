import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NestFactory } from "@nestjs/core";
import request from "supertest";
import { Module, type INestApplication } from "@nestjs/common";
import type { Request, Response } from "express";
import { assertProductionConfiguration } from "./production-config.js";
import { pathToFileURL } from "node:url";
import path from "node:path";

// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- Nest requires a module class for the isolated HTTP security probe.
class SecurityProbeModule {}
Module({})(SecurityProbeModule);

describe("Step 11 HTTP and production security", () => {
  let application: INestApplication;
  beforeAll(async () => {
    process.env.ABP_ALLOWED_ORIGINS = "https://staging.example.invalid";
    const root = path.resolve(import.meta.dirname, "../../dist");
    const { configureHttpApplication } = await import(
      pathToFileURL(path.join(root, "configure-http-app.js")).href
    );
    application = await NestFactory.create(SecurityProbeModule, {
      logger: false,
      cors: false,
      bodyParser: false,
    });
    configureHttpApplication(application);
    application.use(
      "/api/v1/health/live",
      (_request: Request, response: Response) =>
        response.status(200).json({ status: "ok" }),
    );
    await application.init();
  }, 60_000);
  afterAll(async () => application.close(), 30_000);

  it("applies hardened headers and explicit credentialed CORS", async () => {
    const response = await request(application.getHttpServer())
      .get("/api/v1/health/live")
      .set("Origin", "https://staging.example.invalid")
      .expect(200);
    expect(response.headers["content-security-policy"]).toContain(
      "default-src 'none'",
    );
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["x-frame-options"]).toBe("SAMEORIGIN");
    expect(response.headers["permissions-policy"]).toContain("camera=()");
    expect(response.headers["access-control-allow-origin"]).toBe(
      "https://staging.example.invalid",
    );
    expect(response.headers["access-control-allow-credentials"]).toBe("true");
  });

  it("does not grant CORS to an unlisted origin", async () => {
    const response = await request(application.getHttpServer())
      .get("/api/v1/health/live")
      .set("Origin", "https://evil.example.invalid")
      .expect(200);
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("rejects production test auth, wildcard origins and unsafe secrets", () => {
    expect(() =>
      assertProductionConfiguration({
        NODE_ENV: "production",
        ABP_TEST_AUTH_ENABLED: "true",
        ABP_ALLOWED_ORIGINS: "*",
      }),
    ).toThrow(/PRODUCTION_CONFIG_REJECTED/);
  });

  it("accepts a fail-closed production reference configuration", () => {
    expect(() =>
      assertProductionConfiguration({
        NODE_ENV: "production",
        DATABASE_URL:
          "postgresql://managed-identity@private.postgres.database.azure.com/abp?sslmode=require",
        ABP_ALLOWED_ORIGINS: "https://abp.example.com",
        ABP_ENTRA_TENANT_ID: "tenant",
        ABP_ENTRA_CLIENT_ID: "client",
        ABP_KEY_VAULT_URI: "https://abpprodkv.vault.azure.net/",
        APPLICATIONINSIGHTS_CONNECTION_STRING:
          "InstrumentationKey=synthetic-not-a-secret",
        ABP_SESSION_COOKIE_SECURE: "true",
        ABP_EXTERNAL_AI_ENABLED: "false",
      }),
    ).not.toThrow();
  });

  it("accepts the zero-subscription self-hosted production profile", () => {
    expect(() =>
      assertProductionConfiguration({
        NODE_ENV: "production",
        ABP_DEPLOYMENT_MODE: "self-hosted",
        DATABASE_URL: "postgresql://abp@db:5432/abp?sslmode=require",
        ABP_ALLOWED_ORIGINS: "https://abp-commercial.local",
        ABP_LOCAL_SECRET_DIR: "/run/secrets/abp",
        ABP_MFA_MASTER_KEY: Buffer.alloc(32, 7).toString("base64"),
        ABP_SESSION_COOKIE_SECURE: "true",
        ABP_TEST_AUTH_ENABLED: "false",
        ABP_DEMO_SEED_ENABLED: "false",
        ABP_EXTERNAL_AI_ENABLED: "false",
      }),
    ).not.toThrow();
  });

  it("accepts explicitly configured OpenAI advisory integration", () => {
    expect(() =>
      assertProductionConfiguration({
        NODE_ENV: "production",
        DATABASE_URL:
          "postgresql://managed-identity@private.postgres.database.azure.com/abp?sslmode=require",
        ABP_ALLOWED_ORIGINS: "https://abp.example.com",
        ABP_ENTRA_TENANT_ID: "tenant",
        ABP_ENTRA_CLIENT_ID: "client",
        ABP_KEY_VAULT_URI: "https://abpprodkv.vault.azure.net/",
        APPLICATIONINSIGHTS_CONNECTION_STRING:
          "InstrumentationKey=synthetic-not-a-secret",
        ABP_SESSION_COOKIE_SECURE: "true",
        ABP_EXTERNAL_AI_ENABLED: "true",
        OPENAI_API_KEY: "sk-test-configured-in-secret-store",
        OPENAI_MODEL: "gpt-5.2",
        OPENAI_BASE_URL: "https://api.openai.com/v1",
      }),
    ).not.toThrow();
  });
});
