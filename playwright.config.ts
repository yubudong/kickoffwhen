import { defineConfig, devices } from "@playwright/test";

import { testEmailSecret } from "./e2e/test-config";

const e2eUrl = "http://127.0.0.1:3105";
const e2eDatabaseUrl =
  process.env.E2E_DATABASE_URL ??
  "postgres://app:app@127.0.0.1:5433/family_learning_test";

export default defineConfig({
  testDir: "e2e",
  use: { baseURL: e2eUrl },
  webServer: {
    command:
      "pnpm db:migrate && pnpm dev --hostname 127.0.0.1 --port 3105",
    env: {
      NODE_ENV: "development",
      DATABASE_URL: e2eDatabaseUrl,
      APP_URL: e2eUrl,
      BETTER_AUTH_SECRET: "test-only-secret-123456789012345678901234567890",
      AUTH_TEST_EMAIL_ENABLED: "true",
      AUTH_TEST_EMAIL_SECRET: testEmailSecret,
      FAMILY_LEARNING_TEST_MODE: "e2e",
      NEXT_DIST_DIR: ".next-e2e",
    },
    reuseExistingServer: false,
    timeout: 120_000,
    url: e2eUrl,
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        extraHTTPHeaders: { "x-forwarded-for": "192.0.2.10" },
      },
    },
    {
      name: "webkit",
      use: {
        ...devices["Desktop Safari"],
        extraHTTPHeaders: { "x-forwarded-for": "198.51.100.10" },
      },
    },
  ],
});
