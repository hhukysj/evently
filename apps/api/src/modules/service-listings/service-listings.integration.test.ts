import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { createApp } from "../../app.js";
import { env } from "../../config/env.js";
import { db, pool } from "../../db/client.js";
import {
  adminAuditLogs,
  accountTokens,
  professionalProfiles,
  professionalProfileTypes,
  providerApplications,
  providerApplicationTypes,
  serviceListings,
  sessions,
  users,
} from "../../db/schema.js";
import { PostgresRateLimitStore } from "../../middleware/postgres-rate-limit-store.js";
import { createPostgresSessionStore } from "../../middleware/sessions.js";
import { PostgresUserRepository } from "../auth/repository.js";
import { PasswordAuthService } from "../auth/service.js";
import { DevelopmentEmailDelivery } from "../auth/email-delivery.js";
import { PostgresServiceListingRepository } from "./repository.js";
import { TrackingServiceListingRepository } from "./tracking-repository.js";
import { ServiceListingService } from "./service.js";
import {
  createServiceListingFixtureCleanupScope,
  formatRetainedFixtureReport,
  planListingAuditCleanup,
  reportAmbiguousListingRetention,
  resolveListingAttempt,
  trackCommittedListing,
  trackInsertedModerationAudit,
  teardownIntegrationResources,
  type RetainedFixture,
} from "./cleanup.js";
import { verifyIntegrationDatabase } from "../../testing/integration-database.js";

const fixturePrefix = `listing-it-${randomUUID()}`;
const password = "service-listing-integration-password";
const integrationDatabaseUrl = process.env.EVENTLY_INTEGRATION_DATABASE_URL;
if (!integrationDatabaseUrl) {
  throw new Error("EVENTLY_INTEGRATION_DATABASE_URL is required.");
}
const trackedUserIds = new Set<string>();
const trackedUserEmails = new Map<string, string>();
const trackedProfiles: { id: string; ownerId: string }[] = [];
const trackedApplications: { id: string; ownerId: string }[] = [];
const trackedListings: { id: string; ownerId: string }[] = [];
const trackedAuditIds: { id: string; ownerId: string }[] = [];
const listingAttempts: { description: string; ownerId: string }[] = [];
const profileByAgent = new WeakMap<object, string>();
const profileByUserId = new Map<string, string>();
const rateLimitStores: {
  scope: string;
  store: PostgresRateLimitStore;
}[] = [];
let safeDatabaseConfirmed = false;
const sessionStore = createPostgresSessionStore(pool, false);

const emailProvider = new DevelopmentEmailDelivery("development");
const app = createApp(pool, {
  service: new PasswordAuthService(
    new PostgresUserRepository(db),
    emailProvider,
  ),
  serviceListingService: new ServiceListingService(
    new TrackingServiceListingRepository(
      db,
      (userId) => profileByUserId.get(userId),
      (listingId, profileId) => {
        trackCommittedListing(trackedListings, { id: listingId }, profileId);
      },
      (auditId, listingId) => {
        trackInsertedModerationAudit(trackedAuditIds, auditId, listingId);
      },
    ),
  ),
  environment: "test",
  sessionStore,
  sessionSecret: env.SESSION_SECRET,
  appOrigin: env.APP_ORIGIN,
  secureCookies: false,
  cookieName: "evently.sid",
  trustProxyHops: 0,
  rateLimitStoreFactory: (scope) => {
    const store = new PostgresRateLimitStore(
      pool,
      `${fixturePrefix}:${scope}`,
      undefined,
      { pruneExpired: false },
    );
    rateLimitStores.push({ scope, store });
    return store;
  },
});

function csrfHeaders(token: string) {
  return { Origin: env.APP_ORIGIN, "X-CSRF-Token": token };
}

async function csrf(agent: ReturnType<typeof request.agent>): Promise<string> {
  const response = await agent.get("/api/v1/auth/csrf");
  expect(response.status).toBe(200);
  return response.body.data.csrfToken as string;
}

async function login(
  agent: ReturnType<typeof request.agent>,
  address: string,
): Promise<void> {
  const token = await csrf(agent);
  const response = await agent
    .post("/api/v1/auth/login")
    .set(csrfHeaders(token))
    .send({ email: address, password });
  expect(response.status).toBe(200);
  const loginRateLimitStore = rateLimitStores.find(
    ({ scope }) => scope === "login",
  )?.store;
  await loginRateLimitStore?.clear();
}

async function createUser(
  name: string,
  role: "professional" | "customer" | "admin",
  reviewerUserId?: string,
  approvedProvider = true,
) {
  const address = `${fixturePrefix}-${name}@example.test`;
  const userId = randomUUID();
  trackedUserIds.add(userId);
  trackedUserEmails.set(userId, address);
  const [user] = await db
    .insert(users)
    .values({
      id: userId,
      email: address,
      passwordHash: await argon2.hash(password),
      role,
      emailVerifiedAt: new Date(),
    })
    .returning({ id: users.id });
  if (!user) {
    throw new Error("Could not create service listing integration user");
  }

  let profileId: string | undefined;
  if (role === "professional") {
    if (approvedProvider && !reviewerUserId) {
      throw new Error("Approved professional fixture requires an admin");
    }
    if (approvedProvider && reviewerUserId) {
      const reviewedAt = new Date();
      const applicationId = randomUUID();
      trackedApplications.push({ id: applicationId, ownerId: user.id });
      const [application] = await db
        .insert(providerApplications)
        .values({
          id: applicationId,
          userId: user.id,
          displayName: `${name} Events`,
          description: "Approved provider fixture for service listing tests.",
          city: "Pune",
          country: "India",
          status: "approved",
          reviewerUserId,
          reviewedAt,
        })
        .returning({ id: providerApplications.id });
      if (!application) {
        throw new Error("Could not create approved provider fixture");
      }
    }
    profileId = randomUUID();
    trackedProfiles.push({ id: profileId, ownerId: user.id });
    profileByUserId.set(user.id, profileId);
    const [profile] = await db
      .insert(professionalProfiles)
      .values({
        id: profileId,
        userId: user.id,
        displayName: `${name} Events`,
        slug: `${fixturePrefix}-${name}`,
        city: "Pune",
        country: "India",
      })
      .returning({ id: professionalProfiles.id });
    if (!profile) {
      throw new Error("Could not create professional profile fixture");
    }
  }

  const agent = request.agent(app);
  if (profileId) {
    profileByAgent.set(agent, profileId);
  }
  await login(agent, address);
  return { id: user.id, address, agent, profileId };
}

function listingInput(overrides: Record<string, unknown> = {}) {
  return {
    categorySlug: "planning_coordination",
    title: "Community event planning",
    description: "Planning and coordination for local community events.",
    city: "Pune",
    pricingMethod: "fixed",
    priceAmountPaise: 0,
    ...overrides,
  };
}

async function createListing(
  agent: ReturnType<typeof request.agent>,
  overrides: Record<string, unknown> = {},
) {
  const token = await csrf(agent);
  const profileId = profileByAgent.get(agent);
  if (!profileId) {
    throw new Error("Service listing fixture has no tracked owner profile");
  }
  const baseTitle =
    typeof overrides.title === "string"
      ? overrides.title
      : "Community event planning";
  const baseDescription =
    typeof overrides.description === "string"
      ? overrides.description
      : "Planning and coordination for local community events.";
  const description = `${baseDescription.slice(0, 1100)} [it-${randomUUID()}]`;
  listingAttempts.push({ description, ownerId: profileId });
  const response = await agent
    .post("/api/v1/professional/service-listings")
    .set(csrfHeaders(token))
    .send(listingInput({ ...overrides, title: baseTitle, description }));
  return response;
}

async function getOwnerListing(
  agent: ReturnType<typeof request.agent>,
  listingId: string,
) {
  return agent.get(`/api/v1/professional/service-listings/${listingId}`);
}

async function postAction(
  agent: ReturnType<typeof request.agent>,
  path: string,
  token: string,
  etag: string,
  body: Record<string, unknown> = {},
) {
  return agent
    .post(path)
    .set({ ...csrfHeaders(token), "If-Match": etag })
    .send(body);
}

async function waitForDatabaseBlocker(blockingPid: number): Promise<void> {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    const result = await pool.query<{ blocked: boolean }>(
      `SELECT EXISTS (
         SELECT 1
         FROM pg_stat_activity AS waiting
         WHERE waiting.pid <> $1
           AND waiting.wait_event_type = 'Lock'
           AND $1 = ANY(pg_blocking_pids(waiting.pid))
       ) AS blocked`,
      [blockingPid],
    );
    if (result.rows[0]?.blocked) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Moderation did not wait for the administrator row lock.");
}

beforeAll(async () => {
  await verifyIntegrationDatabase(
    integrationDatabaseUrl,
    pool,
    process.env,
    env.DATABASE_URL,
  );
  safeDatabaseConfirmed = true;
});

async function cleanupFixtureRecords() {
  const retained: RetainedFixture[] = [];
  const trackedUserPairs = [...trackedUserEmails].map(([id, email]) =>
    and(eq(users.id, id), eq(users.email, email)),
  );
  const ownedUsers =
    trackedUserPairs.length > 0
      ? await db
          .select({ id: users.id })
          .from(users)
          .where(or(...trackedUserPairs))
      : [];
  const ownedUserIds = ownedUsers.map(({ id }) => id);
  for (const id of trackedUserIds) {
    if (!ownedUserIds.includes(id)) {
      retained.push({
        type: "user",
        id,
        reason: "could not verify the exact fixture email; left untouched",
      });
    }
  }
  if (ownedUserIds.length === 0) {
    return retained;
  }

  await db.transaction(async (tx) => {
    const scope = createServiceListingFixtureCleanupScope({
      userIds: ownedUserIds,
      profileIds: trackedProfiles,
      applicationIds: trackedApplications,
      listingIds: trackedListings,
      auditIds: trackedAuditIds,
    });
    const profileIds = scope.profiles.map(({ id }) => id);
    const ambiguousListingIds = new Set<string>();
    const ambiguousListings = new Map<
      string,
      { id: string; profileId: string }
    >();

    for (const attempt of listingAttempts) {
      const matches = await tx
        .select({
          id: serviceListings.id,
          profileId: serviceListings.professionalProfileId,
        })
        .from(serviceListings)
        .where(
          and(
            eq(serviceListings.professionalProfileId, attempt.ownerId),
            eq(serviceListings.description, attempt.description),
          ),
        );
      const resolved = resolveListingAttempt(attempt.ownerId, matches);
      if (resolved) {
        if (!scope.listings.some(({ id }) => id === resolved.id)) {
          scope.listings.push(resolved);
        }
      } else if (matches.length > 1) {
        for (const { id } of matches) {
          ambiguousListingIds.add(id);
        }
        for (const match of matches) {
          ambiguousListings.set(match.id, match);
        }
      }
    }
    const ambiguousListingAuditRows =
      ambiguousListingIds.size > 0
        ? await tx
            .select({
              id: adminAuditLogs.id,
              listingId: adminAuditLogs.serviceListingId,
            })
            .from(adminAuditLogs)
            .where(
              inArray(adminAuditLogs.serviceListingId, [
                ...ambiguousListingIds,
              ]),
            )
        : [];
    retained.push(
      ...reportAmbiguousListingRetention(
        [...ambiguousListings.values()],
        ambiguousListingAuditRows,
      ),
    );
    scope.listings = scope.listings.filter(
      ({ id }) => !ambiguousListingIds.has(id),
    );

    const listingRows =
      scope.listings.length > 0
        ? await tx
            .select({
              id: serviceListings.id,
              profileId: serviceListings.professionalProfileId,
            })
            .from(serviceListings)
            .where(
              inArray(
                serviceListings.id,
                scope.listings.map(({ id }) => id),
              ),
            )
            .for("update")
        : [];
    const expectedProfileByListing = new Map(
      scope.listings.map(({ id, ownerId }) => [id, ownerId]),
    );
    const verifiedListings = listingRows
      .filter(
        ({ id, profileId }) => expectedProfileByListing.get(id) === profileId,
      )
      .map(({ id, profileId }) => ({ id, ownerId: profileId }));
    const verifiedListingIds = verifiedListings.map(({ id }) => id);
    const listingAuditRows =
      verifiedListingIds.length > 0
        ? await tx
            .select({
              id: adminAuditLogs.id,
              listingId: adminAuditLogs.serviceListingId,
            })
            .from(adminAuditLogs)
            .where(inArray(adminAuditLogs.serviceListingId, verifiedListingIds))
        : [];
    const auditPlan = planListingAuditCleanup(
      verifiedListings,
      listingAuditRows.flatMap(({ id, listingId }) =>
        listingId ? [{ id, ownerId: listingId }] : [],
      ),
      scope.audits,
    );
    retained.push(...auditPlan.retainedAudits);
    retained.push(...auditPlan.retainedListings);

    if (auditPlan.auditIds.length > 0) {
      const trackedAuditPairs = scope.audits
        .filter(({ id }) => auditPlan.auditIds.includes(id))
        .map(({ id, ownerId }) =>
          and(
            eq(adminAuditLogs.id, id),
            eq(adminAuditLogs.serviceListingId, ownerId),
          ),
        );
      await tx.delete(adminAuditLogs).where(or(...trackedAuditPairs));
    }

    const deletableListingIds = new Set(auditPlan.listingIds);
    const deletableListings = verifiedListings.filter(({ id }) =>
      deletableListingIds.has(id),
    );
    if (deletableListings.length > 0) {
      const listingPairs = deletableListings.map(({ id, ownerId }) =>
        and(
          eq(serviceListings.id, id),
          eq(serviceListings.professionalProfileId, ownerId),
        ),
      );
      await tx.delete(serviceListings).where(or(...listingPairs));
    }

    const allProfileListings =
      profileIds.length > 0
        ? await tx
            .select({
              id: serviceListings.id,
              profileId: serviceListings.professionalProfileId,
            })
            .from(serviceListings)
            .where(inArray(serviceListings.professionalProfileId, profileIds))
        : [];
    const profilesWithListings = new Set(
      allProfileListings.map(({ profileId }) => profileId),
    );
    for (const { id } of scope.profiles) {
      if (profilesWithListings.has(id)) {
        retained.push({
          type: "profile",
          id,
          reason: "has a listing that was not safely removed",
        });
      }
    }

    const profileTypeRows =
      profileIds.length > 0
        ? await tx
            .select({ profileId: professionalProfileTypes.profileId })
            .from(professionalProfileTypes)
            .where(inArray(professionalProfileTypes.profileId, profileIds))
        : [];
    const profilesWithTypes = new Set(
      profileTypeRows.map(({ profileId }) => profileId),
    );
    for (const { id } of scope.profiles) {
      if (profilesWithTypes.has(id)) {
        retained.push({
          type: "profile",
          id,
          reason: "has provider-type rows not tracked as test-created",
        });
      }
    }
    const retainedProfileIds = new Set(
      retained.filter(({ type }) => type === "profile").map(({ id }) => id),
    );
    const deletableProfiles = scope.profiles.filter(
      ({ id }) => !retainedProfileIds.has(id),
    );
    if (deletableProfiles.length > 0) {
      const profilePairs = deletableProfiles.map(({ id, ownerId }) =>
        and(
          eq(professionalProfiles.id, id),
          eq(professionalProfiles.userId, ownerId),
        ),
      );
      await tx.delete(professionalProfiles).where(or(...profilePairs));
    }

    const applicationIds = scope.applications.map(({ id }) => id);
    const applicationRows =
      applicationIds.length > 0
        ? await tx
            .select({
              id: providerApplications.id,
              userId: providerApplications.userId,
            })
            .from(providerApplications)
            .where(inArray(providerApplications.id, applicationIds))
        : [];
    const verifiedApplications = applicationRows
      .filter(({ id, userId }) =>
        scope.applications.some(
          (tracked) => tracked.id === id && tracked.ownerId === userId,
        ),
      )
      .map(({ id, userId }) => ({ id, ownerId: userId }));
    const applicationAuditRows =
      verifiedApplications.length > 0
        ? await tx
            .select({
              applicationId: adminAuditLogs.providerApplicationId,
            })
            .from(adminAuditLogs)
            .where(
              inArray(
                adminAuditLogs.providerApplicationId,
                verifiedApplications.map(({ id }) => id),
              ),
            )
        : [];
    const auditedApplicationIds = new Set(
      applicationAuditRows.flatMap(({ applicationId }) =>
        applicationId ? [applicationId] : [],
      ),
    );
    const applicationTypeRows =
      verifiedApplications.length > 0
        ? await tx
            .select({
              applicationId: providerApplicationTypes.applicationId,
            })
            .from(providerApplicationTypes)
            .where(
              inArray(
                providerApplicationTypes.applicationId,
                verifiedApplications.map(({ id }) => id),
              ),
            )
        : [];
    const typedApplicationIds = new Set(
      applicationTypeRows.map(({ applicationId }) => applicationId),
    );
    const deletableApplications = verifiedApplications.filter(
      ({ id }) =>
        !auditedApplicationIds.has(id) && !typedApplicationIds.has(id),
    );
    for (const { id } of verifiedApplications) {
      if (auditedApplicationIds.has(id)) {
        retained.push({
          type: "application",
          id,
          reason: "is referenced by an admin audit record",
        });
      }
      if (typedApplicationIds.has(id)) {
        retained.push({
          type: "application",
          id,
          reason: "has provider-type rows not tracked as test-created",
        });
      }
    }
    if (deletableApplications.length > 0) {
      const applicationPairs = deletableApplications.map(({ id, ownerId }) =>
        and(
          eq(providerApplications.id, id),
          eq(providerApplications.userId, ownerId),
        ),
      );
      await tx.delete(providerApplications).where(or(...applicationPairs));
    }

    await tx.delete(sessions).where(
      sql`${sessions.sess}->>'userId' IN (${sql.join(
        ownedUserIds.map((id) => sql`${id}`),
        sql`, `,
      )})`,
    );

    const protectedUsers = new Map<string, string>();
    for (const { id, ownerId } of scope.profiles) {
      if (retainedProfileIds.has(id)) {
        protectedUsers.set(ownerId, `owns retained profile ${id}`);
      }
    }
    for (const { id } of retained) {
      if (id) {
        const listing = verifiedListings.find(
          (candidate) => candidate.id === id,
        );
        if (listing) {
          const owner = scope.profiles.find(
            ({ id: profileId }) => profileId === listing.ownerId,
          );
          if (owner) {
            protectedUsers.set(owner.ownerId, `owns retained listing ${id}`);
          }
        }
      }
    }

    const remainingApplications = await tx
      .select({
        id: providerApplications.id,
        userId: providerApplications.userId,
        reviewerUserId: providerApplications.reviewerUserId,
      })
      .from(providerApplications)
      .where(
        or(
          inArray(providerApplications.userId, ownedUserIds),
          inArray(providerApplications.reviewerUserId, ownedUserIds),
        ),
      );
    for (const application of remainingApplications) {
      if (ownedUserIds.includes(application.userId)) {
        protectedUsers.set(
          application.userId,
          `owns retained provider application ${application.id}`,
        );
      }
      if (
        application.reviewerUserId &&
        ownedUserIds.includes(application.reviewerUserId)
      ) {
        protectedUsers.set(
          application.reviewerUserId,
          `reviews unrelated or retained application ${application.id}`,
        );
      }
    }

    const remainingListings = await tx
      .select({
        id: serviceListings.id,
        moderatorId: serviceListings.moderationHiddenByUserId,
      })
      .from(serviceListings)
      .where(inArray(serviceListings.moderationHiddenByUserId, ownedUserIds));
    for (const listing of remainingListings) {
      if (listing.moderatorId) {
        protectedUsers.set(
          listing.moderatorId,
          `moderates retained listing ${listing.id}`,
        );
      }
    }

    const remainingAudits = await tx
      .select({
        id: adminAuditLogs.id,
        actorId: adminAuditLogs.actorUserId,
        targetId: adminAuditLogs.targetUserId,
      })
      .from(adminAuditLogs)
      .where(
        or(
          inArray(adminAuditLogs.actorUserId, ownedUserIds),
          inArray(adminAuditLogs.targetUserId, ownedUserIds),
        ),
      );
    for (const audit of remainingAudits) {
      if (audit.actorId && ownedUserIds.includes(audit.actorId)) {
        protectedUsers.set(
          audit.actorId,
          `is actor in retained admin audit ${audit.id}`,
        );
      }
      if (audit.targetId && ownedUserIds.includes(audit.targetId)) {
        protectedUsers.set(
          audit.targetId,
          `is target in retained admin audit ${audit.id}`,
        );
      }
    }

    const remainingProfiles = await tx
      .select({
        id: professionalProfiles.id,
        ownerId: professionalProfiles.userId,
      })
      .from(professionalProfiles)
      .where(inArray(professionalProfiles.userId, ownedUserIds));
    for (const profile of remainingProfiles) {
      if (ownedUserIds.includes(profile.ownerId)) {
        protectedUsers.set(
          profile.ownerId,
          `owns retained profile ${profile.id}`,
        );
      }
    }

    const existingTokens = await tx
      .select({ userId: accountTokens.userId })
      .from(accountTokens)
      .where(inArray(accountTokens.userId, ownedUserIds));
    for (const { userId } of existingTokens) {
      protectedUsers.set(userId, "owns account-token records");
    }

    for (const [id, reason] of protectedUsers) {
      retained.push({ type: "user", id, reason });
    }
    const deletableUserIds = ownedUserIds.filter(
      (id) => !protectedUsers.has(id),
    );
    if (deletableUserIds.length > 0) {
      const userPairs = deletableUserIds.flatMap((id) => {
        const email = trackedUserEmails.get(id);
        return email ? [and(eq(users.id, id), eq(users.email, email))] : [];
      });
      if (userPairs.length > 0) {
        await tx.delete(users).where(or(...userPairs));
      }
    }
  });
  return retained;
}

afterAll(async () => {
  await teardownIntegrationResources({
    databaseVerified: safeDatabaseConfirmed,
    cleanupDatabase: async () => {
      const retained = await cleanupFixtureRecords();
      if (retained.length > 0) {
        throw new Error(formatRetainedFixtureReport(retained));
      }
    },
    rateLimitStores: rateLimitStores.map(({ store }) => store),
    closeSessionStore: async () => {
      await sessionStore.close();
    },
    closePool: () => pool.end(),
  });
});

describe("PostgreSQL service listing API", () => {
  it("creates private drafts, validates fields, and enforces owner access", async () => {
    const admin = await createUser("admin-create", "admin");
    const owner = await createUser("owner-create", "professional", admin.id);
    const unapproved = await createUser(
      "unapproved-create",
      "professional",
      undefined,
      false,
    );
    const otherOwner = await createUser(
      "other-owner-create",
      "professional",
      admin.id,
    );
    const customer = await createUser("customer-create", "customer");

    const created = await createListing(owner.agent);
    expect(created.status).toBe(201);
    expect(created.body.data.listing).toMatchObject({
      publicationStatus: "draft",
      moderationStatus: "visible",
      priceAmountPaise: 0,
      version: 1,
    });
    expect(created.headers.etag).toBeTruthy();
    const ownerListings = await owner.agent.get(
      "/api/v1/professional/service-listings",
    );
    expect(ownerListings.status).toBe(200);
    expect(ownerListings.body.data.listings).toHaveLength(1);
    expect(ownerListings.body.data.pagination).toEqual({
      page: 1,
      pageSize: 25,
      total: 1,
    });
    expect(ownerListings.body.data.listings[0]).toMatchObject({
      id: created.body.data.listing.id,
      title: created.body.data.listing.title,
      version: 1,
    });
    expect(ownerListings.body.data.listings[0]).toHaveProperty(
      "moderationReason",
      null,
    );
    expect(
      (await otherOwner.agent.get("/api/v1/professional/service-listings")).body
        .data.listings,
    ).toEqual([]);
    expect(
      (await owner.agent.get("/api/v1/professional/service-listings?page=0"))
        .status,
    ).toBe(400);
    expect(
      (await unapproved.agent.get("/api/v1/professional/service-listings"))
        .status,
    ).toBe(403);
    expect(
      (await customer.agent.get("/api/v1/professional/service-listings"))
        .status,
    ).toBe(403);
    expect(
      (await request(app).get("/api/v1/professional/service-listings")).status,
    ).toBe(401);
    expect(
      (
        await request(app)
          .post("/api/v1/professional/service-listings")
          .send(listingInput())
      ).status,
    ).toBe(401);
    expect(
      (
        await owner.agent
          .post("/api/v1/professional/service-listings")
          .send(listingInput())
      ).status,
    ).toBe(403);

    const publicResponse = await request(app).get(
      `/api/v1/service-listings/${created.body.data.listing.id}`,
    );
    expect(publicResponse.status).toBe(404);
    expect(
      (
        await getOwnerListing(
          otherOwner.agent,
          created.body.data.listing.id as string,
        )
      ).status,
    ).toBe(404);
    const publicPage = await request(app).get(
      "/api/v1/service-listings?city=Pune",
    );
    expect(
      publicPage.body.data.listings.map(
        (listing: { id: string }) => listing.id,
      ),
    ).not.toContain(created.body.data.listing.id);
    expect(
      (
        await customer.agent.get(
          `/api/v1/professional/service-listings/${created.body.data.listing.id}`,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await createListing(owner.agent, {
          ...listingInput(),
          professionalProfileId: otherOwner.profileId,
          publicationStatus: "published",
        })
      ).status,
    ).toBe(400);
    expect((await createListing(unapproved.agent)).status).toBe(403);

    const invalidRegion = await createListing(owner.agent, { region: " " });
    expect(invalidRegion.status).toBe(201);
    expect(invalidRegion.body.data.listing.region).toBeNull();
  });

  it("requires strong version preconditions and confirms published edits", async () => {
    const admin = await createUser("admin-version", "admin");
    const owner = await createUser("owner-version", "professional", admin.id);
    const created = await createListing(owner.agent);
    const id = created.body.data.listing.id as string;
    const token = await csrf(owner.agent);
    const versionOneEtag = created.headers.etag as string;

    const missingPrecondition = await owner.agent
      .patch(`/api/v1/professional/service-listings/${id}`)
      .set(csrfHeaders(token))
      .send({ title: "Updated community planning" });
    expect(missingPrecondition.status).toBe(428);

    const publish = await postAction(
      owner.agent,
      `/api/v1/professional/service-listings/${id}/publish`,
      token,
      versionOneEtag,
    );
    expect(publish.status).toBe(200);
    expect(publish.body.data.listing.publicationStatus).toBe("published");
    const versionTwoEtag = publish.headers.etag as string;

    const unconfirmedEdit = await owner.agent
      .patch(`/api/v1/professional/service-listings/${id}`)
      .set({ ...csrfHeaders(token), "If-Match": versionTwoEtag })
      .send({ title: "Updated community planning" });
    expect(unconfirmedEdit.status).toBe(428);
    expect(unconfirmedEdit.body.error.code).toBe(
      "PUBLISHED_EDIT_CONFIRMATION_REQUIRED",
    );

    const confirmedEdit = await owner.agent
      .patch(`/api/v1/professional/service-listings/${id}`)
      .set({
        ...csrfHeaders(token),
        "If-Match": versionTwoEtag,
        "X-Confirm-Published-Edit": "true",
      })
      .send({ title: "Updated community planning" });
    expect(confirmedEdit.status).toBe(200);
    expect(confirmedEdit.body.data.listing.version).toBe(3);

    const staleWrite = await owner.agent
      .patch(`/api/v1/professional/service-listings/${id}`)
      .set({
        ...csrfHeaders(token),
        "If-Match": versionTwoEtag,
        "X-Confirm-Published-Edit": "true",
      })
      .send({ title: "Stale title" });
    expect(staleWrite.status).toBe(412);

    const alreadyPublished = await postAction(
      owner.agent,
      `/api/v1/professional/service-listings/${id}/publish`,
      token,
      confirmedEdit.headers.etag as string,
    );
    expect(alreadyPublished.status).toBe(409);

    const unpublish = await postAction(
      owner.agent,
      `/api/v1/professional/service-listings/${id}/unpublish`,
      token,
      confirmedEdit.headers.etag as string,
    );
    expect(unpublish.status).toBe(200);
    expect(unpublish.body.data.listing.publicationStatus).toBe("draft");
    const republish = await postAction(
      owner.agent,
      `/api/v1/professional/service-listings/${id}/publish`,
      token,
      unpublish.headers.etag as string,
    );
    expect(republish.status).toBe(200);

    const concurrentEditEtag = republish.headers.etag as string;
    const concurrentEdits = await Promise.all([
      owner.agent
        .patch(`/api/v1/professional/service-listings/${id}`)
        .set({
          ...csrfHeaders(token),
          "If-Match": concurrentEditEtag,
          "X-Confirm-Published-Edit": "true",
        })
        .send({ title: "Concurrent title one" }),
      owner.agent
        .patch(`/api/v1/professional/service-listings/${id}`)
        .set({
          ...csrfHeaders(token),
          "If-Match": concurrentEditEtag,
          "X-Confirm-Published-Edit": "true",
        })
        .send({ title: "Concurrent title two" }),
    ]);
    expect(concurrentEdits.map(({ status }) => status).sort()).toEqual([
      200, 412,
    ]);
  });

  it("filters public results and returns only privacy-safe fields", async () => {
    const admin = await createUser("admin-public", "admin");
    const owner = await createUser("owner-public", "professional", admin.id);
    const created = await createListing(owner.agent);
    const id = created.body.data.listing.id as string;
    const ownerToken = await csrf(owner.agent);
    const published = await postAction(
      owner.agent,
      `/api/v1/professional/service-listings/${id}/publish`,
      ownerToken,
      created.headers.etag as string,
    );
    expect(published.status).toBe(200);

    const publicResponse = await request(app).get(
      `/api/v1/service-listings/${id}`,
    );
    expect(publicResponse.status).toBe(200);
    expect(publicResponse.body.data.listing).toEqual(
      expect.objectContaining({
        id,
        title: "Community event planning",
        category: {
          slug: "planning_coordination",
          name: "Planning and coordination",
        },
        provider: expect.objectContaining({
          displayName: "owner-public Events",
        }),
      }),
    );
    const publicJson = JSON.stringify(publicResponse.body.data.listing);
    expect(Object.keys(publicResponse.body.data.listing).sort()).toEqual([
      "category",
      "city",
      "currency",
      "description",
      "id",
      "priceAmountPaise",
      "pricingMethod",
      "provider",
      "region",
      "title",
    ]);
    expect(
      Object.keys(publicResponse.body.data.listing.provider).sort(),
    ).toEqual(["displayName", "headline", "slug"]);
    for (const privateField of [
      "userId",
      "professionalProfileId",
      "email",
      "passwordHash",
      "authVersion",
      "moderation",
      "reviewer",
      "audit",
    ]) {
      expect(publicJson).not.toContain(privateField);
    }
    expect(publicResponse.headers["cache-control"]).toBe("no-store");
    const publicPage = await request(app).get(
      "/api/v1/service-listings?city=Pune&categorySlug=planning_coordination",
    );
    expect(publicPage.status).toBe(200);
    expect(publicPage.body.data.listings).toEqual(
      expect.arrayContaining([expect.objectContaining({ id })]),
    );

    await db
      .update(users)
      .set({ status: "suspended" })
      .where(eq(users.id, owner.id));
    expect((await getOwnerListing(owner.agent, id)).status).toBe(401);
    expect(
      (await owner.agent.get("/api/v1/professional/service-listings")).status,
    ).toBe(401);
    expect(
      (await request(app).get(`/api/v1/service-listings/${id}`)).status,
    ).toBe(404);
    const suppressedPage = await request(app).get(
      "/api/v1/service-listings?city=Pune",
    );
    expect(
      suppressedPage.body.data.listings.map(
        (listing: { id: string }) => listing.id,
      ),
    ).not.toContain(id);
    await db
      .update(users)
      .set({ status: "deactivated" })
      .where(eq(users.id, owner.id));
    expect(
      (await request(app).get(`/api/v1/service-listings/${id}`)).status,
    ).toBe(404);
  });

  it("rolls back moderation when the audit insert violates its reason constraint", async () => {
    const admin = await createUser("admin-rollback", "admin");
    const [adminRecord] = await db
      .select({ role: users.role, status: users.status })
      .from(users)
      .where(eq(users.id, admin.id));
    expect(adminRecord).toEqual({ role: "admin", status: "active" });

    const owner = await createUser("owner-rollback", "professional", admin.id);
    const created = await createListing(owner.agent);
    const listingId = created.body.data.listing.id as string;

    let auditInsertIntercepted = false;
    const transactionProxy = (transaction: object) =>
      new Proxy(transaction, {
        get(target, property) {
          const value = Reflect.get(target, property, target);
          if (property !== "insert" || typeof value !== "function") {
            return typeof value === "function" ? value.bind(target) : value;
          }

          return (table: unknown) => {
            const builder = Reflect.apply(value, target, [table]) as object;
            if (table !== adminAuditLogs) {
              return builder;
            }

            return new Proxy(builder, {
              get(builderTarget, builderProperty) {
                const builderValue = Reflect.get(
                  builderTarget,
                  builderProperty,
                  builderTarget,
                );
                if (
                  builderProperty !== "values" ||
                  typeof builderValue !== "function"
                ) {
                  return typeof builderValue === "function"
                    ? builderValue.bind(builderTarget)
                    : builderValue;
                }

                return (values: object) => {
                  const auditValues = values as {
                    serviceListingId?: unknown;
                    action?: unknown;
                  };
                  if (
                    auditValues.serviceListingId === listingId &&
                    auditValues.action === "hide_service_listing"
                  ) {
                    auditInsertIntercepted = true;
                    return Reflect.apply(builderValue, builderTarget, [
                      { ...values, serviceListingReason: "short" },
                    ]);
                  }
                  return Reflect.apply(builderValue, builderTarget, [values]);
                };
              },
            });
          };
        },
      });
    const databaseProxy = new Proxy(db, {
      get(target, property) {
        const value = Reflect.get(target, property, target);
        if (property !== "transaction" || typeof value !== "function") {
          return typeof value === "function" ? value.bind(target) : value;
        }

        return (callback: unknown, ...args: unknown[]) =>
          Reflect.apply(value, target, [
            (transaction: object) =>
              Reflect.apply(
                callback as (transaction: object) => unknown,
                null,
                [transactionProxy(transaction)],
              ),
            ...args,
          ]);
      },
    });
    const moderationError = await new PostgresServiceListingRepository(
      databaseProxy,
    )
      .moderate(listingId, admin.id, 1, "hide", "Controlled rollback reason.")
      .catch((error: unknown) => error);

    expect(auditInsertIntercepted).toBe(true);
    let postgresError: unknown = moderationError;
    while (
      typeof postgresError === "object" &&
      postgresError !== null &&
      !("code" in postgresError) &&
      "cause" in postgresError
    ) {
      postgresError = postgresError.cause;
    }
    expect(postgresError).toMatchObject({
      code: "23514",
      constraint: "admin_audit_logs_service_listing_reason_check",
    });

    const [listing] = await db
      .select({
        moderationStatus: serviceListings.moderationStatus,
        version: serviceListings.version,
      })
      .from(serviceListings)
      .where(eq(serviceListings.id, listingId));
    const auditRows = await db
      .select({ id: adminAuditLogs.id })
      .from(adminAuditLogs)
      .where(eq(adminAuditLogs.serviceListingId, listingId));
    expect(listing).toEqual({ moderationStatus: "visible", version: 1 });
    expect(auditRows).toEqual([]);
  });

  it("rechecks admin eligibility after waiting for a concurrent suspension", async () => {
    const admin = await createUser("admin-suspension-race", "admin");
    const owner = await createUser(
      "owner-suspension-race",
      "professional",
      admin.id,
    );
    const created = await createListing(owner.agent);
    const listingId = created.body.data.listing.id as string;

    // Confirm the request would pass route authorization before the race.
    expect(
      (await admin.agent.get("/api/v1/admin/service-listings")).status,
    ).toBe(200);

    const suspension = await pool.connect();
    let suspensionOpen = false;
    let moderation: Promise<unknown> | undefined;
    try {
      await suspension.query("BEGIN");
      suspensionOpen = true;
      await suspension.query(
        "UPDATE users SET status = 'suspended' WHERE id = $1",
        [admin.id],
      );
      const pidResult = await suspension.query<{ pid: number }>(
        "SELECT pg_backend_pid() AS pid",
      );
      const blockingPid = pidResult.rows[0]?.pid;
      if (blockingPid === undefined) {
        throw new Error("Could not identify the suspension transaction.");
      }

      const repository = new PostgresServiceListingRepository(
        db,
        (auditId, auditedListingId) =>
          trackInsertedModerationAudit(
            trackedAuditIds,
            auditId,
            auditedListingId,
          ),
      );
      moderation = repository.moderate(
        listingId,
        admin.id,
        1,
        "hide",
        "Concurrent suspension test reason.",
      );
      await waitForDatabaseBlocker(blockingPid);
      await suspension.query("COMMIT");
      suspensionOpen = false;

      expect(await moderation).toEqual({ type: "actor_ineligible" });
      const [listing] = await db
        .select({
          moderationStatus: serviceListings.moderationStatus,
          version: serviceListings.version,
        })
        .from(serviceListings)
        .where(eq(serviceListings.id, listingId));
      expect(listing).toEqual({ moderationStatus: "visible", version: 1 });
      expect(
        await db
          .select({ id: adminAuditLogs.id })
          .from(adminAuditLogs)
          .where(eq(adminAuditLogs.serviceListingId, listingId)),
      ).toEqual([]);
    } finally {
      if (suspensionOpen) {
        await suspension.query("ROLLBACK");
      }
      if (moderation) {
        await moderation.catch(() => undefined);
      }
      suspension.release();
    }
  });

  it("atomically hides/restores with audit records and serializes stale moderation", async () => {
    const admin = await createUser("admin-moderation", "admin");
    const owner = await createUser(
      "owner-moderation",
      "professional",
      admin.id,
    );
    const created = await createListing(owner.agent);
    const id = created.body.data.listing.id as string;
    const ownerToken = await csrf(owner.agent);
    const published = await postAction(
      owner.agent,
      `/api/v1/professional/service-listings/${id}/publish`,
      ownerToken,
      created.headers.etag as string,
    );
    expect(published.status).toBe(200);
    const adminRead = await admin.agent.get(
      `/api/v1/admin/service-listings/${id}`,
    );
    expect(adminRead.status).toBe(200);
    expect(adminRead.body.data.listing).not.toHaveProperty(
      "professionalProfileId",
    );
    expect(
      (await owner.agent.get(`/api/v1/admin/service-listings/${id}`)).status,
    ).toBe(403);
    const adminToken = await csrf(admin.agent);
    const hidePath = `/api/v1/admin/service-listings/${id}/hide`;
    const invalidReason = await postAction(
      admin.agent,
      hidePath,
      adminToken,
      adminRead.headers.etag as string,
      { reason: "   " },
    );
    expect(invalidReason.status).toBe(400);
    const concurrentHide = await Promise.all([
      postAction(
        admin.agent,
        hidePath,
        adminToken,
        adminRead.headers.etag as string,
        { reason: "Content needs policy review." },
      ),
      postAction(
        admin.agent,
        hidePath,
        adminToken,
        adminRead.headers.etag as string,
        { reason: "Content needs policy review." },
      ),
    ]);
    expect(concurrentHide.map((response) => response.status).sort()).toEqual([
      200, 412,
    ]);

    const hiddenResponse = await request(app).get(
      `/api/v1/service-listings/${id}`,
    );
    expect(hiddenResponse.status).toBe(404);
    const hiddenPublicPage = await request(app).get(
      "/api/v1/service-listings?city=Pune",
    );
    expect(
      hiddenPublicPage.body.data.listings.map(
        (listing: { id: string }) => listing.id,
      ),
    ).not.toContain(id);
    const ownerRead = await getOwnerListing(owner.agent, id);
    expect(ownerRead.body.data.listing.moderationStatus).toBe("hidden");

    const providerToken = await csrf(owner.agent);
    const deniedPublish = await postAction(
      owner.agent,
      `/api/v1/professional/service-listings/${id}/publish`,
      providerToken,
      ownerRead.headers.etag as string,
    );
    expect(deniedPublish.status).toBe(409);

    const unpublishHidden = await postAction(
      owner.agent,
      `/api/v1/professional/service-listings/${id}/unpublish`,
      providerToken,
      ownerRead.headers.etag as string,
    );
    expect(unpublishHidden.status).toBe(200);
    expect(unpublishHidden.body.data.listing).toMatchObject({
      publicationStatus: "draft",
      moderationStatus: "hidden",
    });

    const restore = await postAction(
      admin.agent,
      `/api/v1/admin/service-listings/${id}/restore`,
      adminToken,
      unpublishHidden.headers.etag as string,
    );
    expect(restore.status).toBe(200);
    expect(restore.body.data.listing).toMatchObject({
      publicationStatus: "draft",
      moderationStatus: "visible",
    });
    expect(
      (await request(app).get(`/api/v1/service-listings/${id}`)).status,
    ).toBe(404);

    const auditRows = await db
      .select({
        action: adminAuditLogs.action,
        actorUserId: adminAuditLogs.actorUserId,
        actorUserIdSnapshot: adminAuditLogs.actorUserIdSnapshot,
        serviceListingId: adminAuditLogs.serviceListingId,
        serviceListingReason: adminAuditLogs.serviceListingReason,
      })
      .from(adminAuditLogs)
      .where(eq(adminAuditLogs.serviceListingId, id));
    expect(auditRows).toHaveLength(2);
    expect(auditRows.map((row) => row.action).sort()).toEqual([
      "hide_service_listing",
      "restore_service_listing",
    ]);
    for (const row of auditRows) {
      expect(row.actorUserId).toBe(admin.id);
      expect(row.actorUserIdSnapshot).toBe(admin.id);
      expect(row.serviceListingId).toBe(id);
    }
    expect(
      auditRows.find((row) => row.action === "hide_service_listing")
        ?.serviceListingReason,
    ).toBe("Content needs policy review.");

    const secondListing = await createListing(owner.agent);
    const otherId = secondListing.body.data.listing.id as string;
    const stale = await postAction(
      admin.agent,
      `/api/v1/admin/service-listings/${otherId}/hide`,
      adminToken,
      '"invalid-etag"',
      { reason: "Another valid moderation reason." },
    );
    expect(stale.status).toBe(412);

    const [storedSecond] = await db
      .select({ version: serviceListings.version })
      .from(serviceListings)
      .where(eq(serviceListings.id, otherId));
    expect(storedSecond?.version).toBe(1);
  });

  it("paginates and filters the admin queue and denies non-admin access", async () => {
    const admin = await createUser("admin-queue", "admin");
    const owner = await createUser("owner-queue", "professional", admin.id);
    const customer = await createUser("customer-queue", "customer");
    const city = `Queue ${randomUUID().slice(0, 8)}`;
    const first = await createListing(owner.agent, { city });
    const second = await createListing(owner.agent, { city });
    const firstId = first.body.data.listing.id as string;
    const secondId = second.body.data.listing.id as string;
    const ownerToken = await csrf(owner.agent);
    const published = await postAction(
      owner.agent,
      `/api/v1/professional/service-listings/${firstId}/publish`,
      ownerToken,
      first.headers.etag as string,
    );
    expect(published.status).toBe(200);
    const adminToken = await csrf(admin.agent);
    const hidden = await postAction(
      admin.agent,
      `/api/v1/admin/service-listings/${firstId}/hide`,
      adminToken,
      published.headers.etag as string,
      { reason: "Queue review requires additional context." },
    );
    expect(hidden.status).toBe(200);

    expect(
      (await request(app).get("/api/v1/admin/service-listings")).status,
    ).toBe(401);
    expect(
      (await owner.agent.get("/api/v1/admin/service-listings")).status,
    ).toBe(403);
    expect(
      (await customer.agent.get("/api/v1/admin/service-listings")).status,
    ).toBe(403);

    const pageOne = await admin.agent.get(
      `/api/v1/admin/service-listings?pageSize=1&city=${encodeURIComponent(city)}`,
    );
    expect(pageOne.status).toBe(200);
    expect(pageOne.body.data.pagination).toMatchObject({
      page: 1,
      pageSize: 1,
      total: 2,
    });
    expect(pageOne.body.data.listings).toHaveLength(1);
    const pageTwo = await admin.agent.get(
      `/api/v1/admin/service-listings?page=2&pageSize=1&city=${encodeURIComponent(city)}`,
    );
    expect(pageTwo.status).toBe(200);
    expect(pageTwo.body.data.listings).toHaveLength(1);
    expect(pageTwo.body.data.listings[0].id).not.toBe(
      pageOne.body.data.listings[0].id,
    );

    const hiddenFilter = await admin.agent.get(
      `/api/v1/admin/service-listings?city=${encodeURIComponent(city)}&publicationStatus=published&moderationStatus=hidden`,
    );
    expect(hiddenFilter.status).toBe(200);
    expect(hiddenFilter.body.data.pagination.total).toBe(1);
    expect(hiddenFilter.body.data.listings[0]).toMatchObject({
      id: firstId,
      moderationReason: "Queue review requires additional context.",
      provider: { displayName: "owner-queue Events" },
    });
    expect(hiddenFilter.body.data.listings[0]).not.toHaveProperty("email");
    expect(hiddenFilter.body.data.listings[0]).not.toHaveProperty("userId");

    const draftFilter = await admin.agent.get(
      `/api/v1/admin/service-listings?city=${encodeURIComponent(city)}&publicationStatus=draft&moderationStatus=visible`,
    );
    expect(draftFilter.status).toBe(200);
    expect(
      draftFilter.body.data.listings.map(
        (listing: { id: string }) => listing.id,
      ),
    ).toEqual([secondId]);
    expect(
      (
        await admin.agent.get(
          "/api/v1/admin/service-listings?moderationStatus=unknown",
        )
      ).status,
    ).toBe(400);
  });

  it("shows moderation reasons only to the listing owner and administrators", async () => {
    const admin = await createUser("admin-reason", "admin");
    const owner = await createUser("owner-reason", "professional", admin.id);
    const unrelated = await createUser(
      "unrelated-reason",
      "professional",
      admin.id,
    );
    const city = `Reason ${randomUUID().slice(0, 8)}`;
    const created = await createListing(owner.agent, { city });
    const listingId = created.body.data.listing.id as string;
    const ownerToken = await csrf(owner.agent);
    const published = await postAction(
      owner.agent,
      `/api/v1/professional/service-listings/${listingId}/publish`,
      ownerToken,
      created.headers.etag as string,
    );
    expect(published.status).toBe(200);
    const adminToken = await csrf(admin.agent);
    const reason = "Please update the service description.";
    const hidden = await postAction(
      admin.agent,
      `/api/v1/admin/service-listings/${listingId}/hide`,
      adminToken,
      published.headers.etag as string,
      { reason },
    );
    expect(hidden.status).toBe(200);

    const ownerRead = await getOwnerListing(owner.agent, listingId);
    expect(ownerRead.status).toBe(200);
    expect(ownerRead.body.data.listing.moderationReason).toBe(reason);
    const adminRead = await admin.agent.get(
      `/api/v1/admin/service-listings/${listingId}`,
    );
    expect(adminRead.status).toBe(200);
    expect(adminRead.body.data.listing.moderationReason).toBe(reason);
    expect((await getOwnerListing(unrelated.agent, listingId)).status).toBe(
      404,
    );
    const unrelatedList = await unrelated.agent.get(
      "/api/v1/professional/service-listings",
    );
    expect(unrelatedList.status).toBe(200);
    expect(JSON.stringify(unrelatedList.body)).not.toContain(reason);

    const publicDetail = await request(app).get(
      `/api/v1/service-listings/${listingId}`,
    );
    expect(publicDetail.status).toBe(404);
    const publicPage = await request(app).get(
      `/api/v1/service-listings?city=${encodeURIComponent(city)}`,
    );
    expect(publicPage.status).toBe(200);
    expect(JSON.stringify(publicPage.body)).not.toContain(reason);
    expect(publicPage.body.data.listings).toEqual([]);
  });
});
