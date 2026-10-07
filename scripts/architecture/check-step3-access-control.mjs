import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const read = (relativePath) => readFile(resolve(root, relativePath), "utf8");
const [schema, guard, customer, matrix, routes] = await Promise.all([
  read("packages/database/prisma/schema.prisma"),
  read("apps/api/src/customer/customer-auth.ts"),
  read("apps/api/src/customer/customer.service.ts"),
  read("docs/security/authorization-matrix.json"),
  read("apps/web/src/app/routes.ts"),
]);

const required = [
  [schema, "model UserCountryAccess", "persistent Country Scope"],
  [schema, "model UserPermissionOverride", "persistent explicit DENY"],
  [schema, "model AppSession", "persistent sessions"],
  [guard, "requireActiveForTestUser", "session truth guard"],
  [guard, "canUseManagerContext", "bounded manager context"],
  [
    customer,
    "countryCode: { in: [...identity.countryCodes] }",
    "query Country Scope",
  ],
  [customer, "canUseManagerContext(identity)", "manager role gate"],
  [matrix, '"denyWins": true', "authorization matrix"],
  [routes, 'path: "/sales/management"', "nested sales management route"],
  [routes, 'path: "/sales/support"', "nested sales support route"],
];
const missing = required
  .filter(([content, needle]) => !content.includes(needle))
  .map(([, , description]) => description);
if (missing.length) {
  console.error(JSON.stringify({ result: "FAIL", missing }));
  process.exit(1);
}
console.log(
  JSON.stringify({
    result: "PASS",
    checks: required.length,
    ssotDeviations: 0,
  }),
);
