import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { db, pool } from "./db/client.js";
import { PostgresRateLimitStore } from "./middleware/postgres-rate-limit-store.js";
import {
  DevelopmentEmailDelivery,
  UnconfiguredEmailDelivery,
} from "./modules/auth/email-delivery.js";
import { PostgresUserRepository } from "./modules/auth/repository.js";
import { PasswordAuthService } from "./modules/auth/service.js";
import {
  createPostgresSessionStore,
  sessionCookieName,
} from "./middleware/sessions.js";

const secureCookies = env.NODE_ENV === "production";
const sessionStore = createPostgresSessionStore(pool);
const developmentEmailDelivery =
  env.NODE_ENV === "development"
    ? new DevelopmentEmailDelivery(env.NODE_ENV)
    : undefined;
const app = createApp(pool, {
  environment: env.NODE_ENV,
  ...(developmentEmailDelivery
    ? { developmentEmailInbox: developmentEmailDelivery }
    : {}),
  service: new PasswordAuthService(
    new PostgresUserRepository(db),
    developmentEmailDelivery ?? new UnconfiguredEmailDelivery(),
  ),
  sessionStore,
  sessionSecret: env.SESSION_SECRET,
  appOrigin: env.APP_ORIGIN,
  secureCookies,
  cookieName: sessionCookieName(secureCookies),
  trustProxyHops: env.TRUST_PROXY_HOPS,
  rateLimitStoreFactory: (scope) => new PostgresRateLimitStore(pool, scope),
});
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
    sessionStore.close();
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
