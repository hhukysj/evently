import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray, like, or, sql } from "drizzle-orm";
import { createApp } from "../../app.js";
import { env } from "../../config/env.js";
import { db, pool } from "../../db/client.js";
import {
  accountTokens,
  adminAuditLogs,
  professionalProfiles,
  professionalProfileTypes,
  providerApplications,
  sessions,
  users,
} from "../../db/schema.js";
import { PostgresRateLimitStore } from "../../middleware/postgres-rate-limit-store.js";
import { createPostgresSessionStore } from "../../middleware/sessions.js";
import {
  DevelopmentEmailDelivery,
  type DevelopmentEmailMessage,
} from "../auth/email-delivery.js";
import { PostgresUserRepository } from "../auth/repository.js";
import { PasswordAuthService, hashToken } from "../auth/service.js";
import { PostgresProviderRepository } from "./repository.js";
import { MarketplaceProviderService } from "./service.js";

const fixturePrefix = `provider-it-${randomUUID()}`;
const trackedSessionIds = new Set<string>();
const rateLimitStores: PostgresRateLimitStore[] = [];
const sessionStore = createPostgresSessionStore(pool);
const emailProvider = new DevelopmentEmailDelivery("development");
const app = createApp(pool, {
  service: new PasswordAuthService(
    new PostgresUserRepository(db),
    emailProvider,
  ),
  providerService: new MarketplaceProviderService(
    new PostgresProviderRepository(db),
  ),
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
const password = "provider-integration-password";
const applicationInput = {
  displayName: "  Collision Studio ",
  description:
    "We plan and coordinate community events with local creative partners.",
  city: " Pune ",
  region: "Maharashtra",
  country: "India",
  providerTypes: ["event_organizer", "event_manager"],
};

function email(name: string): string {
  return `${fixturePrefix}-${name}@example.test`;
}

function csrfHeaders(token: string) {
  return { Origin: env.APP_ORIGIN, "X-CSRF-Token": token };
}

function trackSession(response: request.Response): void {
  const header = response.headers["set-cookie"];
  const cookies = Array.isArray(header) ? header : header ? [header] : [];
  for (const cookie of cookies) {
    const value = cookie.split(";")[0]?.split("=")[1];
    if (!value) {
      continue;
    }
    const decoded = decodeURIComponent(value);
    const sessionId = decoded.startsWith("s:")
      ? decoded.slice(2).split(".")[0]
      : undefined;
    if (sessionId) {
      trackedSessionIds.add(sessionId);
    }
  }
}

function responseSessionId(response: request.Response): string {
  const header = response.headers["set-cookie"];
  const cookies = Array.isArray(header) ? header : header ? [header] : [];
  const value = cookies[0]?.split(";")[0]?.split("=")[1];
  if (!value) {
    throw new Error("Expected a session cookie in the test response");
  }
  const decoded = decodeURIComponent(value);
  if (!decoded.startsWith("s:")) {
    throw new Error("Test session cookie did not contain a signed ID");
  }
  return decoded.slice(2).split(".")[0] ?? "";
}

async function getCsrf(agent: ReturnType<typeof request.agent>) {
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
  const token = await getCsrf(agent);
  const response = await agent.post(path).set(csrfHeaders(token)).send(body);
  trackSession(response);
  return response;
}

async function developmentEmailToken(
  agent: ReturnType<typeof request.agent>,
  address: string,
  type: DevelopmentEmailMessage["type"],
): Promise<string> {
  const inbox = await agent.get("/api/v1/dev/email-inbox");
  expect(inbox.status).toBe(200);
  const message = (inbox.body.data.messages as DevelopmentEmailMessage[]).find(
    (item) => item.email === address && item.type === type,
  );
  if (!message) {
    throw new Error("Expected a matching local verification message");
  }
  return message.token;
}

async function createVerifiedUser(
  name: string,
  role: "customer" | "admin" = "customer",
) {
  const agent = request.agent(app);
  const address = email(name);
  const registration = await postWithCsrf(agent, "/api/v1/auth/register", {
    email: address,
    password,
  });
  expect(registration.status).toBe(202);
  const token = await developmentEmailToken(
    agent,
    address,
    "email_verification",
  );
  const [storedToken] = await db
    .select({ tokenHash: accountTokens.tokenHash })
    .from(accountTokens)
    .where(eq(accountTokens.tokenHash, hashToken(token)));
  expect(storedToken?.tokenHash).toBe(hashToken(token));
  const verify = await postWithCsrf(agent, "/api/v1/auth/verify-email", {
    token,
  });
  expect(verify.status).toBe(200);
  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, address));
  if (!user) {
    throw new Error("Registered fixture user was not persisted");
  }
  if (role === "admin") {
    await db.update(users).set({ role }).where(eq(users.id, user.id));
  }
  return { address, agent, userId: user.id };
}

async function loginAgent(
  agent: ReturnType<typeof request.agent>,
  address: string,
) {
  const response = await postWithCsrf(agent, "/api/v1/auth/login", {
    email: address,
    password,
  });
  expect(response.status).toBe(200);
  return response;
}

async function submitApplication(
  agent: ReturnType<typeof request.agent>,
  input: Record<string, unknown> = applicationInput,
) {
  return postWithCsrf(agent, "/api/v1/provider-applications", input);
}

async function makeCollisionSlug(userId: string): Promise<string> {
  return `collision-studio-${userId}`;
}

beforeAll(async () => {
  await pool.query("SELECT 1");
});

afterAll(async () => {
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
    await db
      .delete(providerApplications)
      .where(
        or(
          inArray(providerApplications.userId, fixtureUserIds),
          inArray(providerApplications.reviewerUserId, fixtureUserIds),
        ),
      );
    await db.delete(users).where(inArray(users.id, fixtureUserIds));
  }
  for (const id of trackedSessionIds) {
    await new Promise<void>((resolve, reject) => {
      sessionStore.destroy(id, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
  for (const store of rateLimitStores) {
    await store.clear();
    await store.shutdown();
  }
  sessionStore.close();
  await pool.end();
});

afterEach(async () => {
  for (const store of rateLimitStores) {
    await store.clear();
  }
});

describe("PostgreSQL provider onboarding integration", () => {
  it("submits, tracks, reviews, promotes, creates an owned draft profile, and rotates sessions", async () => {
    const anonymousAgent = request.agent(app);
    const applicant = await createVerifiedUser("approval-applicant");
    const secondApplicant = await createVerifiedUser("other-applicant");
    const admin = await createVerifiedUser("approval-admin", "admin");
    const applicantLogin = await loginAgent(applicant.agent, applicant.address);
    await loginAgent(secondApplicant.agent, secondApplicant.address);
    const oldSessionId = responseSessionId(applicantLogin);
    const [persistedSession] = await db
      .select({ sess: sessions.sess })
      .from(sessions)
      .where(eq(sessions.sid, oldSessionId));
    expect(
      (persistedSession?.sess as { authVersion?: number }).authVersion,
    ).toBe(0);

    const unauthenticated = await anonymousAgent
      .post("/api/v1/provider-applications")
      .send(applicationInput);
    expect(unauthenticated.status).toBe(401);

    const unverified = await createVerifiedUser("unverified");
    await loginAgent(unverified.agent, unverified.address);
    await db
      .update(users)
      .set({ emailVerifiedAt: null })
      .where(eq(users.id, unverified.userId));
    expect((await submitApplication(unverified.agent)).status).toBe(403);

    const application = await submitApplication(applicant.agent);
    expect(application.status).toBe(201);
    expect(application.body.data.status).toBe("pending");
    expect((await submitApplication(applicant.agent)).status).toBe(409);
    expect(
      (
        await submitApplication(applicant.agent, {
          ...applicationInput,
          role: "professional",
          userId: secondApplicant.userId,
        } as Record<string, unknown>)
      ).status,
    ).toBe(400);
    const ownApplication = await applicant.agent.get(
      "/api/v1/provider-applications/me",
    );
    expect(ownApplication.status).toBe(200);
    expect(ownApplication.body.data.application).toMatchObject({
      displayName: "Collision Studio",
      city: "Pune",
      status: "pending",
      providerTypes: ["event_organizer", "event_manager"],
    });
    expect(ownApplication.body.data.application).not.toHaveProperty(
      "rejectionReason",
    );
    expect(
      (await secondApplicant.agent.get("/api/v1/provider-applications/me"))
        .status,
    ).toBe(200);
    expect(
      (await secondApplicant.agent.get("/api/v1/provider-applications/me")).body
        .data.application,
    ).toBeNull();
    expect(
      (await secondApplicant.agent.get("/api/v1/professional/me")).status,
    ).toBe(403);

    expect(
      (await applicant.agent.get("/api/v1/admin/provider-applications")).status,
    ).toBe(403);
    expect(
      (await anonymousAgent.get("/api/v1/admin/provider-applications")).status,
    ).toBe(401);
    const adminLogin = await loginAgent(admin.agent, admin.address);
    expect(
      (await admin.agent.get("/api/v1/admin/provider-applications?page=1001"))
        .status,
    ).toBe(400);
    const listed = await admin.agent.get(
      "/api/v1/admin/provider-applications?status=pending&page=1&pageSize=10",
    );
    expect(listed.status).toBe(200);
    expect(listed.body.data.pagination).toMatchObject({
      page: 1,
      pageSize: 10,
    });
    const applicationId = listed.body.data.applications.find(
      (item: { applicant: { id: string } }) =>
        item.applicant.id === applicant.userId,
    )?.id as string | undefined;
    expect(applicationId).toBeTruthy();
    const adminDetail = await admin.agent.get(
      `/api/v1/admin/provider-applications/${applicationId}`,
    );
    expect(adminDetail.status).toBe(200);
    expect(adminDetail.body.data.application.applicant.email).toBe(
      applicant.address,
    );
    expect(adminDetail.body.data.application).not.toHaveProperty(
      "passwordHash",
    );

    const missingCsrf = await admin.agent
      .post(`/api/v1/admin/provider-applications/${applicationId}/approve`)
      .send({});
    expect(missingCsrf.status).toBe(403);
    const forgedApproval = await admin.agent
      .post(`/api/v1/admin/provider-applications/${applicationId}/approve`)
      .set(csrfHeaders(adminLogin.body.data.csrfToken))
      .send({ role: "admin", userId: applicant.userId });
    expect(forgedApproval.status).toBe(400);
    const approval = await admin.agent
      .post(`/api/v1/admin/provider-applications/${applicationId}/approve`)
      .set(csrfHeaders(adminLogin.body.data.csrfToken))
      .send({});
    expect(approval.status).toBe(200);
    expect(approval.body.data.status).toBe("approved");

    const [promoted] = await db
      .select({ role: users.role, authVersion: users.authVersion })
      .from(users)
      .where(eq(users.id, applicant.userId));
    expect(promoted).toEqual({ role: "professional", authVersion: 1 });
    expect(
      await db.select().from(sessions).where(eq(sessions.sid, oldSessionId)),
    ).toHaveLength(0);
    expect((await applicant.agent.get("/api/v1/auth/me")).status).toBe(401);
    expect((await applicant.agent.get("/api/v1/professional/me")).status).toBe(
      401,
    );

    const professionalAgent = request.agent(app);
    await loginAgent(professionalAgent, applicant.address);
    const profileResponse = await professionalAgent.get(
      "/api/v1/professional/me",
    );
    expect(profileResponse.status).toBe(200);
    const profile = profileResponse.body.data.profile;
    expect(profile).toMatchObject({
      displayName: "Collision Studio",
      city: "Pune",
      country: "India",
      status: "draft",
      providerTypes: ["event_organizer", "event_manager"],
    });
    expect(profile.slug).toMatch(/^collision-studio-/);
    expect(profile).not.toHaveProperty("email");
    expect(profile).not.toHaveProperty("userId");
    expect(profile).not.toHaveProperty("passwordHash");
    const professionalCsrf = await getCsrf(professionalAgent);
    const updatedProfile = await professionalAgent
      .patch("/api/v1/professional/me/profile")
      .set(csrfHeaders(professionalCsrf))
      .send({ headline: "Thoughtful event planning", city: "Mumbai" });
    expect(updatedProfile.status).toBe(200);
    expect(updatedProfile.body.data.profile).toMatchObject({
      headline: "Thoughtful event planning",
      city: "Mumbai",
    });
    const profileCsrf = await getCsrf(professionalAgent);
    const forbiddenProfileField = await professionalAgent
      .patch("/api/v1/professional/me/profile")
      .set(csrfHeaders(profileCsrf))
      .send({ slug: "attacker-controlled" });
    expect(forbiddenProfileField.status).toBe(400);

    const repeatApproval = await admin.agent
      .post(`/api/v1/admin/provider-applications/${applicationId}/approve`)
      .set(csrfHeaders(adminLogin.body.data.csrfToken))
      .send({});
    expect(repeatApproval.status).toBe(409);
    expect(
      await db
        .select()
        .from(adminAuditLogs)
        .where(
          and(
            eq(adminAuditLogs.providerApplicationId, applicationId!),
            eq(adminAuditLogs.action, "approve_provider_application"),
          ),
        ),
    ).toHaveLength(1);
  });

  it("rejects with an admin-only reason and allows a rejected applicant to resubmit", async () => {
    const applicant = await createVerifiedUser("rejection-applicant");
    const admin = await createVerifiedUser("rejection-admin", "admin");
    await loginAgent(applicant.agent, applicant.address);
    const created = await submitApplication(applicant.agent);
    expect(created.status).toBe(201);
    const own = await applicant.agent.get("/api/v1/provider-applications/me");
    const applicationId = own.body.data.application.id as string;

    const adminLogin = await loginAgent(admin.agent, admin.address);
    const invalidReason = await admin.agent
      .post(`/api/v1/admin/provider-applications/${applicationId}/reject`)
      .set(csrfHeaders(adminLogin.body.data.csrfToken))
      .send({ reason: "no" });
    expect(invalidReason.status).toBe(400);
    const rejection = await admin.agent
      .post(`/api/v1/admin/provider-applications/${applicationId}/reject`)
      .set(csrfHeaders(adminLogin.body.data.csrfToken))
      .send({ reason: "Please provide more information about your services." });
    expect(rejection.status).toBe(200);

    const applicantStatus = await applicant.agent.get(
      "/api/v1/provider-applications/me",
    );
    expect(applicantStatus.body.data.application.status).toBe("rejected");
    expect(applicantStatus.body.data.application).not.toHaveProperty(
      "rejectionReason",
    );
    expect(applicantStatus.body.data.application).not.toHaveProperty(
      "reviewerUserId",
    );
    const reviewDetail = await admin.agent.get(
      `/api/v1/admin/provider-applications/${applicationId}`,
    );
    expect(reviewDetail.body.data.application.rejectionReason).toBe(
      "Please provide more information about your services.",
    );
    expect(
      (
        await admin.agent
          .post(`/api/v1/admin/provider-applications/${applicationId}/reject`)
          .set(csrfHeaders(adminLogin.body.data.csrfToken))
          .send({ reason: "Another reason for this application." })
      ).status,
    ).toBe(409);

    const resubmission = await submitApplication(applicant.agent, {
      ...applicationInput,
      displayName: "New Studio Name",
    });
    expect(resubmission.status).toBe(201);
    expect(
      await db
        .select()
        .from(providerApplications)
        .where(eq(providerApplications.userId, applicant.userId)),
    ).toHaveLength(2);
    const [user] = await db
      .select({ role: users.role })
      .from(users)
      .where(eq(users.id, applicant.userId));
    expect(user?.role).toBe("customer");
    expect((await applicant.agent.get("/api/v1/auth/me")).status).toBe(200);
  });

  it("binds profile updates to the authenticated professional and rejects suspended accounts", async () => {
    const first = await createVerifiedUser("profile-owner-one");
    const second = await createVerifiedUser("profile-owner-two");
    const admin = await createVerifiedUser("profile-owner-admin", "admin");
    await loginAgent(first.agent, first.address);
    await loginAgent(second.agent, second.address);
    expect((await submitApplication(first.agent)).status).toBe(201);
    expect((await submitApplication(second.agent)).status).toBe(201);
    const [firstApplication] = await db
      .select({ id: providerApplications.id })
      .from(providerApplications)
      .where(eq(providerApplications.userId, first.userId));
    const [secondApplication] = await db
      .select({ id: providerApplications.id })
      .from(providerApplications)
      .where(eq(providerApplications.userId, second.userId));

    const adminLogin = await loginAgent(admin.agent, admin.address);
    for (const applicationId of [firstApplication!.id, secondApplication!.id]) {
      const approval = await admin.agent
        .post(`/api/v1/admin/provider-applications/${applicationId}/approve`)
        .set(csrfHeaders(adminLogin.body.data.csrfToken))
        .send({});
      expect(approval.status).toBe(200);
    }
    const profileSlugs = await db
      .select({ slug: professionalProfiles.slug })
      .from(professionalProfiles)
      .where(
        inArray(professionalProfiles.userId, [first.userId, second.userId]),
      );
    expect(new Set(profileSlugs.map(({ slug }) => slug)).size).toBe(2);

    const firstProfessional = request.agent(app);
    const secondProfessional = request.agent(app);
    await loginAgent(firstProfessional, first.address);
    await loginAgent(secondProfessional, second.address);
    const [firstProfile] = await db
      .select({ id: professionalProfiles.id })
      .from(professionalProfiles)
      .where(eq(professionalProfiles.userId, first.userId));
    const secondProfileCsrf = await getCsrf(secondProfessional);
    const spoofedOwnership = await secondProfessional
      .patch("/api/v1/professional/me/profile")
      .set(csrfHeaders(secondProfileCsrf))
      .send({
        city: "Remote change",
        profileId: firstProfile!.id,
        userId: first.userId,
      });
    expect(spoofedOwnership.status).toBe(400);

    const legitimateCsrf = await getCsrf(secondProfessional);
    const legitimateUpdate = await secondProfessional
      .patch("/api/v1/professional/me/profile")
      .set(csrfHeaders(legitimateCsrf))
      .send({ city: "Mumbai" });
    expect(legitimateUpdate.status).toBe(200);
    const [firstProfileAfter] = await db
      .select({ city: professionalProfiles.city })
      .from(professionalProfiles)
      .where(eq(professionalProfiles.userId, first.userId));
    const [secondProfileAfter] = await db
      .select({ city: professionalProfiles.city })
      .from(professionalProfiles)
      .where(eq(professionalProfiles.userId, second.userId));
    expect(firstProfileAfter?.city).toBe("Pune");
    expect(secondProfileAfter?.city).toBe("Mumbai");

    const suspended = await createVerifiedUser("suspended-applicant");
    await loginAgent(suspended.agent, suspended.address);
    await db
      .update(users)
      .set({
        status: "suspended",
        authVersion: sql`${users.authVersion} + 1`,
      })
      .where(eq(users.id, suspended.userId));
    expect((await submitApplication(suspended.agent)).status).toBe(401);
  });

  it("serializes concurrent reviews and rolls back partial privilege changes", async () => {
    const applicant = await createVerifiedUser("concurrent-applicant");
    const admin = await createVerifiedUser("concurrent-admin", "admin");
    await loginAgent(applicant.agent, applicant.address);
    await submitApplication(applicant.agent);
    const own = await applicant.agent.get("/api/v1/provider-applications/me");
    const applicationId = own.body.data.application.id as string;

    const adminOne = request.agent(app);
    const adminTwo = request.agent(app);
    const adminLoginOne = await loginAgent(adminOne, admin.address);
    const adminLoginTwo = await loginAgent(adminTwo, admin.address);
    const path = `/api/v1/admin/provider-applications/${applicationId}/approve`;
    const [first, second] = await Promise.all([
      adminOne
        .post(path)
        .set(csrfHeaders(adminLoginOne.body.data.csrfToken))
        .send({}),
      adminTwo
        .post(path)
        .set(csrfHeaders(adminLoginTwo.body.data.csrfToken))
        .send({}),
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 409]);
    expect(
      await db
        .select()
        .from(professionalProfiles)
        .where(eq(professionalProfiles.userId, applicant.userId)),
    ).toHaveLength(1);
    expect(
      await db
        .select()
        .from(adminAuditLogs)
        .where(
          and(
            eq(adminAuditLogs.providerApplicationId, applicationId),
            eq(adminAuditLogs.action, "approve_provider_application"),
          ),
        ),
    ).toHaveLength(1);

    const rollbackApplicant = await createVerifiedUser("rollback-applicant");
    const collisionOwner = await createVerifiedUser("rollback-collision-owner");
    await loginAgent(rollbackApplicant.agent, rollbackApplicant.address);
    await submitApplication(rollbackApplicant.agent);
    const rollbackOwn = await rollbackApplicant.agent.get(
      "/api/v1/provider-applications/me",
    );
    const rollbackApplicationId = rollbackOwn.body.data.application
      .id as string;
    const slug = await makeCollisionSlug(rollbackApplicant.userId);
    await db.insert(professionalProfiles).values({
      userId: collisionOwner.userId,
      displayName: "Slug collision fixture",
      slug,
      bio: "Test-only profile used to verify transaction rollback.",
      city: "Pune",
      country: "India",
    });
    await db.insert(professionalProfileTypes).values({
      profileId: (
        await db
          .select({ id: professionalProfiles.id })
          .from(professionalProfiles)
          .where(eq(professionalProfiles.userId, collisionOwner.userId))
      )[0]!.id,
      providerType: "event_organizer",
    });

    const failedApproval = await adminOne
      .post(
        `/api/v1/admin/provider-applications/${rollbackApplicationId}/approve`,
      )
      .set(csrfHeaders(adminLoginOne.body.data.csrfToken))
      .send({});
    expect(failedApproval.status).toBe(500);
    const [unchangedApplicant] = await db
      .select({ role: users.role, authVersion: users.authVersion })
      .from(users)
      .where(eq(users.id, rollbackApplicant.userId));
    expect(unchangedApplicant).toEqual({
      role: "customer",
      authVersion: 0,
    });
    const [unchangedApplication] = await db
      .select({ status: providerApplications.status })
      .from(providerApplications)
      .where(eq(providerApplications.id, rollbackApplicationId));
    expect(unchangedApplication?.status).toBe("pending");
    expect(
      await db
        .select()
        .from(professionalProfiles)
        .where(eq(professionalProfiles.userId, rollbackApplicant.userId)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(adminAuditLogs)
        .where(eq(adminAuditLogs.providerApplicationId, rollbackApplicationId)),
    ).toHaveLength(0);
  });
});
