import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import { and, eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../app.js";
import * as schema from "../../db/schema.js";
import {
  bookingRequests,
  bookingStatusHistory,
  conversations,
  messages,
  notifications,
  professionalProfiles,
  providerApplications,
  serviceListings,
  sessions,
  users,
} from "../../db/schema.js";
import { PostgresRateLimitStore } from "../../middleware/postgres-rate-limit-store.js";
import { createPostgresSessionStore } from "../../middleware/sessions.js";
import { PostgresUserRepository } from "../auth/repository.js";
import { UnconfiguredEmailDelivery } from "../auth/email-delivery.js";
import { PasswordAuthService } from "../auth/service.js";
import {
  assertIntegrationDatabaseTarget,
  requireIntegrationDatabaseUrl,
  verifyIntegrationDatabase,
} from "../../testing/integration-database.js";
import { PostgresBookingRequestRepository } from "./repository.js";
import { MarketplaceBookingService } from "./service.js";

const integrationDatabaseUrl = requireIntegrationDatabaseUrl();
const integrationDatabaseMode = assertIntegrationDatabaseTarget(
  integrationDatabaseUrl,
  process.env,
);
const isApprovedLocalDatabase =
  integrationDatabaseMode === "local" &&
  new URL(integrationDatabaseUrl).pathname === "/evently_verify_clean";
if (integrationDatabaseMode !== "ci" && !isApprovedLocalDatabase) {
  throw new Error(
    "Booking integration tests require evently_test in CI or evently_verify_clean locally.",
  );
}

const pool = new Pool({
  connectionString: integrationDatabaseUrl,
  connectionTimeoutMillis: 3000,
});
const db = drizzle(pool, { schema });
const fixturePrefix = `booking-it-${randomUUID()}`;
const password = "booking-integration-password";
const appOrigin = "http://127.0.0.1:5173";
const sessionStore = createPostgresSessionStore(pool, false);
const rateLimitStores: PostgresRateLimitStore[] = [];
const loginAgents = new Map<string, LoggedInAgent>();
const userIds: string[] = [];
const profileIds: string[] = [];
const applicationIds: string[] = [];
const listingIds: string[] = [];
const bookingIds = new Set<string>();
let fixturePasswordHash = "";
let adminUserId = "";
let customerUserId = "";
let secondCustomerUserId = "";
let professionalUserId = "";
let secondProfessionalUserId = "";
let listingId = "";
let safeDatabaseConfirmed = false;

type NotificationFailureInjection =
  | {
      kind: "creation";
      professionalUserId: string;
      missingRecipientUserId: string;
      reached: boolean;
      attemptedBookingRequestId?: string;
    }
  | {
      kind: "decision";
      bookingRequestId: string;
      missingRecipientUserId: string;
      reached: boolean;
      attemptedBookingRequestId?: string;
    };

let notificationFailureInjection: NotificationFailureInjection | undefined;

function isNotificationInsertValue(value: unknown): value is {
  bookingRequestId: string;
  recipientUserId: string;
  type: string;
} {
  return (
    typeof value === "object" &&
    value !== null &&
    "bookingRequestId" in value &&
    typeof value.bookingRequestId === "string" &&
    "recipientUserId" in value &&
    typeof value.recipientUserId === "string" &&
    "type" in value &&
    typeof value.type === "string"
  );
}

function shouldFailNotificationInsert(
  value: unknown,
  injection: NotificationFailureInjection,
): value is {
  bookingRequestId: string;
  recipientUserId: string;
  type: string;
} {
  if (!isNotificationInsertValue(value)) {
    return false;
  }
  return injection.kind === "creation"
    ? value.type === "booking_request_received" &&
        value.recipientUserId === injection.professionalUserId
    : value.type === "booking_request_accepted" &&
        value.bookingRequestId === injection.bookingRequestId;
}

function wrapTransactionForNotificationFailure(transaction: object): object {
  return new Proxy(transaction, {
    get(target, property) {
      const member = Reflect.get(target, property, target);
      if (property !== "insert" || typeof member !== "function") {
        return typeof member === "function" ? member.bind(target) : member;
      }
      return (...args: unknown[]) => {
        const builder = Reflect.apply(member, target, args);
        if (args[0] !== notifications) {
          return builder;
        }
        if (typeof builder !== "object" || builder === null) {
          return builder;
        }
        return new Proxy(builder, {
          get(builderTarget, builderProperty) {
            const builderMember = Reflect.get(
              builderTarget,
              builderProperty,
              builderTarget,
            );
            if (
              builderProperty !== "values" ||
              typeof builderMember !== "function"
            ) {
              return typeof builderMember === "function"
                ? builderMember.bind(builderTarget)
                : builderMember;
            }
            return (values: unknown) => {
              const injection = notificationFailureInjection;
              const valuesArray = Array.isArray(values) ? values : [values];
              let didInject = false;
              const rewrittenValues = valuesArray.map((value: unknown) => {
                if (
                  !injection ||
                  !shouldFailNotificationInsert(value, injection)
                ) {
                  return value;
                }
                didInject = true;
                injection.reached = true;
                injection.attemptedBookingRequestId = value.bookingRequestId;
                return {
                  ...value,
                  recipientUserId: injection.missingRecipientUserId,
                };
              });
              const forwardedValues = Array.isArray(values)
                ? rewrittenValues
                : rewrittenValues[0];
              if (!didInject) {
                return Reflect.apply(builderMember, builderTarget, [values]);
              }
              return Reflect.apply(builderMember, builderTarget, [
                forwardedValues,
              ]);
            };
          },
        });
      };
    },
  });
}

const bookingDatabase = new Proxy(db, {
  get(target, property) {
    const member = Reflect.get(target, property, target);
    if (property !== "transaction" || typeof member !== "function") {
      return typeof member === "function" ? member.bind(target) : member;
    }
    return new Proxy(member, {
      apply(transactionMethod, _thisArgument, args: unknown[]) {
        const injection = notificationFailureInjection;
        const callback = args[0];
        if (!injection || typeof callback !== "function") {
          return Reflect.apply(transactionMethod, target, args);
        }
        const wrappedCallback = (transaction: object) =>
          Reflect.apply(callback, undefined, [
            wrapTransactionForNotificationFailure(transaction),
          ]);
        return Reflect.apply(transactionMethod, target, [
          wrappedCallback,
          ...args.slice(1),
        ]);
      },
    });
  },
});

const app = createApp(pool, {
  service: new PasswordAuthService(
    new PostgresUserRepository(db),
    new UnconfiguredEmailDelivery(),
  ),
  bookingService: new MarketplaceBookingService(
    new PostgresBookingRequestRepository(bookingDatabase),
  ),
  environment: "test",
  sessionStore,
  sessionSecret: "booking-integration-session-secret-at-least-32-characters",
  appOrigin,
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
    rateLimitStores.push(store);
    return store;
  },
});

type TestAgent = ReturnType<typeof request.agent>;
interface LoggedInAgent {
  agent: TestAgent;
  csrfToken: string;
}

function csrfHeaders(token: string) {
  return { Origin: appOrigin, "X-CSRF-Token": token };
}

async function createUser(
  name: string,
  role: "customer" | "professional" | "admin",
  passwordHash: string,
  options: {
    status?: "active" | "suspended" | "deactivated";
    emailVerifiedAt?: Date | null;
  } = {},
): Promise<string> {
  const id = randomUUID();
  userIds.push(id);
  await db.insert(users).values({
    id,
    email: `${fixturePrefix}-${name}@example.test`,
    passwordHash,
    role,
    status: options.status ?? "active",
    emailVerifiedAt:
      options.emailVerifiedAt === undefined
        ? new Date()
        : options.emailVerifiedAt,
  });
  return id;
}

async function createProfessional(
  name: string,
  userId: string,
  reviewerId: string,
  approved = true,
): Promise<void> {
  if (approved) {
    const applicationId = randomUUID();
    applicationIds.push(applicationId);
    const reviewedAt = new Date();
    await db.insert(providerApplications).values({
      id: applicationId,
      userId,
      displayName: `${name} Events`,
      description: "Approved provider fixture for booking integration tests.",
      city: "Pune",
      country: "India",
      status: "approved",
      reviewerUserId: reviewerId,
      reviewedAt,
    });
  }
  const profileId = randomUUID();
  profileIds.push(profileId);
  await db.insert(professionalProfiles).values({
    id: profileId,
    userId,
    displayName: `${name} Events`,
    slug: `${fixturePrefix}-${name}`,
    city: "Pune",
    country: "India",
  });
}

async function createListing(
  id: string,
  professionalProfileId: string,
  options: {
    publicationStatus?: "draft" | "published";
    hidden?: boolean;
  } = {},
): Promise<void> {
  const hidden = options.hidden ?? false;
  await db.insert(serviceListings).values({
    id,
    professionalProfileId,
    categorySlug: "planning_coordination",
    title: "Community event planning",
    description: "Planning and coordination for local community events.",
    city: "Pune",
    region: "Maharashtra",
    pricingMethod: "fixed",
    priceAmountPaise: 125_000,
    currency: "INR",
    publicationStatus: options.publicationStatus ?? "published",
    moderationStatus: hidden ? "hidden" : "visible",
    moderationHiddenByUserId: hidden ? adminUserId : null,
    moderationHiddenAt: hidden ? new Date() : null,
    moderationReason: hidden ? "Test moderation reason." : null,
  });
}

async function expectNoBookingEffects(
  customerId: string,
  idempotencyKey: string,
  possibleRequestId?: unknown,
): Promise<void> {
  if (typeof possibleRequestId === "string") {
    bookingIds.add(possibleRequestId);
  }
  const requests = await db
    .select({ id: bookingRequests.id })
    .from(bookingRequests)
    .where(
      and(
        eq(bookingRequests.customerUserId, customerId),
        eq(bookingRequests.idempotencyKey, idempotencyKey),
      ),
    );
  for (const row of requests) {
    bookingIds.add(row.id);
  }
  const history = await db
    .select({
      id: bookingStatusHistory.id,
      bookingRequestId: bookingRequests.id,
    })
    .from(bookingStatusHistory)
    .innerJoin(
      bookingRequests,
      eq(bookingStatusHistory.bookingRequestId, bookingRequests.id),
    )
    .where(
      and(
        eq(bookingRequests.customerUserId, customerId),
        eq(bookingRequests.idempotencyKey, idempotencyKey),
      ),
    );
  for (const row of history) {
    bookingIds.add(row.bookingRequestId);
  }
  const notificationRows = await db
    .select({ id: notifications.id, bookingRequestId: bookingRequests.id })
    .from(notifications)
    .innerJoin(
      bookingRequests,
      eq(notifications.bookingRequestId, bookingRequests.id),
    )
    .where(
      and(
        eq(bookingRequests.customerUserId, customerId),
        eq(bookingRequests.idempotencyKey, idempotencyKey),
      ),
    );
  for (const row of notificationRows) {
    bookingIds.add(row.bookingRequestId);
  }
  expect(requests).toHaveLength(0);
  expect(history).toHaveLength(0);
  expect(notificationRows).toHaveLength(0);
}

async function expectNoRequestChildren(requestId: string): Promise<void> {
  const conversationRows = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(eq(conversations.bookingRequestId, requestId));
  const messageRows = await db
    .select({ id: messages.id })
    .from(messages)
    .innerJoin(conversations, eq(messages.conversationId, conversations.id))
    .where(eq(conversations.bookingRequestId, requestId));
  const history = await db
    .select({ id: bookingStatusHistory.id })
    .from(bookingStatusHistory)
    .where(eq(bookingStatusHistory.bookingRequestId, requestId));
  const notificationRows = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(eq(notifications.bookingRequestId, requestId));
  expect(history).toHaveLength(0);
  expect(notificationRows).toHaveLength(0);
  expect(conversationRows).toHaveLength(0);
  expect(messageRows).toHaveLength(0);
}

async function createMissingUserId(): Promise<string> {
  const id = randomUUID();
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);
  expect(existing).toHaveLength(0);
  return id;
}

async function login(
  userId: string,
  createFreshSession = false,
): Promise<LoggedInAgent> {
  const cachedAgent = loginAgents.get(userId);
  if (!createFreshSession && cachedAgent) {
    return cachedAgent;
  }
  const [user] = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) {
    throw new Error("Booking integration user fixture is missing");
  }
  const agent = request.agent(app);
  const csrfResponse = await agent.get("/api/v1/auth/csrf");
  const loginResponse = await agent
    .post("/api/v1/auth/login")
    .set(csrfHeaders(csrfResponse.body.data.csrfToken as string))
    .send({ email: user.email, password });
  if (loginResponse.status !== 200) {
    throw new Error("Could not authenticate booking integration fixture");
  }
  const loggedInAgent = {
    agent,
    csrfToken: loginResponse.body.data.csrfToken as string,
  };
  if (!createFreshSession) {
    loginAgents.set(userId, loggedInAgent);
  }
  return loggedInAgent;
}

function createInput(idempotencyKey = randomUUID()) {
  return {
    serviceListingId: listingId,
    idempotencyKey,
    eventType: "Community festival",
    eventDate: "2099-12-31",
    eventTimezone: "Asia/Kolkata",
    eventLocation: { city: "Pune", region: "Maharashtra" },
    guestCount: 120,
    budgetMinAmountPaise: 50_000,
    budgetMaxAmountPaise: 200_000,
    additionalNotes: "Please include accessible seating arrangements.",
  };
}

async function createRequestAs(
  actor: LoggedInAgent,
  input: ReturnType<typeof createInput>,
) {
  const response = await actor.agent
    .post("/api/v1/booking-requests")
    .set(csrfHeaders(actor.csrfToken))
    .send(input);
  const requestId = response.body.data?.bookingRequest?.id;
  if (typeof requestId === "string") {
    bookingIds.add(requestId);
  }
  return response;
}

type TestResponse = Awaited<ReturnType<typeof createRequestAs>>;

beforeAll(async () => {
  await verifyIntegrationDatabase(
    integrationDatabaseUrl,
    pool,
    process.env,
    integrationDatabaseUrl,
  );
  safeDatabaseConfirmed = true;

  fixturePasswordHash = await argon2.hash(password);
  const passwordHash = fixturePasswordHash;
  adminUserId = await createUser("admin", "admin", passwordHash);
  customerUserId = await createUser("customer", "customer", passwordHash);
  secondCustomerUserId = await createUser(
    "customer-two",
    "customer",
    passwordHash,
  );
  professionalUserId = await createUser(
    "professional",
    "professional",
    passwordHash,
  );
  secondProfessionalUserId = await createUser(
    "professional-two",
    "professional",
    passwordHash,
  );
  await createProfessional("professional", professionalUserId, adminUserId);
  await createProfessional(
    "professional-two",
    secondProfessionalUserId,
    adminUserId,
  );

  const profileId = profileIds[0];
  if (!profileId) {
    throw new Error("Booking integration provider profile was not created");
  }
  listingId = randomUUID();
  listingIds.push(listingId);
  await createListing(listingId, profileId);
});

afterAll(async () => {
  try {
    if (safeDatabaseConfirmed) {
      const fixtureBookingIds = [...bookingIds];
      await db.transaction(async (transaction) => {
        if (fixtureBookingIds.length > 0) {
          const fixtureConversations = await transaction
            .select({ id: conversations.id })
            .from(conversations)
            .where(inArray(conversations.bookingRequestId, fixtureBookingIds));
          const conversationIds = fixtureConversations.map(({ id }) => id);
          await transaction
            .delete(notifications)
            .where(inArray(notifications.bookingRequestId, fixtureBookingIds));
          if (conversationIds.length > 0) {
            await transaction
              .delete(messages)
              .where(inArray(messages.conversationId, conversationIds));
          }
          await transaction
            .delete(conversations)
            .where(inArray(conversations.bookingRequestId, fixtureBookingIds));
          await transaction
            .delete(bookingStatusHistory)
            .where(
              inArray(bookingStatusHistory.bookingRequestId, fixtureBookingIds),
            );
          await transaction
            .delete(bookingRequests)
            .where(inArray(bookingRequests.id, fixtureBookingIds));
        }
        if (listingIds.length > 0) {
          await transaction
            .delete(serviceListings)
            .where(inArray(serviceListings.id, listingIds));
        }
        if (profileIds.length > 0) {
          await transaction
            .delete(professionalProfiles)
            .where(inArray(professionalProfiles.id, profileIds));
        }
        if (applicationIds.length > 0) {
          await transaction
            .delete(providerApplications)
            .where(inArray(providerApplications.id, applicationIds));
        }
        for (const userId of userIds) {
          await transaction
            .delete(sessions)
            .where(sql`${sessions.sess}->>'userId' = ${userId}`);
        }
        if (userIds.length > 0) {
          await transaction.delete(users).where(inArray(users.id, userIds));
        }
      });
      await Promise.all(rateLimitStores.map((store) => store.clear()));
    }
  } finally {
    try {
      sessionStore.close();
    } finally {
      await pool.end();
    }
  }
});

afterEach(async () => {
  if (safeDatabaseConfirmed) {
    for (const store of rateLimitStores) {
      await store.clear();
    }
  }
});

describe("booking request API integration", () => {
  it("validates creation, blocks inaccessible reads, and returns explicit safe DTOs", async () => {
    const customer = await login(customerUserId);
    const secondCustomer = await login(secondCustomerUserId);
    const provider = await login(professionalUserId);
    const secondProvider = await login(secondProfessionalUserId);

    await createProfessional("customer-owned", customerUserId, adminUserId);
    const customerProfileId = profileIds.at(-1);
    if (!customerProfileId) {
      throw new Error("Booking integration customer profile is missing");
    }
    const customerListingId = randomUUID();
    listingIds.push(customerListingId);
    await createListing(customerListingId, customerProfileId);
    const selfRequest = await createRequestAs(customer, {
      ...createInput(),
      serviceListingId: customerListingId,
    });
    expect(selfRequest.status).toBe(409);
    expect(selfRequest.body.error.code).toBe("SELF_REQUEST_NOT_ALLOWED");

    const unauthenticated = await request(app).get(
      "/api/v1/booking-requests/me",
    );
    expect(unauthenticated.status).toBe(401);

    const invalid = await customer.agent
      .post("/api/v1/booking-requests")
      .set(csrfHeaders(customer.csrfToken))
      .send({ ...createInput(), customerUserId });
    expect(invalid.status).toBe(400);

    const missingListing = await createRequestAs(customer, {
      ...createInput(),
      serviceListingId: randomUUID(),
    });
    expect(missingListing.status).toBe(404);

    const noCsrf = await customer.agent
      .post("/api/v1/booking-requests")
      .send(createInput());
    expect(noCsrf.status).toBe(403);

    const created = await createRequestAs(customer, createInput());
    const createdId = created.body.data?.bookingRequest?.id;
    if (typeof createdId === "string") {
      bookingIds.add(createdId);
    }
    expect(created.status).toBe(201);
    const bookingRequest = created.body.data.bookingRequest;
    expect(bookingRequest.status).toBe("requested");
    expect(bookingRequest.service).toMatchObject({
      title: "Community event planning",
      city: "Pune",
      region: "Maharashtra",
      pricingMethod: "fixed",
      priceAmountPaise: 125_000,
      currency: "INR",
    });
    expect(bookingRequest.statusHistory).toHaveLength(1);
    expect(bookingRequest.cancellation).toBeNull();
    const conversationRows = await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(eq(conversations.bookingRequestId, bookingRequest.id as string));
    expect(conversationRows).toHaveLength(1);
    expect(created.text).not.toContain("passwordHash");
    expect(created.text).not.toContain("moderationReason");
    expect(bookingRequest).not.toHaveProperty("customerEmail");

    const ownDetail = await customer.agent.get(
      `/api/v1/booking-requests/${bookingRequest.id}`,
    );
    expect(ownDetail.status).toBe(200);
    const ownList = await customer.agent.get(
      "/api/v1/booking-requests/me?page=1&pageSize=5",
    );
    expect(ownList.status).toBe(200);
    expect(
      ownList.body.data.bookingRequests.map((item: { id: string }) => item.id),
    ).toContain(bookingRequest.id);
    expect(
      (
        await secondCustomer.agent.get(
          `/api/v1/booking-requests/${bookingRequest.id}`,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await secondProvider.agent.get(
          `/api/v1/professional/booking-requests/${bookingRequest.id}`,
        )
      ).status,
    ).toBe(404);
    expect(
      (await customer.agent.get("/api/v1/professional/booking-requests"))
        .status,
    ).toBe(403);
    expect(
      (
        await provider.agent.get(
          "/api/v1/professional/booking-requests?status=requested&pageSize=5",
        )
      ).body.data.bookingRequests.map((item: { id: string }) => item.id),
    ).toContain(bookingRequest.id);

    const providerNotification = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.bookingRequestId, bookingRequest.id as string),
          eq(notifications.recipientUserId, professionalUserId),
        ),
      );
    expect(providerNotification).toHaveLength(1);
    const notificationId = providerNotification[0]?.id;
    expect(notificationId).toBeTruthy();
    const unreadNotifications = await provider.agent.get(
      "/api/v1/notifications?unreadOnly=true",
    );
    expect(unreadNotifications.status).toBe(200);
    expect(
      unreadNotifications.body.data.notifications.map(
        (item: { id: string }) => item.id,
      ),
    ).toContain(notificationId);
    const wrongOwnerRead = await secondCustomer.agent
      .post(`/api/v1/notifications/${notificationId}/read`)
      .set(csrfHeaders(secondCustomer.csrfToken))
      .send({});
    expect(wrongOwnerRead.status).toBe(404);
    const ownRead = await provider.agent
      .post(`/api/v1/notifications/${notificationId}/read`)
      .set(csrfHeaders(provider.csrfToken))
      .send({});
    expect(ownRead.status).toBe(200);
    expect(ownRead.body.data.notification.readAt).toBeTruthy();
  });

  it("rolls back request and initial records when provider notification insertion fails", async () => {
    const customer = await login(customerUserId);
    const rollbackProfessionalUserId = await createUser(
      "creation-rollback-professional",
      "professional",
      fixturePasswordHash,
    );
    await createProfessional(
      "creation-rollback-professional",
      rollbackProfessionalUserId,
      adminUserId,
    );
    const rollbackProfileId = profileIds.at(-1);
    if (!rollbackProfileId) {
      throw new Error("Creation rollback provider profile was not created");
    }
    const rollbackListingId = randomUUID();
    listingIds.push(rollbackListingId);
    await createListing(rollbackListingId, rollbackProfileId);
    const input = {
      ...createInput(),
      serviceListingId: rollbackListingId,
    };
    const injection: NotificationFailureInjection = {
      kind: "creation",
      professionalUserId: rollbackProfessionalUserId,
      missingRecipientUserId: await createMissingUserId(),
      reached: false,
    };

    let response: TestResponse | undefined;
    notificationFailureInjection = injection;
    try {
      response = await createRequestAs(customer, input);
    } finally {
      notificationFailureInjection = undefined;
    }

    const responseRequestId = response?.body.data?.bookingRequest?.id;
    if (typeof responseRequestId === "string") {
      bookingIds.add(responseRequestId);
    }
    const attemptedRequestId = injection.attemptedBookingRequestId;
    if (attemptedRequestId) {
      bookingIds.add(attemptedRequestId);
    }
    expect(injection.reached).toBe(true);
    expect(response?.status).toBe(409);
    expect(response?.body.error.code).toBe("BOOKING_REQUEST_CONSTRAINT_FAILED");
    await expectNoBookingEffects(
      customerUserId,
      input.idempotencyKey,
      responseRequestId,
    );

    expect(attemptedRequestId).toBeTruthy();
    if (attemptedRequestId) {
      await expectNoRequestChildren(attemptedRequestId);
    }
  });

  it("rolls back an acceptance when its notification insertion fails", async () => {
    const customer = await login(customerUserId);
    const provider = await login(professionalUserId);
    const created = await createRequestAs(customer, createInput());
    const requestId = created.body.data?.bookingRequest?.id;
    if (typeof requestId === "string") {
      bookingIds.add(requestId);
    }
    expect(created.status).toBe(201);
    if (typeof requestId !== "string") {
      throw new Error("Booking integration request fixture was not created");
    }

    const injection: NotificationFailureInjection = {
      kind: "decision",
      bookingRequestId: requestId,
      missingRecipientUserId: await createMissingUserId(),
      reached: false,
    };
    let response: TestResponse | undefined;
    notificationFailureInjection = injection;
    try {
      response = await provider.agent
        .post(`/api/v1/professional/booking-requests/${requestId}/accept`)
        .set(csrfHeaders(provider.csrfToken))
        .send({});
    } finally {
      notificationFailureInjection = undefined;
    }

    expect(injection.reached).toBe(true);
    expect(injection.attemptedBookingRequestId).toBe(requestId);
    expect(response?.status).toBe(409);
    expect(response?.body.error.code).toBe("BOOKING_REQUEST_CONSTRAINT_FAILED");

    const [stored] = await db
      .select({ status: bookingRequests.status })
      .from(bookingRequests)
      .where(eq(bookingRequests.id, requestId))
      .limit(1);
    const history = await db
      .select({ newStatus: bookingStatusHistory.newStatus })
      .from(bookingStatusHistory)
      .where(eq(bookingStatusHistory.bookingRequestId, requestId));
    const requestNotifications = await db
      .select({ type: notifications.type })
      .from(notifications)
      .where(eq(notifications.bookingRequestId, requestId));
    expect(stored?.status).toBe("requested");
    expect(history.map(({ newStatus }) => newStatus)).toEqual(["requested"]);
    expect(requestNotifications.map(({ type }) => type)).toEqual([
      "booking_request_received",
    ]);
  });

  it("rejects unverified and inactive customers without booking records", async () => {
    const customer = await login(secondCustomerUserId);
    const unverifiedInput = createInput();

    try {
      await db
        .update(users)
        .set({ emailVerifiedAt: null })
        .where(eq(users.id, secondCustomerUserId));
      const unverified = await createRequestAs(customer, unverifiedInput);
      expect(unverified.status).toBe(403);
      expect(unverified.body.error.code).toBe("EMAIL_VERIFICATION_REQUIRED");
      await expectNoBookingEffects(
        secondCustomerUserId,
        unverifiedInput.idempotencyKey,
        unverified.body.data?.bookingRequest?.id,
      );

      await db
        .update(users)
        .set({ emailVerifiedAt: new Date(), status: "suspended" })
        .where(eq(users.id, secondCustomerUserId));
      const inactiveInput = createInput();
      const inactive = await createRequestAs(customer, inactiveInput);
      expect(inactive.status).toBe(401);
      expect(inactive.body.error.code).toBe("UNAUTHENTICATED");
      await expectNoBookingEffects(
        secondCustomerUserId,
        inactiveInput.idempotencyKey,
        inactive.body.data?.bookingRequest?.id,
      );
    } finally {
      await db
        .update(users)
        .set({ emailVerifiedAt: new Date(), status: "active" })
        .where(eq(users.id, secondCustomerUserId));
      loginAgents.delete(secondCustomerUserId);
    }
  });

  it("rejects existing listings that are unpublished, hidden, inactive-owned, or unapproved-owned", async () => {
    const customer = await login(customerUserId);
    const draftListingId = randomUUID();
    const hiddenListingId = randomUUID();
    listingIds.push(draftListingId, hiddenListingId);
    const activeProfileId = profileIds[0];
    if (!activeProfileId) {
      throw new Error("Booking integration provider profile is missing");
    }
    await createListing(draftListingId, activeProfileId, {
      publicationStatus: "draft",
    });
    await createListing(hiddenListingId, activeProfileId, { hidden: true });

    const inactiveOwnerId = await createUser(
      "inactive-owner",
      "professional",
      fixturePasswordHash,
      { status: "suspended" },
    );
    await createProfessional("inactive-owner", inactiveOwnerId, adminUserId);
    const inactiveProfileId = profileIds.at(-1);
    if (!inactiveProfileId) {
      throw new Error("Inactive provider profile fixture was not created");
    }
    const inactiveOwnerListingId = randomUUID();
    listingIds.push(inactiveOwnerListingId);
    await createListing(inactiveOwnerListingId, inactiveProfileId);

    const unapprovedOwnerId = await createUser(
      "unapproved-owner",
      "professional",
      fixturePasswordHash,
    );
    await createProfessional(
      "unapproved-owner",
      unapprovedOwnerId,
      adminUserId,
      false,
    );
    const unapprovedProfileId = profileIds.at(-1);
    if (!unapprovedProfileId) {
      throw new Error("Unapproved provider profile fixture was not created");
    }
    const unapprovedOwnerListingId = randomUUID();
    listingIds.push(unapprovedOwnerListingId);
    await createListing(unapprovedOwnerListingId, unapprovedProfileId);

    for (const rejectedListingId of [
      draftListingId,
      hiddenListingId,
      inactiveOwnerListingId,
      unapprovedOwnerListingId,
    ]) {
      const input = {
        ...createInput(),
        serviceListingId: rejectedListingId,
      };
      const response = await createRequestAs(customer, input);
      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe("SERVICE_LISTING_NOT_FOUND");
      await expectNoBookingEffects(
        customerUserId,
        input.idempotencyKey,
        response.body.data?.bookingRequest?.id,
      );
    }
  });

  it("handles concurrent duplicate submissions and compares retries after listing deletion", async () => {
    const customer = await login(customerUserId);
    const concurrentCustomer = await login(customerUserId, true);
    const input = createInput();
    const [first, second] = await Promise.all([
      createRequestAs(customer, input),
      createRequestAs(concurrentCustomer, input),
    ]);
    for (const result of [first, second]) {
      const id = result.body.data?.bookingRequest?.id;
      if (typeof id === "string") {
        bookingIds.add(id);
      }
    }
    expect([first.status, second.status].sort()).toEqual([200, 201]);
    const firstRequest =
      first.status === 201
        ? first.body.data.bookingRequest
        : second.body.data.bookingRequest;
    const concurrentRequest =
      first.status === 200
        ? first.body.data.bookingRequest
        : second.body.data.bookingRequest;
    expect(firstRequest.id).toBe(concurrentRequest.id);

    const duplicateHistory = await db
      .select()
      .from(bookingStatusHistory)
      .where(eq(bookingStatusHistory.bookingRequestId, firstRequest.id));
    const duplicateNotifications = await db
      .select()
      .from(notifications)
      .where(eq(notifications.bookingRequestId, firstRequest.id));
    expect(duplicateHistory).toHaveLength(1);
    expect(duplicateNotifications).toHaveLength(1);

    const changedPayload = await createRequestAs(customer, {
      ...input,
      guestCount: input.guestCount + 1,
    });
    expect(changedPayload.status).toBe(409);

    const sameKeyOtherCustomer = await createRequestAs(
      await login(secondCustomerUserId),
      input,
    );
    const otherCustomerRequestId =
      sameKeyOtherCustomer.body.data?.bookingRequest?.id;
    if (typeof otherCustomerRequestId === "string") {
      bookingIds.add(otherCustomerRequestId);
    }
    expect(sameKeyOtherCustomer.status).toBe(201);

    const listingDelete = await db
      .delete(serviceListings)
      .where(eq(serviceListings.id, listingId))
      .returning({ id: serviceListings.id });
    expect(listingDelete).toHaveLength(1);

    const replayAfterDeletion = await createRequestAs(customer, input);
    expect(replayAfterDeletion.status).toBe(200);
    expect(replayAfterDeletion.body.data.bookingRequest.id).toBe(
      firstRequest.id,
    );
    expect(replayAfterDeletion.body.data.bookingRequest.serviceListingId).toBe(
      null,
    );
    expect(replayAfterDeletion.body.data.bookingRequest.service.title).toBe(
      "Community event planning",
    );

    const profileId = profileIds[0];
    if (!profileId) {
      throw new Error("Booking integration provider profile is missing");
    }
    await createListing(listingId, profileId);
  });

  it("serializes conflicting decisions and writes one history and notification per transition", async () => {
    const customer = await login(customerUserId);
    const provider = await login(professionalUserId);
    const concurrentProvider = await login(professionalUserId, true);
    const created = await createRequestAs(customer, createInput());
    const requestId = created.body.data?.bookingRequest?.id;
    if (typeof requestId === "string") {
      bookingIds.add(requestId);
    }
    expect(created.status).toBe(201);

    const [accept, decline] = await Promise.all([
      provider.agent
        .post(`/api/v1/professional/booking-requests/${requestId}/accept`)
        .set(csrfHeaders(provider.csrfToken))
        .send({}),
      concurrentProvider.agent
        .post(`/api/v1/professional/booking-requests/${requestId}/decline`)
        .set(csrfHeaders(concurrentProvider.csrfToken))
        .send({}),
    ]);
    expect([accept.status, decline.status].sort()).toEqual([200, 409]);
    const accepted = accept.status === 200;
    const finalStatus = accepted ? "accepted" : "declined";
    const sameDecision = await provider.agent
      .post(
        `/api/v1/professional/booking-requests/${requestId}/${finalStatus === "accepted" ? "accept" : "decline"}`,
      )
      .set(csrfHeaders(provider.csrfToken))
      .send({});
    expect(sameDecision.status).toBe(200);

    const stored = await db
      .select({ status: bookingRequests.status })
      .from(bookingRequests)
      .where(eq(bookingRequests.id, requestId))
      .limit(1);
    const history = await db
      .select()
      .from(bookingStatusHistory)
      .where(eq(bookingStatusHistory.bookingRequestId, requestId));
    const requestNotifications = await db
      .select()
      .from(notifications)
      .where(eq(notifications.bookingRequestId, requestId));
    expect(stored[0]?.status).toBe(finalStatus);
    expect(history.map(({ newStatus }) => newStatus).sort()).toEqual(
      ["requested", finalStatus].sort(),
    );
    expect(requestNotifications.map(({ type }) => type).sort()).toEqual(
      [
        "booking_request_received",
        finalStatus === "accepted"
          ? "booking_request_accepted"
          : "booking_request_declined",
      ].sort(),
    );
  });

  it("enforces cancellation rules and records cancellation history and notice", async () => {
    const customer = await login(customerUserId);
    const provider = await login(professionalUserId);
    const outsider = await login(secondCustomerUserId);

    const requested = await createRequestAs(customer, createInput());
    expect(requested.status).toBe(201);
    const requestedId = requested.body.data.bookingRequest.id as string;
    bookingIds.add(requestedId);

    const outsiderCancellation = await outsider.agent
      .post(`/api/v1/bookings/${requestedId}/cancel`)
      .set(csrfHeaders(outsider.csrfToken))
      .send({});
    expect(outsiderCancellation.status).toBe(404);
    const prematureProfessionalCancellation = await provider.agent
      .post(`/api/v1/bookings/${requestedId}/cancel`)
      .set(csrfHeaders(provider.csrfToken))
      .send({});
    expect(prematureProfessionalCancellation.status).toBe(409);

    const cancelledByCustomer = await customer.agent
      .post(`/api/v1/bookings/${requestedId}/cancel`)
      .set(csrfHeaders(customer.csrfToken))
      .send({ reason: "Plans changed" });
    expect(cancelledByCustomer.status).toBe(200);
    expect(cancelledByCustomer.body.data.bookingRequest.status).toBe(
      "cancelled",
    );
    expect(
      cancelledByCustomer.body.data.bookingRequest.cancellation,
    ).toMatchObject({
      cancelledByRole: "customer",
      reason: "Plans changed",
    });
    const customerCancellationNotice = await db
      .select({ recipientUserId: notifications.recipientUserId })
      .from(notifications)
      .where(
        and(
          eq(notifications.bookingRequestId, requestedId),
          eq(notifications.type, "booking_request_cancelled"),
        ),
      );
    expect(customerCancellationNotice).toEqual([
      { recipientUserId: professionalUserId },
    ]);
    expect(
      (
        await provider.agent
          .post(`/api/v1/professional/booking-requests/${requestedId}/accept`)
          .set(csrfHeaders(provider.csrfToken))
          .send({})
      ).status,
    ).toBe(409);
    expect(
      (
        await customer.agent
          .post(`/api/v1/bookings/${requestedId}/cancel`)
          .set(csrfHeaders(customer.csrfToken))
          .send({})
      ).status,
    ).toBe(409);

    const accepted = await createRequestAs(customer, createInput());
    expect(accepted.status).toBe(201);
    const acceptedId = accepted.body.data.bookingRequest.id as string;
    bookingIds.add(acceptedId);
    expect(
      (
        await provider.agent
          .post(`/api/v1/professional/booking-requests/${acceptedId}/accept`)
          .set(csrfHeaders(provider.csrfToken))
          .send({})
      ).status,
    ).toBe(200);
    const cancelledByProfessional = await provider.agent
      .post(`/api/v1/bookings/${acceptedId}/cancel`)
      .set(csrfHeaders(provider.csrfToken))
      .send({});
    expect(cancelledByProfessional.status).toBe(200);
    expect(cancelledByProfessional.body.data.bookingRequest.status).toBe(
      "cancelled",
    );
    expect(
      cancelledByProfessional.body.data.bookingRequest.cancellation
        .cancelledByRole,
    ).toBe("professional");

    const history = await db
      .select({
        previousStatus: bookingStatusHistory.previousStatus,
        newStatus: bookingStatusHistory.newStatus,
      })
      .from(bookingStatusHistory)
      .where(eq(bookingStatusHistory.bookingRequestId, acceptedId))
      .orderBy(bookingStatusHistory.createdAt, bookingStatusHistory.id);
    expect(
      history.map(({ previousStatus, newStatus }) => [
        previousStatus,
        newStatus,
      ]),
    ).toEqual([
      [null, "requested"],
      ["requested", "accepted"],
      ["accepted", "cancelled"],
    ]);
    const cancellationNotifications = await db
      .select({
        recipientUserId: notifications.recipientUserId,
        type: notifications.type,
      })
      .from(notifications)
      .where(
        and(
          eq(notifications.bookingRequestId, acceptedId),
          eq(notifications.type, "booking_request_cancelled"),
        ),
      );
    expect(cancellationNotifications).toEqual([
      { recipientUserId: customerUserId, type: "booking_request_cancelled" },
    ]);

    const customerCancelsAccepted = await createRequestAs(
      customer,
      createInput(),
    );
    expect(customerCancelsAccepted.status).toBe(201);
    const customerCancelsAcceptedId = customerCancelsAccepted.body.data
      .bookingRequest.id as string;
    bookingIds.add(customerCancelsAcceptedId);
    expect(
      (
        await provider.agent
          .post(
            `/api/v1/professional/booking-requests/${customerCancelsAcceptedId}/accept`,
          )
          .set(csrfHeaders(provider.csrfToken))
          .send({})
      ).status,
    ).toBe(200);
    const acceptedCancellation = await customer.agent
      .post(`/api/v1/bookings/${customerCancelsAcceptedId}/cancel`)
      .set(csrfHeaders(customer.csrfToken))
      .send({});
    expect(acceptedCancellation.status).toBe(200);
    expect(acceptedCancellation.body.data.bookingRequest.status).toBe(
      "cancelled",
    );
    expect(
      acceptedCancellation.body.data.bookingRequest.cancellation
        .cancelledByRole,
    ).toBe("customer");
  });

  it("serializes a customer cancellation against professional acceptance", async () => {
    const customer = await login(customerUserId);
    const concurrentProvider = await login(professionalUserId, true);
    const created = await createRequestAs(customer, createInput());
    expect(created.status).toBe(201);
    const requestId = created.body.data.bookingRequest.id as string;
    bookingIds.add(requestId);

    const [cancel, accept] = await Promise.all([
      customer.agent
        .post(`/api/v1/bookings/${requestId}/cancel`)
        .set(csrfHeaders(customer.csrfToken))
        .send({}),
      concurrentProvider.agent
        .post(`/api/v1/professional/booking-requests/${requestId}/accept`)
        .set(csrfHeaders(concurrentProvider.csrfToken))
        .send({}),
    ]);
    expect(cancel.status).toBe(200);
    expect([200, 409]).toContain(accept.status);
    const [stored] = await db
      .select({ status: bookingRequests.status })
      .from(bookingRequests)
      .where(eq(bookingRequests.id, requestId))
      .limit(1);
    expect(stored?.status).toBe("cancelled");
    const history = await db
      .select({
        previousStatus: bookingStatusHistory.previousStatus,
        newStatus: bookingStatusHistory.newStatus,
      })
      .from(bookingStatusHistory)
      .where(eq(bookingStatusHistory.bookingRequestId, requestId))
      .orderBy(bookingStatusHistory.createdAt, bookingStatusHistory.id);
    expect(
      history.map(({ previousStatus, newStatus }) => [
        previousStatus,
        newStatus,
      ]),
    ).toEqual(
      accept.status === 200
        ? [
            [null, "requested"],
            ["requested", "accepted"],
            ["accepted", "cancelled"],
          ]
        : [
            [null, "requested"],
            ["requested", "cancelled"],
          ],
    );
  });

  it("restricts messages to participants and notifies each recipient per message", async () => {
    const customer = await login(customerUserId);
    const provider = await login(professionalUserId);
    const outsider = await login(secondCustomerUserId);
    const created = await createRequestAs(customer, createInput());
    expect(created.status).toBe(201);
    const requestId = created.body.data.bookingRequest.id as string;
    bookingIds.add(requestId);

    const initialMessages = await customer.agent.get(
      `/api/v1/bookings/${requestId}/messages`,
    );
    expect(initialMessages.status).toBe(200);
    expect(initialMessages.body.data.messages).toEqual([]);

    const forbiddenList = await outsider.agent.get(
      `/api/v1/bookings/${requestId}/messages`,
    );
    expect(forbiddenList.status).toBe(404);
    const forbiddenSend = await outsider.agent
      .post(`/api/v1/bookings/${requestId}/messages`)
      .set(csrfHeaders(outsider.csrfToken))
      .send({ body: "Not my booking" });
    expect(forbiddenSend.status).toBe(404);

    const invalidMessage = await customer.agent
      .post(`/api/v1/bookings/${requestId}/messages`)
      .set(csrfHeaders(customer.csrfToken))
      .send({ body: "   " });
    expect(invalidMessage.status).toBe(400);

    const sentByProfessional = await provider.agent
      .post(`/api/v1/bookings/${requestId}/messages`)
      .set(csrfHeaders(provider.csrfToken))
      .send({ body: "I can discuss the event details." });
    expect(sentByProfessional.status).toBe(201);
    expect(sentByProfessional.body.data.message.senderRole).toBe(
      "professional",
    );
    const customerMessages = await customer.agent.get(
      `/api/v1/bookings/${requestId}/messages?page=1&pageSize=10`,
    );
    expect(customerMessages.status).toBe(200);
    expect(customerMessages.body.data.messages).toHaveLength(1);
    expect(customerMessages.body.data.messages[0].readAt).toBeTruthy();

    const sentByCustomer = await customer.agent
      .post(`/api/v1/bookings/${requestId}/messages`)
      .set(csrfHeaders(customer.csrfToken))
      .send({ body: "Thank you. Please share the setup details." });
    expect(sentByCustomer.status).toBe(201);
    expect(sentByCustomer.body.data.message.senderRole).toBe("customer");
    const messageNotifications = await db
      .select({
        messageId: notifications.messageId,
        recipientUserId: notifications.recipientUserId,
      })
      .from(notifications)
      .where(
        and(
          eq(notifications.bookingRequestId, requestId),
          eq(notifications.type, "booking_message_received"),
        ),
      );
    expect(messageNotifications).toHaveLength(2);
    expect(
      messageNotifications.map(({ recipientUserId }) => recipientUserId).sort(),
    ).toEqual([customerUserId, professionalUserId].sort());
    expect(
      messageNotifications.every(({ messageId }) => messageId !== null),
    ).toBe(true);
  });
});
