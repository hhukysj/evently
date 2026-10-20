import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { pool } from "./db/client.js";

const app = createApp(pool);
const server = app.listen(env.PORT, "127.0.0.1", () => {
  console.info(`Evently API listening on port ${env.PORT}`);
});

let shuttingDown = false;

function shutdown(signal: string) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  console.info(`Received ${signal}; shutting down API`);

  server.close((error) => {
    if (error) {
      console.error("API server shutdown failed", { errorName: error.name });
      process.exitCode = 1;
    }
    void pool.end().catch((poolError: unknown) => {
      console.error("Database pool shutdown failed", {
        errorName: poolError instanceof Error ? poolError.name : "UnknownError",
      });
      process.exitCode = 1;
    });
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
