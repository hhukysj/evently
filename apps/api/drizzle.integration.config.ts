import { defineConfig } from "drizzle-kit";

const integrationDatabaseUrl =
  process.env.EVENTLY_INTEGRATION_DATABASE_URL?.trim();

if (!integrationDatabaseUrl) {
  throw new Error("EVENTLY_INTEGRATION_DATABASE_URL is required.");
}

let integrationDatabaseTarget: URL;
try {
  integrationDatabaseTarget = new URL(integrationDatabaseUrl);
} catch {
  throw new Error("The integration database URL is invalid.");
}

if (
  !["postgres:", "postgresql:"].includes(integrationDatabaseTarget.protocol) ||
  integrationDatabaseTarget.hostname !== "127.0.0.1" ||
  integrationDatabaseTarget.port !== "5432" ||
  integrationDatabaseTarget.username !== "evently_verifier" ||
  integrationDatabaseTarget.password !== "" ||
  integrationDatabaseTarget.pathname !== "/evently_verify_clean" ||
  integrationDatabaseTarget.search !== "" ||
  integrationDatabaseTarget.hash !== ""
) {
  throw new Error(
    "Integration migrations are restricted to evently_verify_clean on local PostgreSQL.",
  );
}

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: integrationDatabaseUrl,
  },
});
