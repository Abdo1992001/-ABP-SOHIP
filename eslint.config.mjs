import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/coverage/**",
      "artifacts/**",
      "apps/web/public/runtime-config.js",
      "**/src/generated/**",
      "packages/database/prisma.config.ts",
      "vitest.integration.config.ts",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked.map((config) => ({
    ...config,
    files: ["**/*.ts", "**/*.tsx"],
  })),
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": "error",
    },
  },
  {
    // The browser specs are type-checked by their own tsconfig.e2e.json, which
    // the project service does not discover on its own.
    files: ["apps/web/e2e/**/*.ts", "apps/web/playwright.config.ts"],
    languageOptions: {
      parserOptions: {
        projectService: false,
        project: ["apps/web/tsconfig.e2e.json"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Specs index captured requests they have just asserted exist, and the
      // in-page probes read DOM values whose runtime type is wider than the
      // DOM typings (an SVG className is not a string).
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-unnecessary-condition": "off",
      "@typescript-eslint/no-unnecessary-type-conversion": "off",
      "@typescript-eslint/restrict-template-expressions": "off",
      "@typescript-eslint/require-await": "off",
    },
  },
  {
    ...tseslint.configs.disableTypeChecked,
    files: ["packages/database/prisma/seed.ts", "scripts/uat/**/*.ts"],
    rules: {
      ...tseslint.configs.disableTypeChecked.rules,
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
  {
    files: [
      "apps/api/src/app.module.ts",
      "apps/api/src/domains/domain-modules.ts",
      "apps/api/src/platform/platform.module.ts",
      "apps/worker/src/main.ts",
      "**/*.module.ts",
    ],
    rules: {
      "@typescript-eslint/no-extraneous-class": "off",
    },
  },
  {
    files: ["apps/api/src/**/*-proof-cli.ts"],
    rules: {
      "@typescript-eslint/restrict-template-expressions": "off",
    },
  },
  {
    files: [
      "apps/api/src/finance/finance.service.ts",
      "apps/api/src/logistics/**/*.ts",
      "apps/api/src/returns/returns.service.ts",
      "apps/api/src/targets/**/*.ts",
      "apps/api/src/support/**/*.ts",
    ],
    rules: {
      "@typescript-eslint/restrict-template-expressions": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-unnecessary-condition": "off",
      "@typescript-eslint/no-misused-spread": "off",
      "no-useless-escape": "off",
    },
  },
  {
    files: ["**/*.mjs"],
    languageOptions: {
      globals: {
        Buffer: "readonly",
        console: "readonly",
        crypto: "readonly",
        process: "readonly",
        URL: "readonly",
      },
    },
  },
  {
    files: ["apps/mobile/metro.config.js"],
    languageOptions: {
      globals: {
        __dirname: "readonly",
        module: "readonly",
        require: "readonly",
      },
    },
  },
  {
    files: ["apps/api/src/security/**/*.test.ts"],
    rules: {
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-call": "off",
    },
  },
);
