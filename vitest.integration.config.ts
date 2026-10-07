import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "apps/api/src/**/*.integration.test.ts",
      "apps/worker/src/**/*.integration.test.ts",
      "packages/database/src/**/*.integration.test.ts",
    ],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
