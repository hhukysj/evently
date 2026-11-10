import { randomBytes, randomUUID } from "node:crypto";
import { defineConfig, devices } from "@playwright/test";
import { assertIntegrationDatabaseTarget } from "./apps/api/src/testing/integration-database.js";

const baseURL = "http://127.0.0.1:5174";
const databaseUrl = process.env.EVENTLY_E2E_DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    "Set EVENTLY_E2E_DATABASE_URL to an approved disposable PostgreSQL target.",
  );
}

assertIntegrationDatabaseTarget(databaseUrl);

const sessionSecret = randomBytes(32).toString("base64url");
const rateLimitNamespace = randomUUID();

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report", open: "never" }],
  ],
  outputDir: "test-results",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    ...devices["Desktop Chrome"],
    baseURL,
    browserName: "chromium",
    headless: true,
    screenshot: "only-on-failure",
    trace: "off",
  },
  webServer: [
    {
      command: "npm run dev:api",
      url: "http://127.0.0.1:3001/health",
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        DATABASE_URL: databaseUrl,
        SESSION_SECRET: sessionSecret,
        APP_ORIGIN: baseURL,
        NODE_ENV: "development",
        PORT: "3001",
        TRUST_PROXY_HOPS: "0",
        EVENTLY_TEST_RATE_LIMIT_NAMESPACE: rateLimitNamespace,
      },
    },
    {
      command:
        "npm run dev --workspace @evently/web -- --port 5174 --strictPort",
      url: baseURL,
      reuseExistingServer: false,
      timeout: 120_000,
      env: { PORT: "3001" },
    },
  ],
});
