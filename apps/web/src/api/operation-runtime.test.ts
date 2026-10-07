import { describe, expect, it } from "vitest";
import { operationCatalog } from "./operation-runtime.ts";

/**
 * The contract says which commands need an `Idempotency-Key`, and the
 * frontend has to be able to see it.
 *
 * It could not. The requirement was carried in the OpenAPI as
 * `x-abp-idempotency` and dropped by both generators on the way here, so every
 * call site had to remember for itself — and two did not. Adding a document
 * subject and requesting a manager override each answered 400
 * IDEMPOTENCY_KEY_REQUIRED, with nothing on screen beyond "try again", and
 * only when somebody pressed the button.
 *
 * These guard the field rather than the behaviour: once it is in the
 * catalogue, `executeOperation` supplies the key itself and no call site can
 * get it wrong again.
 */
describe("the operation catalogue carries the idempotency requirement", () => {
  it("says so for the commands that have it", () => {
    const required = operationCatalog.filter((operation) =>
      /^(required|idempotency-key)$/i.test(operation.idempotency ?? ""),
    );
    // Every mutation of a versioned record and every create in the system.
    expect(required.length).toBeGreaterThan(80);
  });

  it("names the two that were failing", () => {
    for (const id of [
      "post_document_subjects",
      "post_pricing_manager_overrides",
    ]) {
      const operation = operationCatalog.find((one) => one.operationId === id);
      expect(operation, `${id} is missing from the catalogue`).toBeDefined();
      expect(
        /^(required|idempotency-key)$/i.test(operation?.idempotency ?? ""),
        `${id} does not declare that it needs a key`,
      ).toBe(true);
    }
  });

  it("does not ask a read for one", () => {
    for (const operation of operationCatalog.filter(
      (one) => one.method === "GET",
    ))
      expect(
        /^(required|idempotency-key)$/i.test(operation.idempotency ?? ""),
        `${operation.operationId} is a GET and should need no key`,
      ).toBe(false);
  });

  it("gives every operation a value, so a missing field is never read as NONE", () => {
    for (const operation of operationCatalog)
      expect(
        typeof operation.idempotency,
        `${operation.operationId} has no idempotency field`,
      ).toBe("string");
  });
});
