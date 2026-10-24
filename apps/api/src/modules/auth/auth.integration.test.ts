import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray, like, or, sql } from "drizzle-orm";
import { createApp } from "../../app.js";
import { env } from "../../config/env.js";
import { db, pool } from "../../db/client.js";
import {
  accountTokens,
  adminAuditLogs,
  sessions,
  users,
} from "../../db/schema.js";
import { PostgresRateLimitStore } from "../../middleware/postgres-rate-limit-store.js";
import { createPostgresSessionStore } from "../../middleware/sessions.js";
import {
  DevelopmentEmailDelivery,
  type DevelopmentEmailMessage,
} from "./email-delivery.js";
import { PostgresUserRepository } from "./repository.js";
import { PasswordAuthService, hashToken } from "./service.js";

const fixturePrefix = `auth-it-${randomUUID()}`;
const fixtureEmails = {
  customer: `${fixturePrefix}-customer@example.test`,
  target: `${fixturePrefix}-target@example.test`,
  admin: `${fixturePrefix}-admin@example.test`,
  expired: `${fixturePrefix}-expired@example.test`,
  expiredVerification: `${fixturePrefix}-expired-verification@example.test`,
};
const trackedSessionIds = new Set<string>();
const rateLimitStores: PostgresRateLimitStore[] = [];
const sessionStore = createPostgresSessionStore(pool);

const emailProvider = new DevelopmentEmailDelivery("development");
const service = new PasswordAuthService(
  new PostgresUserRepository(db),
  emailProvider,
);
const app = createApp(pool, {
  service,
  environment: "development",
  developmentEmailInbox: emailProvider,
  sessionStore,
  sessionSecret: env.SESSION_SECRET,
  appOrigin: env.APP_ORIGIN,
  secureCookies: false,
  cookieName: "evently.sid",
  trustProxyHops: 0,
  rateLimitStoreFactory: (scope) => {
    const store = new PostgresRateLimitStore(pool, `${fixturePrefix}:${scope}`);
    rateLimitStores.push(store);
    return store;
  },
});

function csrfHeaders(token: string) {
  return {
    Origin: env.APP_ORIGIN,
    "X-CSRF-Token": token,
  };
}

function trackSession(response: request.Response): void {
  const header = response.headers["set-cookie"];
  const cookies = Array.isArray(header) ? header : header ? [header] : [];
  for (const cookie of cookies) {
    const encodedValue = cookie.split(";")[0]?.split("=")[1];
    if (!encodedValue) {
      continue;
    }
    const decodedValue = decodeURIComponent(encodedValue);
    const sessionId = decodedValue.startsWith("s:")
      ? decodedValue.slice(2).split(".")[0]
      : undefined;
    if (sessionId) {
      trackedSessionIds.add(sessionId);
    }
  }
}

function responseSessionId(response: request.Response): string {
  const header = response.headers["set-cookie"];
  const cookies = Array.isArray(header) ? header : header ? [header] : [];
  const encodedValue = cookies[0]?.split(";")[0]?.split("=")[1];
  if (!encodedValue) {
    throw new Error("Expected a session cookie in the test response");
  }
  const decodedValue = decodeURIComponent(encodedValue);
  if (!decodedValue.startsWith("s:")) {
    throw new Error("Test session cookie did not contain a signed session ID");
  }
  return decodedValue.slice(2).split(".")[0] ?? "";
}

async function csrfToken(agent: ReturnType<typeof request.agent>) {
  const response = await agent.get("/api/v1/auth/csrf");
  trackSession(response);
  expect(response.status).toBe(200);
  return response.body.data.csrfToken as string;
}

async function postWithCsrf(
  agent: ReturnType<typeof request.agent>,
  path: string,
  body: Record<string, unknown>,
) {
  const token = await csrfToken(agent);
  const response = await agent.post(path).set(csrfHeaders(token)).send(body);
  trackSession(response);
  return response;
}

async function developmentEmailToken(
  agent: ReturnType<typeof request.agent>,
  email: string,
  type: DevelopmentEmailMessage["type"],
): Promise<string> {
  const response = await agent.get("/api/v1/dev/email-inbox");
  expect(response.status).toBe(200);
  expect(response.headers["cache-control"]).toBe("no-store");
  const messages = response.body.data.messages as DevelopmentEmailMessage[];
  const message = messages.find(
    (item) => item.email === email && item.type === type,
  );
  if (!message) {
    throw new Error("Expected a matching local development account message");
  }
  return message.token;
}

async function registerAndVerify(
  agent: ReturnType<typeof request.agent>,
  email: string,
  password: string,
) {
  const registration = await postWithCsrf(agent, "/api/v1/auth/register", {
    email,
    password,
  });
  expect(registration.status).toBe(202);
  const verificationToken = await developmentEmailToken(
    agent,
    email,
    "email_verification",
  );
  const tokenHash = hashToken(verificationToken);
  const [storedToken] = await db
    .select()
    .from(accountTokens)
    .where(eq(accountTokens.tokenHash, tokenHash))
    .limit(1);
  expect(storedToken?.tokenHash).toBe(tokenHash);
  expect(storedToken?.tokenHash).not.toBe(verificationToken);
  expect(storedToken?.expiresAt.getTime()).toBeGreaterThan(Date.now());
  expect(storedToken?.expiresAt.getTime()).toBeLessThanOrEqual(
    Date.now() + 30 * 60 * 1000 + 1_000,
  );

  const verification = await postWithCsrf(agent, "/api/v1/auth/verify-email", {
    token: verificationToken,
  });
  expect(verification.status).toBe(200);
  return verificationToken;
}

async function login(
  agent: ReturnType<typeof request.agent>,
  email: string,
  password: string,
) {
  return postWithCsrf(agent, "/api/v1/auth/login", { email, password });
}

async function destroySession(id: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    sessionStore.destroy(id, (error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

beforeAll(async () => {
  await pool.query("SELECT 1");
});

afterAll(async () => {
  for (const id of trackedSessionIds) {
    await destroySession(id);
  }
  const fixtureUsers = await db
    .select({ id: users.id })
    .from(users)
    .where(like(users.email, `${fixturePrefix}%`));
  const fixtureUserIds = fixtureUsers.map(({ id }) => id);
  if (fixtureUserIds.length > 0) {
    await db
      .delete(adminAuditLogs)
      .where(
        or(
          inArray(adminAuditLogs.actorUserId, fixtureUserIds),
          inArray(adminAuditLogs.targetUserId, fixtureUserIds),
        ),
      );
    await db.delete(sessions).where(
      sql`${sessions.sess}->>'userId' IN (${sql.join(
        fixtureUserIds.map((id) => sql`${id}`),
        sql`, `,
      )})`,
    );
    await db.delete(users).where(inArray(users.id, fixtureUserIds));
  }
  for (const store of rateLimitStores) {
    await store.clear();
    await store.shutdown();
  }
  sessionStore.close();
  await pool.end();
});

describe("PostgreSQL authentication integration", () => {
  it("has migrated user, session, token, audit, and shared-limit tables", async () => {
    const { rows } = await pool.query<{ table_name: string }>(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name = ANY($1::text[])`,
      [
        [
          "users",
          "sessions",
          "account_tokens",
          "admin_audit_logs",
          "rate_limit_counters",
        ],
      ],
    );
    expect(rows.map(({ table_name }) => table_name).sort()).toEqual(
      [
        "account_tokens",
        "admin_audit_logs",
        "rate_limit_counters",
        "sessions",
        "users",
      ].sort(),
    );
  });

  it("persists registration, one-time verification/reset, sessions, and audited authorization", async () => {
    const password = "integration-password-123";
    const agent = request.agent(app);
    const guestSessionToken = await csrfToken(agent);
    const guestCookieResponse = await agent.get("/api/v1/auth/csrf");
    trackSession(guestCookieResponse);
    const guestId = responseSessionId(guestCookieResponse);

    await agent
      .post("/api/v1/auth/register")
      .set(csrfHeaders(guestSessionToken))
      .send({ email: fixtureEmails.customer, password });
    const customer = await db
      .select()
      .from(users)
      .where(eq(users.email, fixtureEmails.customer))
      .limit(1);
    expect(customer[0]?.passwordHash).not.toBe(password);
    expect(customer[0]?.emailVerifiedAt).toBeNull();

    const unverifiedLogin = await login(
      agent,
      fixtureEmails.customer,
      password,
    );
    expect(unverifiedLogin.status).toBe(401);
    const verificationToken = await developmentEmailToken(
      agent,
      fixtureEmails.customer,
      "email_verification",
    );
    const [verificationRecord] = await db
      .select()
      .from(accountTokens)
      .where(eq(accountTokens.tokenHash, hashToken(verificationToken)))
      .limit(1);
    expect(verificationRecord?.tokenHash).toBe(hashToken(verificationToken));
    expect(verificationRecord?.tokenHash).not.toBe(verificationToken);

    const verification = await postWithCsrf(
      agent,
      "/api/v1/auth/verify-email",
      { token: verificationToken },
    );
    expect(verification.status).toBe(200);
    const reuseVerification = await postWithCsrf(
      agent,
      "/api/v1/auth/verify-email",
      { token: verificationToken },
    );
    expect(reuseVerification.body.data).toEqual(verification.body.data);
    expect(
      (
        await db
          .select({ emailVerifiedAt: users.emailVerifiedAt })
          .from(users)
          .where(eq(users.email, fixtureEmails.customer))
      )[0]?.emailVerifiedAt,
    ).toBeInstanceOf(Date);

    const successfulLogin = await login(
      agent,
      fixtureEmails.customer,
      password,
    );
    expect(successfulLogin.status).toBe(200);
    const authenticatedSessionId = responseSessionId(successfulLogin);
    expect(authenticatedSessionId).not.toBe(guestId);
    const [persistedSession] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.sid, authenticatedSessionId));
    expect((persistedSession?.sess as { userId?: string }).userId).toBe(
      customer[0]!.id,
    );
    expect(persistedSession?.expire.getTime()).toBeGreaterThan(Date.now());
    expect((await agent.get("/api/v1/auth/me")).body.data.user.email).toBe(
      fixtureEmails.customer,
    );

    const logout = await agent
      .post("/api/v1/auth/logout")
      .set(csrfHeaders(successfulLogin.body.data.csrfToken))
      .send({});
    expect(logout.status).toBe(204);
    expect(
      await db
        .select()
        .from(sessions)
        .where(eq(sessions.sid, authenticatedSessionId)),
    ).toHaveLength(0);
    expect((await agent.get("/api/v1/auth/me")).status).toBe(401);

    const resetRequest = await postWithCsrf(
      agent,
      "/api/v1/auth/forgot-password",
      { email: fixtureEmails.customer },
    );
    expect(resetRequest.status).toBe(202);
    const resetToken = await developmentEmailToken(
      agent,
      fixtureEmails.customer,
      "password_reset",
    );
    const [resetRecord] = await db
      .select()
      .from(accountTokens)
      .where(eq(accountTokens.tokenHash, hashToken(resetToken)))
      .limit(1);
    expect(resetRecord?.tokenHash).not.toBe(resetToken);
    expect(resetRecord?.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(resetRecord?.expiresAt.getTime()).toBeLessThanOrEqual(
      Date.now() + 30 * 60 * 1000 + 1_000,
    );

    const resetSession = request.agent(app);
    const resetLogin = await login(
      resetSession,
      fixtureEmails.customer,
      password,
    );
    expect(resetLogin.status).toBe(200);
    const resetSessionId = responseSessionId(resetLogin);
    const resetResult = await postWithCsrf(
      agent,
      "/api/v1/auth/reset-password",
      { token: resetToken, password: "changed-password-123" },
    );
    expect(resetResult.status).toBe(200);
    expect(
      await db.select().from(sessions).where(eq(sessions.sid, resetSessionId)),
    ).toHaveLength(0);
    const reusedReset = await postWithCsrf(
      agent,
      "/api/v1/auth/reset-password",
      { token: resetToken, password: "another-password-123" },
    );
    expect(reusedReset.body.data).toEqual(resetResult.body.data);
    expect(
      (await login(request.agent(app), fixtureEmails.customer, password))
        .status,
    ).toBe(401);
    expect(
      (
        await login(
          request.agent(app),
          fixtureEmails.customer,
          "changed-password-123",
        )
      ).status,
    ).toBe(200);
    const expiryAgent = request.agent(app);
    const expiryLogin = await login(
      expiryAgent,
      fixtureEmails.customer,
      "changed-password-123",
    );
    expect(expiryLogin.status).toBe(200);
    const expirySessionId = responseSessionId(expiryLogin);
    await db
      .update(sessions)
      .set({ expire: new Date(Date.now() - 1_000) })
      .where(eq(sessions.sid, expirySessionId));
    expect((await expiryAgent.get("/api/v1/auth/me")).status).toBe(401);

    const expiredAgent = request.agent(app);
    await registerAndVerify(expiredAgent, fixtureEmails.expired, password);
    const expiredResetRequest = await postWithCsrf(
      expiredAgent,
      "/api/v1/auth/forgot-password",
      { email: fixtureEmails.expired },
    );
    expect(expiredResetRequest.status).toBe(202);
    const expiredToken = await developmentEmailToken(
      expiredAgent,
      fixtureEmails.expired,
      "password_reset",
    );
    await db
      .update(accountTokens)
      .set({ expiresAt: new Date(Date.now() - 1_000) })
      .where(eq(accountTokens.tokenHash, hashToken(expiredToken)));
    const expiredReset = await postWithCsrf(
      expiredAgent,
      "/api/v1/auth/reset-password",
      { token: expiredToken, password: "expired-password-123" },
    );
    expect(expiredReset.status).toBe(200);
    expect(
      (await login(request.agent(app), fixtureEmails.expired, password)).status,
    ).toBe(200);

    const expiredVerificationAgent = request.agent(app);
    const expiredRegistration = await postWithCsrf(
      expiredVerificationAgent,
      "/api/v1/auth/register",
      {
        email: fixtureEmails.expiredVerification,
        password,
      },
    );
    expect(expiredRegistration.status).toBe(202);
    const expiredVerificationToken = await developmentEmailToken(
      expiredVerificationAgent,
      fixtureEmails.expiredVerification,
      "email_verification",
    );
    await db
      .update(accountTokens)
      .set({ expiresAt: new Date(Date.now() - 1_000) })
      .where(eq(accountTokens.tokenHash, hashToken(expiredVerificationToken)));
    const expiredVerification = await postWithCsrf(
      expiredVerificationAgent,
      "/api/v1/auth/verify-email",
      { token: expiredVerificationToken },
    );
    expect(expiredVerification.status).toBe(200);
    const [unverifiedUser] = await db
      .select({ emailVerifiedAt: users.emailVerifiedAt })
      .from(users)
      .where(eq(users.email, fixtureEmails.expiredVerification));
    expect(unverifiedUser?.emailVerifiedAt).toBeNull();

    const targetAgent = request.agent(app);
    await registerAndVerify(targetAgent, fixtureEmails.target, password);
    const targetLogin = await login(
      targetAgent,
      fixtureEmails.target,
      password,
    );
    expect(targetLogin.status).toBe(200);
    const target = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, fixtureEmails.target))
      .limit(1);
    const unauthenticatedAdmin = await request(app)
      .post(`/api/v1/admin/users/${target[0]!.id}/suspend`)
      .send({});
    expect(unauthenticatedAdmin.status).toBe(401);
    const customerAdminAttempt = await targetAgent
      .post(`/api/v1/admin/users/${customer[0]!.id}/suspend`)
      .set(csrfHeaders(targetLogin.body.data.csrfToken))
      .send({});
    expect(customerAdminAttempt.status).toBe(403);

    const adminAgent = request.agent(app);
    await registerAndVerify(adminAgent, fixtureEmails.admin, password);
    const [adminUser] = await db
      .select()
      .from(users)
      .where(eq(users.email, fixtureEmails.admin))
      .limit(1);
    await db
      .update(users)
      .set({ role: "admin" })
      .where(eq(users.id, adminUser!.id));
    const adminLogin = await login(adminAgent, fixtureEmails.admin, password);
    expect(adminLogin.status).toBe(200);
    const adminAction = await adminAgent
      .post(`/api/v1/admin/users/${target[0]!.id}/suspend`)
      .set(csrfHeaders(adminLogin.body.data.csrfToken))
      .send({});
    expect(adminAction.status).toBe(200);
    expect(
      await db
        .select()
        .from(adminAuditLogs)
        .where(
          and(
            eq(adminAuditLogs.actorUserId, adminUser!.id),
            eq(adminAuditLogs.targetUserId, target[0]!.id),
            eq(adminAuditLogs.action, "suspend_user"),
          ),
        ),
    ).toHaveLength(1);
    expect((await targetAgent.get("/api/v1/auth/me")).status).toBe(401);

    expect((await targetAgent.get("/api/v1/auth/me")).status).toBe(401);
  });

  it("shares PostgreSQL rate counters across store instances", async () => {
    const first = new PostgresRateLimitStore(
      pool,
      `${fixturePrefix}:shared`,
      60_000,
    );
    const second = new PostgresRateLimitStore(
      pool,
      `${fixturePrefix}:shared`,
      60_000,
    );
    const firstCount = await first.increment("test-client");
    const secondCount = await second.increment("test-client");
    expect(firstCount.totalHits).toBe(1);
    expect(secondCount.totalHits).toBe(2);
    await first.clear();
    await second.clear();
    await first.shutdown();
    await second.shutdown();
  });
});
