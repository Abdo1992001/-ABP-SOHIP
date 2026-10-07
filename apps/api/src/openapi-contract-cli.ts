import type { Server } from "node:http";
import path from "node:path";
import { Test } from "@nestjs/testing";
import SwaggerParser from "@apidevtools/swagger-parser";
import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js";
import request from "supertest";
import { AppModule } from "./app.module.js";
import { configureHttpApplication } from "./configure-http-app.js";
import { databaseClientToken } from "./platform/database.providers.js";

class ContractTestDatabase {
  queryCount = 0;
  failNextQuery = false;

  $queryRawUnsafe(): Promise<Array<{ ready: number }>> {
    this.queryCount += 1;
    if (this.failNextQuery) {
      this.failNextQuery = false;
      throw new Error("CONTRACT_TEST_DATABASE_UNAVAILABLE");
    }
    return Promise.resolve([{ ready: 1 }]);
  }

  $disconnect(): Promise<void> {
    return Promise.resolve();
  }
}

async function run(): Promise<void> {
  const schemas = await loadRuntimeSchemas();
  const database = new ContractTestDatabase();
  const testingModule = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(databaseClientToken)
    .useValue(database)
    .compile();
  const application = testingModule.createNestApplication();
  configureHttpApplication(application);
  await application.init();
  const httpServer = application.getHttpServer() as Server;

  try {
    const live = await request(httpServer).get("/api/v1/health/live");
    assertStatus(live.status, 200, "health liveness");
    assertSchema(schemas.health, parseBody(live.text), "health liveness");
    assert(database.queryCount === 0, "liveness queried PostgreSQL");

    const ready = await request(httpServer).get("/api/v1/health/ready");
    assertStatus(ready.status, 200, "health readiness");
    assertSchema(schemas.health, parseBody(ready.text), "health readiness");
    assert(
      database.queryCount === 1,
      "readiness did not query PostgreSQL once",
    );

    database.failNextQuery = true;
    const unavailable = await request(httpServer).get("/api/v1/health/ready");
    assertStatus(unavailable.status, 503, "failed readiness");
    assertSchema(
      schemas.health,
      parseBody(unavailable.text),
      "failed readiness",
    );

    const missing = await request(httpServer)
      .get("/api/v1/not-a-contracted-operation")
      .set("x-trace-id", "trace-contract-test-0001")
      .set("x-correlation-id", "correlation-contract-test-0001");
    assertStatus(missing.status, 404, "canonical not-found response");
    const missingBody = parseBody(missing.text);
    assertSchema(schemas.error, missingBody, "canonical not-found response");
    assert(
      JSON.stringify(missingBody) ===
        JSON.stringify({
          error: {
            code: "RESOURCE_NOT_FOUND",
            messageKey: "errors.resource_not_found",
            params: {},
            fieldErrors: [],
            ruleErrors: [],
            traceId: "trace-contract-test-0001",
            correlationId: "correlation-contract-test-0001",
            conflict: null,
          },
        }),
      "canonical not-found envelope drifted",
    );
    assert(
      !JSON.stringify(missingBody).includes("not-a-contracted-operation"),
      "canonical error leaked route details",
    );

    const customerRuntimeRoutes = [
      ["get", "/api/v1/me"],
      ["get", "/api/v1/reference/countries"],
      ["get", "/api/v1/accounts"],
      ["post", "/api/v1/accounts"],
      ["get", "/api/v1/accounts/30000000-0000-4000-8000-000000000001"],
      ["patch", "/api/v1/accounts/30000000-0000-4000-8000-000000000001"],
      ["post", "/api/v1/accounts/30000000-0000-4000-8000-000000000001/archive"],
      ["get", "/api/v1/accounts/30000000-0000-4000-8000-000000000001/contacts"],
      [
        "post",
        "/api/v1/accounts/30000000-0000-4000-8000-000000000001/contacts",
      ],
      ["get", "/api/v1/contacts/31000000-0000-4000-8000-000000000001"],
      ["patch", "/api/v1/contacts/31000000-0000-4000-8000-000000000001"],
      [
        "post",
        "/api/v1/contacts/31000000-0000-4000-8000-000000000001/channels",
      ],
      [
        "delete",
        "/api/v1/contact-channels/32000000-0000-4000-8000-000000000001",
      ],
      [
        "post",
        "/api/v1/accounts/30000000-0000-4000-8000-000000000001/contact-shares",
      ],
      ["delete", "/api/v1/contact-shares/33000000-0000-4000-8000-000000000001"],
      ["get", "/api/v1/projects"],
      ["post", "/api/v1/projects"],
      ["get", "/api/v1/projects/80000000-0000-4000-8000-000000000001"],
      ["patch", "/api/v1/projects/80000000-0000-4000-8000-000000000001"],
      ["post", "/api/v1/projects/80000000-0000-4000-8000-000000000001/archive"],
      ["get", "/api/v1/opportunities"],
      ["post", "/api/v1/opportunities"],
      ["get", "/api/v1/opportunities/80000000-0000-4000-8000-000000000001"],
      ["patch", "/api/v1/opportunities/80000000-0000-4000-8000-000000000001"],
      [
        "post",
        "/api/v1/opportunities/80000000-0000-4000-8000-000000000001/stage-transitions",
      ],
      [
        "post",
        "/api/v1/opportunities/80000000-0000-4000-8000-000000000001/probability-overrides",
      ],
      ["get", "/api/v1/reference/opportunity-stage-policies"],
      ["get", "/api/v1/reference/opportunity-lost-reasons"],
    ] as const;
    for (const [method, route] of customerRuntimeRoutes) {
      const result = await request(httpServer)[method](route);
      assertStatus(result.status, 401, `${method.toUpperCase()} ${route}`);
      assertSchema(
        schemas.error,
        parseBody(result.text),
        `${method.toUpperCase()} ${route}`,
      );
    }

    console.info(
      JSON.stringify({
        result: "RUNTIME_OPENAPI_CONTRACT_TEST_PASSED",
        operationsTested: [
          "GET /health/live",
          "GET /health/ready",
          ...customerRuntimeRoutes.map(
            ([method, route]) =>
              `${method.toUpperCase()} ${route.replace("/api/v1", "")}`,
          ),
        ],
        responseCases: 32,
      }),
    );
  } finally {
    await application.close();
  }
}

async function loadRuntimeSchemas(): Promise<{
  health: ValidateFunction;
  error: ValidateFunction;
}> {
  const openapiPath = path.resolve(
    import.meta.dirname,
    "../../../docs/contracts/openapi/openapi.yaml",
  );
  const api = (await SwaggerParser.dereference(openapiPath, {
    dereference: { circular: "ignore" },
  })) as unknown as OpenApiContract;
  const healthSchema = api.components?.schemas?.HealthEnvelope;
  const errorSchema = api.components?.schemas?.ErrorEnvelope;
  if (healthSchema === undefined || errorSchema === undefined) {
    throw new Error("OPENAPI_RUNTIME_SCHEMAS_MISSING");
  }
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  ajv.addFormat("date", /^\d{4}-\d{2}-\d{2}$/u);
  ajv.addFormat(
    "date-time",
    (value: string) => !Number.isNaN(Date.parse(value)),
  );
  ajv.addFormat(
    "uuid",
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu,
  );
  return {
    health: ajv.compile(healthSchema),
    error: ajv.compile(errorSchema),
  };
}

function parseBody(value: string): unknown {
  return JSON.parse(value) as unknown;
}

function assertSchema(
  validator: ValidateFunction,
  value: unknown,
  caseName: string,
): void {
  if (!validator(value)) {
    throw new Error(
      `${caseName} response failed OpenAPI validation: ${JSON.stringify(validator.errors)}`,
    );
  }
}

function assertStatus(
  actual: number,
  expected: number,
  caseName: string,
): void {
  assert(
    actual === expected,
    `${caseName} returned ${actual.toString()}, expected ${expected.toString()}`,
  );
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

interface OpenApiContract {
  components?: {
    schemas?: Record<string, object>;
  };
}

await run();
