import { Pool } from "pg";
import {
  requireIntegrationDatabaseUrl,
  verifyIntegrationDatabase,
} from "./integration-database.js";

const databaseUrl = requireIntegrationDatabaseUrl();

const pool = new Pool({ connectionString: databaseUrl });
try {
  await verifyIntegrationDatabase(databaseUrl, pool);
  console.log("Integration database identity verified.");
} finally {
  await pool.end();
}
