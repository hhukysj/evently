import { randomUUID } from "node:crypto";
import request from "supertest";
import session from "express-session";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../app.js";
import {
  DevelopmentEmailDelivery,
  type DevelopmentEmailInbox,
  type EmailDeliveryProvider,
  type PasswordResetEmail,
  UnconfiguredEmailDelivery,
  type VerificationEmail,
} from "./email-delivery.js";
import type {
  AccountTokenType,
  AuthUser,
  UserRepository,
} from "./repository.js";
import { PasswordAuthService, type AuthService, hashToken } from "./service.js";
import { sessionLifetimeMs } from "../../middleware/sessions.js";

const APP_ORIGIN = "http://127.0.0.1:5173";
const SESSION_SECRET = "test-only-session-secret-at-least-32-characters";
const PASSWORD = "a-safe-test-password";

class InMemoryUserRepository implements UserRepository {
  readonly audit: Array<{ actor: string; target: string }> = [];
  private readonly users = new Map<string, AuthUser>();
  private readonly tokens = new Map<
    string,
    {
      userId: string;
      type: AccountTokenType;
      expiresAt: Date;
      consumed: boolean;
    }
  >();

  async findByEmail(email: string): Promise<AuthUser | undefined> {
    return [...this.users.values()].find((user) => user.email === email);
  }

  async findById(id: string): Promise<AuthUser | undefined> {
    return this.users.get(id);
  }

  async createCustomer(email: string, passwordHash: string): Promise<AuthUser> {
    if (await this.findByEmail(email)) {
      throw Object.assign(new Error("Unique constraint failed"), {
        code: "23505",
        constraint: "users_email_unique",
      });
    }
    const user: AuthUser = {
      id: randomUUID(),
      email,
      passwordHash,
      role: "customer",
      authVersion: 0,
      status: "active",
      emailVerifiedAt: null,
      createdAt: new Date(),
    };
    this.users.set(user.id, user);
    return user;
  }

  async createAccountToken(
    userId: string,
    type: AccountTokenType,
    tokenHash: string,
    expiresAt: Date,
  ): Promise<void> {
    for (const token of this.tokens.values()) {
      if (token.userId === userId && token.type === type && !token.consumed) {
        token.consumed = true;
      }
    }
    this.tokens.set(tokenHash, {
      userId,
      type,
      expiresAt,
      consumed: false,
    });
  }

  async verifyEmail(tokenHash: string, now: Date): Promise<boolean> {
    const token = this.tokens.get(tokenHash);
    const user = token ? this.users.get(token.userId) : undefined;
    if (
      !token ||
      token.type !== "email_verification" ||
      token.consumed ||
      token.expiresAt <= now ||
      !user ||
      user.status !== "active" ||
      user.emailVerifiedAt
    ) {
      return false;
    }
    token.consumed = true;
    user.emailVerifiedAt = now;
    return true;
  }

  async resetPassword(
    tokenHash: string,
    passwordHash: string,
    now: Date,
  ): Promise<boolean> {
    const token = this.tokens.get(tokenHash);
    const user = token ? this.users.get(token.userId) : undefined;
    if (
      !token ||
      token.type !== "password_reset" ||
      token.consumed ||
      token.expiresAt <= now ||
      !user ||
      user.status !== "active" ||
      !user.emailVerifiedAt
    ) {
      return false;
    }
    token.consumed = true;
    user.passwordHash = passwordHash;
    user.authVersion += 1;
    return true;
  }

  async suspendUser(
    actorUserId: string,
    targetUserId: string,
  ): Promise<"suspended" | "already_inactive" | "missing" | "self"> {
    if (actorUserId === targetUserId) {
      return "self";
    }
    const target = this.users.get(targetUserId);
    if (!target) {
      return "missing";
    }
    if (target.status !== "active") {
      return "already_inactive";
    }
    target.status = "suspended";
    target.authVersion += 1;
    this.audit.push({ actor: actorUserId, target: targetUserId });
    return "suspended";
  }

  setRole(userId: string, role: AuthUser["role"]): void {
    const user = this.users.get(userId);
    if (user) {
      user.role = role;
    }
  }
}

class TestEmailDelivery implements EmailDeliveryProvider {
  readonly configured = true;
  readonly verificationEmails: VerificationEmail[] = [];
  readonly resetEmails: PasswordResetEmail[] = [];

  async sendVerificationEmail(message: VerificationEmail): Promise<void> {
    this.verificationEmails.push(message);
  }

  async sendPasswordResetEmail(message: PasswordResetEmail): Promise<void> {
    this.resetEmails.push(message);
  }
}

function makeApp(
  options: {
    environment?: "development" | "test" | "production";
    secureCookies?: boolean;
    service?: AuthService;
    trustProxyHops?: number;
    emailDelivery?: EmailDeliveryProvider;
    developmentEmailInbox?: DevelopmentEmailInbox;
  } = {},
) {
  const store = new session.MemoryStore();
  const repository = new InMemoryUserRepository();
  const testEmailDelivery = new TestEmailDelivery();
  const emailDelivery = options.emailDelivery ?? testEmailDelivery;
  const service =
    options.service ?? new PasswordAuthService(repository, emailDelivery);
  const app = createApp(
    { query: vi.fn().mockResolvedValue({ rows: [{ "?column?": 1 }] }) },
    {
      service,
      environment: options.environment ?? "test",
      ...(options.developmentEmailInbox
        ? { developmentEmailInbox: options.developmentEmailInbox }
        : {}),
      sessionStore: store,
      sessionSecret: SESSION_SECRET,
      appOrigin: APP_ORIGIN,
      secureCookies: options.secureCookies ?? false,
      cookieName: options.secureCookies ? "__Host-evently.sid" : "evently.sid",
      trustProxyHops: options.trustProxyHops ?? 0,
    },
  );
  return { app, emailDelivery: testEmailDelivery, repository, service, store };
}

async function getCsrfToken(agent: ReturnType<typeof request.agent>) {
  const response = await agent.get("/api/v1/auth/csrf");
  expect(response.status).toBe(200);
  expect(response.body.data.csrfToken).toEqual(expect.any(String));
  return response.body.data.csrfToken as string;
}

function csrfHeaders(token: string) {
  return {
    Origin: APP_ORIGIN,
    "X-CSRF-Token": token,
  };
}

function setCookies(response: request.Response): string[] {
  const header = response.headers["set-cookie"];
  return Array.isArray(header) ? header : header ? [header] : [];
}

async function verifyEmail(
  agent: ReturnType<typeof request.agent>,
  token: string,
) {
  const csrfToken = await getCsrfToken(agent);
  return agent
    .post("/api/v1/auth/verify-email")
    .set(csrfHeaders(csrfToken))
    .send({ token });
}

async function postWithCsrf(
  agent: ReturnType<typeof request.agent>,
  path: string,
  body: Record<string, unknown>,
) {
  const token = await getCsrfToken(agent);
  return agent.post(path).set(csrfHeaders(token)).send(body);
}

describe("authentication routes", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers an unverified customer with a hashed password and verification token", async () => {
    const { app, emailDelivery, repository } = makeApp();
    const agent = request.agent(app);
    const csrfToken = await getCsrfToken(agent);
    const response = await agent
      .post("/api/v1/auth/register")
      .set(csrfHeaders(csrfToken))
      .send({ email: "  CUSTOMER@EXAMPLE.COM ", password: PASSWORD });

    expect(response.status).toBe(202);
    expect(response.body.data.message).toContain("configured channel");
    expect(response.headers["cache-control"]).toBe("no-store");
    const storedUser = await repository.findByEmail("customer@example.com");
    expect(storedUser?.passwordHash).not.toBe(PASSWORD);
    expect(storedUser?.passwordHash).toMatch(
      /^\$argon2id\$v=19\$m=19456,p=1,t=2\$/,
    );
    expect(storedUser?.emailVerifiedAt).toBeNull();
    expect(emailDelivery.verificationEmails).toHaveLength(1);
    expect(response.body.data.user).toBeUndefined();

    const unauthenticated = await postWithCsrf(agent, "/api/v1/auth/login", {
      email: "customer@example.com",
      password: PASSWORD,
    });
    expect(unauthenticated.status).toBe(401);

    const rawToken = emailDelivery.verificationEmails[0]!.token;
    expect(rawToken).toHaveLength(43);
    expect(await verifyEmail(agent, rawToken)).toMatchObject({ status: 200 });
    expect(await verifyEmail(agent, rawToken)).toMatchObject({ status: 200 });
    expect(await repository.findByEmail("customer@example.com")).toMatchObject({
      emailVerifiedAt: expect.any(Date),
    });
  });

  it("parses URL-encoded form bodies for API requests", async () => {
    const { app, repository } = makeApp();
    const agent = request.agent(app);
    const csrfToken = await getCsrfToken(agent);
    const response = await agent
      .post("/api/v1/auth/register")
      .set(csrfHeaders(csrfToken))
      .type("form")
      .send({ email: "form@example.com", password: PASSWORD });

    expect(response.status).toBe(202);
    expect(await repository.findByEmail("form@example.com")).toMatchObject({
      email: "form@example.com",
      passwordHash: expect.stringMatching(/^\$argon2id\$/),
    });
  });

  it("uses the same status and response for duplicate and new registrations", async () => {
    const { app } = makeApp();
    const firstAgent = request.agent(app);
    const firstToken = await getCsrfToken(firstAgent);
    const first = await firstAgent
      .post("/api/v1/auth/register")
      .set(csrfHeaders(firstToken))
      .send({ email: "duplicate@example.com", password: PASSWORD });
    const secondAgent = request.agent(app);
    const secondToken = await getCsrfToken(secondAgent);
    const duplicate = await secondAgent
      .post("/api/v1/auth/register")
      .set(csrfHeaders(secondToken))
      .send({ email: "DUPLICATE@example.com", password: PASSWORD });

    expect(first.status).toBe(202);
    expect(duplicate.status).toBe(first.status);
    expect(duplicate.body.data).toEqual(first.body.data);
  });

  it("makes local account messages available only through the development inbox", async () => {
    const localEmail = new DevelopmentEmailDelivery("development");
    const { app } = makeApp({
      environment: "development",
      emailDelivery: localEmail,
      developmentEmailInbox: localEmail,
    });
    const agent = request.agent(app);
    const registration = await postWithCsrf(agent, "/api/v1/auth/register", {
      email: "local-inbox@example.com",
      password: PASSWORD,
    });
    const rawToken = localEmail.listMessages()[0]?.token;

    expect(registration.status).toBe(202);
    expect(JSON.stringify(registration.body)).not.toContain(rawToken);
    const inbox = await request(app).get("/api/v1/dev/email-inbox");
    expect(inbox.status).toBe(200);
    expect(inbox.headers["cache-control"]).toBe("no-store");
    expect(inbox.body.data.messages[0]).toMatchObject({
      type: "email_verification",
      email: "local-inbox@example.com",
      token: rawToken,
    });
    expect(() => new DevelopmentEmailDelivery("production")).toThrow(
      "Development email delivery is only available locally",
    );

    const productionApp = makeApp({
      environment: "production",
      developmentEmailInbox: localEmail,
    }).app;
    expect(
      (await request(productionApp).get("/api/v1/dev/email-inbox")).status,
    ).toBe(404);
  });

  it("keeps account email unavailable without a provider and returns no token", async () => {
    const { app } = makeApp({
      environment: "production",
      emailDelivery: new UnconfiguredEmailDelivery(),
    });
    const agent = request.agent(app);
    const registration = await postWithCsrf(agent, "/api/v1/auth/register", {
      email: "no-provider@example.com",
      password: PASSWORD,
    });
    const reset = await postWithCsrf(agent, "/api/v1/auth/forgot-password", {
      email: "no-provider@example.com",
    });

    expect(registration.status).toBe(503);
    expect(registration.body.error.code).toBe("EMAIL_DELIVERY_UNAVAILABLE");
    expect(reset.status).toBe(503);
    expect(reset.body.error.code).toBe("EMAIL_DELIVERY_UNAVAILABLE");
    expect(JSON.stringify(registration.body)).not.toMatch(/[A-Za-z0-9_-]{43}/);
    expect(JSON.stringify(reset.body)).not.toMatch(/[A-Za-z0-9_-]{43}/);
  });

  it("rejects invalid registration and client-supplied roles", async () => {
    const { app } = makeApp();
    const agent = request.agent(app);
    const csrfToken = await getCsrfToken(agent);
    const invalid = await agent
      .post("/api/v1/auth/register")
      .set(csrfHeaders(csrfToken))
      .send({ email: "invalid", password: PASSWORD });
    const escalation = await agent
      .post("/api/v1/auth/register")
      .set(csrfHeaders(csrfToken))
      .send({
        email: "admin@example.com",
        password: PASSWORD,
        role: "admin",
      });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error).toMatchObject({
      code: "INVALID_REGISTRATION",
      message: "Unable to register with these details",
    });
    expect(invalid.body.error.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(escalation.status).toBe(400);
    expect(escalation.body.error).toMatchObject({
      code: "INVALID_REGISTRATION",
      message: "Unable to register with these details",
    });
  });

  it("authenticates only verified users and keeps invalid-login errors generic", async () => {
    const { app, emailDelivery } = makeApp();
    const agent = request.agent(app);
    const registrationToken = await getCsrfToken(agent);
    await agent
      .post("/api/v1/auth/register")
      .set(csrfHeaders(registrationToken))
      .send({ email: "login@example.com", password: PASSWORD });
    await verifyEmail(agent, emailDelivery.verificationEmails[0]!.token);

    const loginToken = await getCsrfToken(agent);
    const successfulLogin = await agent
      .post("/api/v1/auth/login")
      .set(csrfHeaders(loginToken))
      .send({ email: "LOGIN@example.com", password: PASSWORD });
    const wrongPassword = await postWithCsrf(agent, "/api/v1/auth/login", {
      email: "login@example.com",
      password: "wrong-password",
    });
    const unknownEmail = await postWithCsrf(agent, "/api/v1/auth/login", {
      email: "missing@example.com",
      password: "wrong-password",
    });

    expect(successfulLogin.status).toBe(200);
    expect(successfulLogin.body.data.user.email).toBe("login@example.com");
    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(wrongPassword.body.error.message).toBe(
      unknownEmail.body.error.message,
    );
    expect(wrongPassword.body.error.code).toBe(unknownEmail.body.error.code);
  });

  it("returns neutral account-email responses and consumes reset tokens once", async () => {
    const { app, emailDelivery } = makeApp();
    const agent = request.agent(app);
    const registrationToken = await getCsrfToken(agent);
    await agent
      .post("/api/v1/auth/register")
      .set(csrfHeaders(registrationToken))
      .send({ email: "reset@example.com", password: PASSWORD });
    await verifyEmail(agent, emailDelivery.verificationEmails[0]!.token);

    const resetRequest = async (email: string) =>
      postWithCsrf(agent, "/api/v1/auth/forgot-password", { email });
    const knownResponse = await resetRequest("reset@example.com");
    const unknownResponse = await resetRequest("unknown@example.com");
    expect(knownResponse.status).toBe(202);
    expect(unknownResponse.status).toBe(202);
    expect(knownResponse.body.data).toEqual(unknownResponse.body.data);
    const deliveredToken = emailDelivery.resetEmails[0]!.token;

    const reset = await postWithCsrf(agent, "/api/v1/auth/reset-password", {
      token: deliveredToken,
      password: "a-new-safe-password",
    });
    const reused = await postWithCsrf(agent, "/api/v1/auth/reset-password", {
      token: deliveredToken,
      password: "another-new-password",
    });
    expect(reset.status).toBe(200);
    expect(reused.body.data).toEqual(reset.body.data);

    const oldPassword = await postWithCsrf(agent, "/api/v1/auth/login", {
      email: "reset@example.com",
      password: PASSWORD,
    });
    const newPassword = await postWithCsrf(agent, "/api/v1/auth/login", {
      email: "reset@example.com",
      password: "a-new-safe-password",
    });
    expect(oldPassword.status).toBe(401);
    expect(newPassword.status).toBe(200);
  });

  it("requires authentication and admin role for account actions", async () => {
    const { app, emailDelivery, repository } = makeApp();
    const unauthenticated = await request(app)
      .post(`/api/v1/admin/users/${randomUUID()}/suspend`)
      .send({});
    expect(unauthenticated.status).toBe(401);

    const customer = request.agent(app);
    await postWithCsrf(customer, "/api/v1/auth/register", {
      email: "customer-admin-test@example.com",
      password: PASSWORD,
    });
    const customerUser = await repository.findByEmail(
      "customer-admin-test@example.com",
    );
    await verifyEmail(customer, emailDelivery.verificationEmails[0]!.token);
    const loggedIn = await postWithCsrf(customer, "/api/v1/auth/login", {
      email: "customer-admin-test@example.com",
      password: PASSWORD,
    });
    const forbidden = await customer
      .post(`/api/v1/admin/users/${randomUUID()}/suspend`)
      .set(csrfHeaders(loggedIn.body.data.csrfToken))
      .send({});
    expect(forbidden.status).toBe(403);

    const admin = request.agent(app);
    await postWithCsrf(admin, "/api/v1/auth/register", {
      email: "admin-test@example.com",
      password: PASSWORD,
    });
    const adminUser = await repository.findByEmail("admin-test@example.com");
    expect(adminUser).toBeDefined();
    await verifyEmail(admin, emailDelivery.verificationEmails[1]!.token);
    const adminAccount = await repository.findByEmail("admin-test@example.com");
    expect(adminAccount).toBeDefined();
    repository.setRole(adminAccount!.id, "admin");
    const adminLogin = await postWithCsrf(admin, "/api/v1/auth/login", {
      email: adminAccount!.email,
      password: PASSWORD,
    });
    expect(adminLogin.status).toBe(200);
    const suspended = await admin
      .post(`/api/v1/admin/users/${customerUser!.id}/suspend`)
      .set(csrfHeaders(adminLogin.body.data.csrfToken))
      .send({});
    expect(suspended.status).toBe(200);
    expect(repository.audit).toEqual([
      { actor: adminAccount!.id, target: customerUser!.id },
    ]);
    expect((await customer.get("/api/v1/auth/me")).status).toBe(401);
    expect(adminAccount!.role).toBe("admin");
    expect(repository.audit).toHaveLength(1);
  });

  it("rejects unsafe cross-origin requests and missing CSRF tokens", async () => {
    const { app } = makeApp();
    const agent = request.agent(app);
    const token = await getCsrfToken(agent);
    const missing = await agent
      .post("/api/v1/auth/login")
      .set("Origin", APP_ORIGIN)
      .send({ email: "x@example.com", password: PASSWORD });
    const foreign = await agent
      .post("/api/v1/auth/login")
      .set({ Origin: "https://attacker.example", "X-CSRF-Token": token })
      .send({ email: "x@example.com", password: PASSWORD });
    expect(missing.status).toBe(403);
    expect(foreign.status).toBe(403);
  });

  it("rotates sessions at login and invalidates the session at logout", async () => {
    const { app, emailDelivery, store } = makeApp();
    const agent = request.agent(app);
    await postWithCsrf(agent, "/api/v1/auth/register", {
      email: "session@example.com",
      password: PASSWORD,
    });
    await verifyEmail(agent, emailDelivery.verificationEmails[0]!.token);
    const beforeLogin = setCookies(await agent.get("/api/v1/auth/csrf"))[0]!;
    const beforeId = decodeURIComponent(
      beforeLogin.split(";")[0]!.split("=")[1]!,
    )
      .slice(2)
      .split(".")[0];
    const login = await postWithCsrf(agent, "/api/v1/auth/login", {
      email: "session@example.com",
      password: PASSWORD,
    });
    expect(login.status).toBe(200);

    const sessions = await new Promise<string[]>((resolve, reject) => {
      store.all((error, allSessions) => {
        if (error) {
          reject(error);
        } else {
          resolve(Object.keys(allSessions ?? {}));
        }
      });
    });
    expect(sessions).toHaveLength(1);
    expect(beforeId).not.toBe(sessions[0]);
    const logout = await agent
      .post("/api/v1/auth/logout")
      .set(csrfHeaders(login.body.data.csrfToken))
      .send({});
    expect(logout.status).toBe(204);
    expect((await agent.get("/api/v1/auth/me")).status).toBe(401);
  });

  it("sets secure production cookie attributes", async () => {
    const { app } = makeApp({
      environment: "production",
      secureCookies: true,
      trustProxyHops: 1,
    });
    const response = await request(app)
      .get("/api/v1/auth/csrf")
      .set("X-Forwarded-Proto", "https");
    expect(response.status).toBe(200);
    const cookie = setCookies(response).join("; ");
    expect(cookie).toContain("__Host-evently.sid=");
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Secure");
    expect(cookie).not.toContain("Domain=");
    expect(sessionLifetimeMs()).toBe(8 * 60 * 60 * 1000);
  });

  it("blocks authentication attempts after the configured rate limit", async () => {
    const { app } = makeApp();
    const agent = request.agent(app);
    const csrfToken = await getCsrfToken(agent);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await agent
        .post("/api/v1/auth/register")
        .set(csrfHeaders(csrfToken))
        .send({ email: "not-an-email" });
      expect(response.status).toBe(400);
    }
    const limited = await agent
      .post("/api/v1/auth/register")
      .set(csrfHeaders(csrfToken))
      .send({ email: "not-an-email" });
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe("AUTH_RATE_LIMITED");
  });

  it("stores only a hash of the delivered verification token", async () => {
    const { app, emailDelivery, repository } = makeApp();
    const agent = request.agent(app);
    await postWithCsrf(agent, "/api/v1/auth/register", {
      email: "hash@example.com",
      password: PASSWORD,
    });
    const token = emailDelivery.verificationEmails[0]!.token;
    expect(token).not.toBe(hashToken(token));
    expect(
      (await repository.findByEmail("hash@example.com"))?.emailVerifiedAt,
    ).toBeNull();
  });
});
