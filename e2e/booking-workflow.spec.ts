import { randomBytes, randomUUID } from "node:crypto";
import argon2 from "argon2";
import { expect, test, type Page } from "@playwright/test";
import { Pool } from "pg";
import {
  assertNoUnexpectedHttpFailures,
  classifyHttpFailure,
  formatHttpFailure,
  type BrowserHttpFailure,
  type ExpectedHttpFailure,
} from "./http-diagnostics.js";
import { verifyIntegrationDatabase } from "../apps/api/src/testing/integration-database.js";

const databaseUrl = process.env.EVENTLY_E2E_DATABASE_URL;
if (!databaseUrl) {
  throw new Error("EVENTLY_E2E_DATABASE_URL is required.");
}

const baseURL = "http://127.0.0.1:5174";
const runId = randomUUID();
const emailPrefix = `e2e-booking-${runId}`;
const fixturePassword = randomBytes(24).toString("base64url");
const adminEmail = `${emailPrefix}-admin@example.test`;
const customerEmail = `${emailPrefix}-customer@example.test`;
const unverifiedCustomerEmail = `${emailPrefix}-unverified-customer@example.test`;
const providerEmail = `${emailPrefix}-provider@example.test`;
const providerSlug = `${emailPrefix}-provider`;
let db: Pool | undefined;
let serviceListingId = "";
let safeDatabaseConfirmed = false;

test.describe.configure({ mode: "serial" });

function safeRequestPath(value: string): string {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return "<invalid-url>";
  }
}

const diagnostics = new WeakMap<
  Page,
  {
    errors: string[];
    pageErrors: string[];
    failures: string[];
    unexpected: string[];
    expected: ExpectedHttpFailure[];
  }
>();

test.beforeEach(async ({ page }) => {
  const state = {
    errors: [] as string[],
    pageErrors: [] as string[],
    failures: [] as string[],
    unexpected: [] as string[],
    expected: [] as ExpectedHttpFailure[],
  };
  diagnostics.set(page, state);
  page.on("console", (message) => {
    if (message.type() === "error") {
      const text = message
        .text()
        .replace(/([?&]token=)[^&#\s]+/gi, "$1[redacted]");
      if (!text.startsWith("Failed to load resource:")) {
        state.errors.push(text);
      }
    }
  });
  page.on("pageerror", (error) => {
    state.pageErrors.push(error.message);
  });
  page.on("response", (response) => {
    if (response.status() >= 400) {
      const failure: BrowserHttpFailure = {
        status: response.status(),
        method: response.request().method(),
        url: response.url(),
      };
      const formatted = formatHttpFailure(failure);
      if (!classifyHttpFailure(failure, state.expected))
        state.unexpected.push(formatted);
    }
  });
  page.on("requestfailed", (request) => {
    const errorText = request.failure()?.errorText ?? "request failed";
    if (
      request.method() === "GET" &&
      errorText.includes("net::ERR_ABORTED")
    ) {
      return;
    }
    state.failures.push(
      `${request.method()} ${safeRequestPath(request.url())} ${errorText}`,
    );
  });
});

test.afterEach(async ({ page }, testInfo) => {
  const state = diagnostics.get(page);
  if (state && testInfo.status === testInfo.expectedStatus) {
    expect(state.errors).toEqual([]);
    expect(state.pageErrors).toEqual([]);
    expect(state.failures).toEqual([]);
    assertNoUnexpectedHttpFailures(state.unexpected);
    expect(state.expected).toEqual([]);
  }
});

function expectHttpFailure(
  page: Page,
  expected: Omit<ExpectedHttpFailure, "origin">,
): void {
  const state = diagnostics.get(page);
  if (!state) throw new Error("Browser diagnostics are not initialized.");
  state.expected.push({ ...expected, origin: new URL(page.url()).origin });
}

test.beforeAll(async () => {
  db = new Pool({ connectionString: databaseUrl });
  await verifyIntegrationDatabase(databaseUrl, db);
  safeDatabaseConfirmed = true;

  const passwordHash = await argon2.hash(fixturePassword);
  const adminResult = await db.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, role, email_verified_at)
     VALUES ($1, $2, 'admin', now()) RETURNING id`,
    [adminEmail, passwordHash],
  );
  const adminId = adminResult.rows[0]?.id;
  if (!adminId) throw new Error("Could not create booking E2E admin fixture.");

  const providerResult = await db.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, role, email_verified_at)
     VALUES ($1, $2, 'professional', now()) RETURNING id`,
    [providerEmail, passwordHash],
  );
  const providerUserId = providerResult.rows[0]?.id ?? "";
  if (!providerUserId)
    throw new Error("Could not create booking E2E professional fixture.");

  await db.query(
    `INSERT INTO provider_applications
       (user_id, display_name, description, city, country, status, reviewer_user_id, reviewed_at)
     VALUES ($1, 'Booking E2E Studio', 'Disposable booking workflow provider.', 'Pune', 'India', 'approved', $2, now())`,
    [providerUserId, adminId],
  );
  const profileResult = await db.query<{ id: string }>(
    `INSERT INTO professional_profiles (user_id, display_name, slug, city, country)
     VALUES ($1, 'Booking E2E Studio', $2, 'Pune', 'India') RETURNING id`,
    [providerUserId, providerSlug],
  );
  const profileId = profileResult.rows[0]?.id;
  if (!profileId)
    throw new Error("Could not create booking E2E profile fixture.");

  const listingResult = await db.query<{ id: string }>(
    `INSERT INTO service_listings
       (professional_profile_id, category_slug, title, description, city, region,
        pricing_method, price_amount_paise, currency, publication_status, moderation_status)
     VALUES ($1, 'planning_coordination', 'Booking E2E event planning',
             'Planning and coordination for a disposable browser booking journey.',
             'Pune', 'Maharashtra', 'fixed', 125000, 'INR', 'published', 'visible')
     RETURNING id`,
    [profileId],
  );
  serviceListingId = listingResult.rows[0]?.id ?? "";
  if (!serviceListingId)
    throw new Error("Could not create booking E2E service fixture.");

  await db.query(
    `INSERT INTO users (email, password_hash, role, email_verified_at)
     VALUES ($1, $2, 'customer', now()), ($3, $2, 'customer', now())`,
    [customerEmail, passwordHash, unverifiedCustomerEmail],
  );
});

async function login(page: Page, email: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(fixturePassword);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText(`You are signed in as ${email}.`)).toBeVisible();
}

async function fillBrief(
  page: Page,
  eventType = "Community festival",
): Promise<void> {
  await page.getByLabel("Event type").fill(eventType);
  await page.getByLabel("Event date").fill("2099-12-31");
  await page.getByLabel("Event timezone (IANA)").fill("Asia/Kolkata");
  await page.getByLabel("Event city").fill("Pune");
  await page.getByLabel("Region or state (optional)").fill("Maharashtra");
  await page.getByLabel("Estimated guest count").fill("80");
}

async function submitBooking(page: Page, eventType: string): Promise<string> {
  await page.goto(`/services/${serviceListingId}`);
  await expect(
    page.getByRole("heading", { name: "Booking E2E event planning" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Request booking" }).click();
  await fillBrief(page, eventType);
  const responsePromise = page.waitForResponse(
    (response) =>
      response.url().includes("/api/v1/booking-requests") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Send booking request" }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(201);
  const payload = (await response.json()) as {
    data: { bookingRequest: { id: string } };
  };
  return payload.data.bookingRequest.id;
}

test("customer submits a request, sees the professional response, and competing decisions serialize", async ({
  page,
  browser,
}) => {
  await page.goto(`/services/${serviceListingId}`);
  await page
    .getByRole("link", { name: "Sign in to request this service" })
    .click();
  await page.getByLabel("Email address").fill(customerEmail);
  await page.getByLabel("Password").fill(fixturePassword);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(
    page.getByRole("heading", {
      name: "Tell the professional about your event",
    }),
  ).toBeVisible();
  await fillBrief(page);
  const createResponse = page.waitForResponse(
    (response) =>
      response.url().includes("/api/v1/booking-requests") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Send booking request" }).click();
  expect((await createResponse).status()).toBe(201);
  await expect(page.getByText(/not a confirmed booking yet/)).toBeVisible();
  await page.getByRole("link", { name: "View my requests" }).click();
  await expect(page.getByText("Awaiting professional response")).toBeVisible();
  await expect(page.getByText("Community festival")).toBeVisible();

  const providerContext = await browser.newContext({ baseURL });
  try {
    const providerPage = await providerContext.newPage();
    await login(providerPage, providerEmail);
    await providerPage.goto("/professional/booking-requests");
    await expect(providerPage.getByText("Community festival")).toBeVisible();
    await providerPage.getByRole("button", { name: "Accept request" }).click();
    await expect(
      providerPage.getByText("Booking request accepted."),
    ).toBeVisible();

    await page.goto("/booking-requests");
    await page.getByRole("button", { name: "Refresh" }).click();
    await expect(page.getByText("Accepted by professional")).toBeVisible();

    const competingRequestId = await submitBooking(
      page,
      "Concurrent planning request",
    );
    const competingProviderPage = await providerContext.newPage();
    await Promise.all([
      providerPage.goto("/professional/booking-requests"),
      competingProviderPage.goto("/professional/booking-requests"),
    ]);
    const acceptCard = providerPage
      .locator(".booking-request-item")
      .filter({ hasText: "Concurrent planning request" });
    const declineCard = competingProviderPage
      .locator(".booking-request-item")
      .filter({ hasText: "Concurrent planning request" });
    await Promise.all([
      expect(acceptCard).toBeVisible(),
      expect(declineCard).toBeVisible(),
      expect(
        acceptCard.getByRole("button", { name: "Accept request" }),
      ).toBeVisible(),
      expect(
        declineCard.getByRole("button", { name: "Decline request" }),
      ).toBeVisible(),
    ]);
    const acceptResponsePromise = providerPage.waitForResponse(
      (response) =>
        response.url().includes(
          `/professional/booking-requests/${competingRequestId}/accept`,
        ) &&
        response.request().method() === "POST",
    );
    const declineResponsePromise = competingProviderPage.waitForResponse(
      (response) =>
        response.url().includes(
          `/professional/booking-requests/${competingRequestId}/decline`,
        ) &&
        response.request().method() === "POST",
    );
    await Promise.all([
      acceptCard.getByRole("button", { name: "Accept request" }).click(),
      declineCard.getByRole("button", { name: "Decline request" }).click(),
    ]);
    const [acceptResponse, declineResponse] = await Promise.all([
      acceptResponsePromise,
      declineResponsePromise,
    ]);
    expect([acceptResponse.status(), declineResponse.status()].sort()).toEqual([
      200, 409,
    ]);

    await page.goto("/booking-requests");
    await page.getByRole("button", { name: "Refresh" }).click();
    await expect(page.getByText("Concurrent planning request")).toBeVisible();
  } finally {
    await providerContext.close();
  }

  await page.goto("/booking-requests");
  expectHttpFailure(page, {
    method: "GET",
    pathname: "/api/v1/professional/booking-requests",
    status: 403,
  });
  const forbiddenStatus = await page.evaluate(async () => {
    const response = await fetch("/api/v1/professional/booking-requests", {
      credentials: "same-origin",
    });
    return response.status;
  });
  expect(forbiddenStatus).toBe(403);
});

test("unverified customers receive a clear booking eligibility error", async ({
  page,
}) => {
  await login(page, unverifiedCustomerEmail);
  await db?.query(
    "UPDATE users SET email_verified_at = NULL WHERE email = $1",
    [unverifiedCustomerEmail],
  );
  await page.goto(`/services/${serviceListingId}`);
  await page.getByRole("button", { name: "Request booking" }).click();
  await fillBrief(page, "Unverified customer request");
  expectHttpFailure(page, {
    method: "POST",
    pathname: "/api/v1/booking-requests",
    status: 403,
  });
  await page.getByRole("button", { name: "Send booking request" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Verify your email before requesting a service",
  );
});

test.afterAll(async () => {
  if (!db) return;
  try {
    if (safeDatabaseConfirmed) {
      const users = await db.query<{ id: string }>(
        "SELECT id FROM users WHERE email LIKE $1",
        [`${emailPrefix}%`],
      );
      const userIds = users.rows.map(({ id }) => id);
      if (userIds.length > 0) {
        const requests = await db.query<{ id: string }>(
          `SELECT id FROM booking_requests
            WHERE customer_user_id = ANY($1::uuid[])
               OR professional_user_id = ANY($1::uuid[])`,
          [userIds],
        );
        const requestIds = requests.rows.map(({ id }) => id);
        if (requestIds.length > 0) {
          await db.query(
            "DELETE FROM notifications WHERE booking_request_id = ANY($1::uuid[])",
            [requestIds],
          );
          await db.query(
            "DELETE FROM booking_status_history WHERE booking_request_id = ANY($1::uuid[])",
            [requestIds],
          );
          await db.query(
            "DELETE FROM booking_requests WHERE id = ANY($1::uuid[])",
            [requestIds],
          );
        }
        const listings = await db.query<{ id: string }>(
          `SELECT sl.id FROM service_listings sl
             JOIN professional_profiles pp ON pp.id = sl.professional_profile_id
            WHERE pp.user_id = ANY($1::uuid[])`,
          [userIds],
        );
        const listingIds = listings.rows.map(({ id }) => id);
        await db.query(
          `DELETE FROM admin_audit_logs WHERE service_listing_id = ANY($1::uuid[])
             OR actor_user_id = ANY($2::uuid[]) OR target_user_id = ANY($2::uuid[])
             OR actor_user_id_snapshot = ANY($2::uuid[])`,
          [listingIds, userIds],
        );
        await db.query(
          "DELETE FROM sessions WHERE sess->>'userId' = ANY($1::text[])",
          [userIds],
        );
        await db.query(
          "DELETE FROM provider_applications WHERE user_id = ANY($1::uuid[]) OR reviewer_user_id = ANY($1::uuid[])",
          [userIds],
        );
        await db.query(
          "DELETE FROM service_listings WHERE id = ANY($1::uuid[])",
          [listingIds],
        );
        await db.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [
          userIds,
        ]);
      }
    }
  } finally {
    await db.end();
  }
});
