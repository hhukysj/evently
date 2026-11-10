import { defineConfig } from "vitest/config";
import {
  assertIntegrationDatabaseTarget,
  requireIntegrationDatabaseUrl,
} from "./apps/api/src/testing/integration-database.js";

const databaseUrl = requireIntegrationDatabaseUrl();
assertIntegrationDatabaseTarget(databaseUrl);
process.env.DATABASE_URL = databaseUrl;

export default defineConfig({
  test: {
    include: ["apps/api/src/**/*.integration.test.ts"],
    environment: "node",
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
