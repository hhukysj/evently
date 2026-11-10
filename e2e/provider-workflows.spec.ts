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
const emailPrefix = `e2e-${runId}`;
const fixturePassword = randomBytes(24).toString("base64url");
const customerEmail = `${emailPrefix}-customer@example.test`;
const providerEmail = `${emailPrefix}-provider@example.test`;
const unapprovedEmail = `${emailPrefix}-unapproved@example.test`;
const adminEmail = `${emailPrefix}-admin@example.test`;
let db: Pool | undefined;
let providerUserId: string;
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

function sanitizeConsoleText(value: string): string {
  return value.replace(/([?&]token=)[^&#\s]+/gi, "$1[redacted]");
}

const browserDiagnostics = new WeakMap<
  Page,
  {
    consoleErrors: string[];
    applicationErrors: string[];
    failedRequests: string[];
    httpErrors: string[];
    unexpectedHttpErrors: string[];
    expectedHttpFailures: ExpectedHttpFailure[];
  }
>();

test.beforeEach(async ({ page }) => {
  const diagnostics: {
    consoleErrors: string[];
    applicationErrors: string[];
    failedRequests: string[];
    httpErrors: string[];
    unexpectedHttpErrors: string[];
    expectedHttpFailures: ExpectedHttpFailure[];
  } = {
    consoleErrors: [],
    applicationErrors: [],
    failedRequests: [],
    httpErrors: [],
    unexpectedHttpErrors: [],
    expectedHttpFailures: [],
  };
  browserDiagnostics.set(page, diagnostics);
  page.on("console", (message) => {
    if (message.type() === "error") {
      const text = sanitizeConsoleText(message.text());
      diagnostics.consoleErrors.push(text);
      if (!text.startsWith("Failed to load resource:")) {
        diagnostics.applicationErrors.push(text);
      }
    }
  });
  page.on("response", (response) => {
    if (response.status() >= 400) {
      const failure: BrowserHttpFailure = {
        status: response.status(),
        method: response.request().method(),
        url: response.url(),
      };
      const formattedFailure = formatHttpFailure(failure);
      diagnostics.httpErrors.push(formattedFailure);
      if (!classifyHttpFailure(failure, diagnostics.expectedHttpFailures)) {
        diagnostics.unexpectedHttpErrors.push(formattedFailure);
      }
    }
  });
  page.on("requestfailed", (request) => {
    diagnostics.failedRequests.push(
      `${request.method()} ${safeRequestPath(request.url())} ${request.failure()?.errorText ?? "request failed"}`,
    );
  });
});

test.afterEach(async ({ page }, testInfo) => {
  const diagnostics = browserDiagnostics.get(page);
  if (diagnostics) {
    await testInfo.attach("browser-diagnostics", {
      body: Buffer.from(JSON.stringify(diagnostics, null, 2)),
      contentType: "application/json",
    });
  }
  if (testInfo.status === testInfo.expectedStatus) {
    expect(diagnostics?.applicationErrors).toEqual([]);
    expect(diagnostics?.failedRequests).toEqual([]);
    assertNoUnexpectedHttpFailures(diagnostics?.unexpectedHttpErrors ?? []);
    expect(diagnostics?.expectedHttpFailures).toEqual([]);
    return;
  }
});

function expectHttpFailure(
  page: Page,
  expected: Omit<ExpectedHttpFailure, "origin">,
): void {
  const diagnostics = browserDiagnostics.get(page);
  if (!diagnostics) {
    throw new Error("Browser diagnostics are not initialized.");
  }
  diagnostics.expectedHttpFailures.push({
    ...expected,
    origin: new URL(page.url()).origin,
  });
}

test.beforeAll(async () => {
  db = new Pool({ connectionString: databaseUrl });
  await verifyIntegrationDatabase(databaseUrl, db);
  safeDatabaseConfirmed = true;

  const passwordHash = await argon2.hash(fixturePassword);
  const admin = await db.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, role, email_verified_at)
     VALUES ($1, $2, 'admin', now())
     RETURNING id`,
    [adminEmail, passwordHash],
  );
  const adminId = admin.rows[0]?.id;
  if (!adminId) {
    throw new Error("Could not create the browser-test administrator fixture.");
  }

  const provider = await createProfessionalFixture(
    `${emailPrefix}-provider@example.test`,
    `${emailPrefix}-provider`,
    passwordHash,
    adminId,
    true,
  );
  providerUserId = provider;
  await createProfessionalFixture(
    unapprovedEmail,
    `${emailPrefix}-unapproved`,
    passwordHash,
    adminId,
    false,
  );
});

async function createProfessionalFixture(
  email: string,
  slug: string,
  passwordHash: string,
  reviewerId: string,
  approved: boolean,
): Promise<string> {
  if (!db) {
    throw new Error("Browser-test database is not initialized.");
  }
  const userResult = await db.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, role, email_verified_at)
     VALUES ($1, $2, 'professional', now())
     RETURNING id`,
    [email, passwordHash],
  );
  const userId = userResult.rows[0]?.id;
  if (!userId) {
    throw new Error("Could not create a browser-test professional fixture.");
  }
  if (approved) {
    await db.query(
      `INSERT INTO provider_applications
         (user_id, display_name, description, city, country, status,
          reviewer_user_id, reviewed_at)
       VALUES ($1, 'Browser Test Events', 'Disposable browser verification provider.',
               'Pune', 'India', 'approved', $2, now())`,
      [userId, reviewerId],
    );
  }
  await db.query(
    `INSERT INTO professional_profiles
       (user_id, display_name, slug, city, country)
     VALUES ($1, 'Browser Test Events', $2, 'Pune', 'India')`,
    [userId, slug],
  );
  return userId;
}

test.afterAll(async () => {
  if (!db) {
    return;
  }
  try {
    if (safeDatabaseConfirmed) {
      const fixtureUsers = await db.query<{ id: string }>(
        "SELECT id FROM users WHERE email LIKE $1",
        [`${emailPrefix}%`],
      );
      const fixtureIds = fixtureUsers.rows.map(({ id }) => id);
      if (fixtureIds.length > 0) {
        const listingRows = await db.query<{ id: string }>(
          `SELECT sl.id
             FROM service_listings sl
             JOIN professional_profiles pp
               ON pp.id = sl.professional_profile_id
            WHERE pp.user_id = ANY($1::uuid[])`,
          [fixtureIds],
        );
        const listingIds = listingRows.rows.map(({ id }) => id);
        await db.query(
          `DELETE FROM admin_audit_logs
            WHERE service_listing_id = ANY($1::uuid[])
               OR actor_user_id = ANY($2::uuid[])
               OR target_user_id = ANY($2::uuid[])
               OR actor_user_id_snapshot = ANY($2::uuid[])`,
          [listingIds, fixtureIds],
        );
        await db.query(
          `DELETE FROM sessions
            WHERE sess->>'userId' = ANY($1::text[])`,
          [fixtureIds],
        );
        await db.query(
          `DELETE FROM provider_applications
            WHERE user_id = ANY($1::uuid[])
               OR reviewer_user_id = ANY($1::uuid[])`,
          [fixtureIds],
        );
        await db.query(
          "DELETE FROM service_listings WHERE id = ANY($1::uuid[])",
          [listingIds],
        );
        await db.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [
          fixtureIds,
        ]);
      }
    }
  } finally {
    await db.end();
  }
});

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(fixturePassword);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText(`You are signed in as ${email}.`)).toBeVisible();
}

test("landing, registration validation, local email verification, login, and guest access", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Plan something worth remembering." }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/landing-page.png",
    fullPage: true,
  });

  await page.goto("/register");
  await page.getByLabel("Email address").fill("invalid-email");
  await page.getByLabel("Password").fill("short");
  expect(
    await page
      .getByLabel("Email address")
      .evaluate((input: HTMLInputElement) => input.checkValidity()),
  ).toBe(false);
  expect(
    await page
      .getByLabel("Password")
      .evaluate((input: HTMLInputElement) => input.checkValidity()),
  ).toBe(false);

  await page.getByLabel("Email address").fill(customerEmail);
  await page.getByLabel("Password").fill(fixturePassword);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(
    page.getByText(/If this address can be registered/),
  ).toBeVisible();

  const customerInboxEntry = page
    .locator(".inbox-list li")
    .filter({ hasText: customerEmail });
  await expect(
    customerInboxEntry.getByRole("link", { name: "Open local link" }),
  ).toBeVisible();
  await customerInboxEntry
    .getByRole("link", { name: "Open local link" })
    .click();
  await expect(
    page.getByRole("button", { name: "Verify email" }),
  ).toBeVisible();
  await page.evaluate(() =>
    window.history.replaceState({}, "", "/verify-email"),
  );
  await page.getByRole("button", { name: "Verify email" }).click();
  await expect(
    page.getByText(/If the verification link was valid, it is complete/),
  ).toBeVisible();

  await page.goto("/login");
  await page
    .getByLabel("Email address")
    .fill(`${emailPrefix}-missing@example.test`);
  await page.getByLabel("Password").fill(fixturePassword);
  expectHttpFailure(page, {
    method: "POST",
    pathname: "/api/v1/auth/login",
    status: 401,
  });
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Invalid email or password",
  );

  await login(page, customerEmail);
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
  await page.goto("/professional/services");
  await expect(
    page.getByText("Sign in with an approved provider account."),
  ).toBeVisible();
  const guestOwnerList = await page.request.get(
    `${baseURL}/api/v1/professional/service-listings`,
  );
  expect(guestOwnerList.status()).toBe(401);
});

test("provider dashboard, listing lifecycle, privacy filtering, suspension, and responsive layout", async ({
  page,
  browser,
}) => {
  await login(page, providerEmail);
  const desktopMetrics = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
  }));
  expect(desktopMetrics.content).toBeLessThanOrEqual(desktopMetrics.viewport);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route(
    "**/api/v1/professional/service-listings?*",
    async (route) => {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            code: "TEMPORARY_FAILURE",
            message: "Temporary test failure.",
            requestId: "browser-test",
          },
        }),
      });
    },
  );
  expectHttpFailure(page, {
    method: "GET",
    pathname: "/api/v1/professional/service-listings",
    status: 503,
  });
  await page.goto("/professional/services");
  await expect(page.getByRole("alert")).toContainText(
    "Temporary test failure.",
  );
  await page.unroute("**/api/v1/professional/service-listings?*");

  await page.route(
    "**/api/v1/professional/service-listings?*",
    async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 300));
      await route.continue();
    },
  );
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByText("Loading your service listings…")).toBeVisible();
  await expect(page.getByText("No services yet")).toBeVisible();
  await page.unroute("**/api/v1/professional/service-listings?*");
  await page.screenshot({
    path: "test-results/provider-dashboard-empty-mobile.png",
    fullPage: true,
  });

  await page.getByRole("button", { name: "Create a service" }).click();
  await page.getByRole("button", { name: "Create service" }).click();
  await expect(page.locator("#service-title")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await page.getByLabel("Service title").fill("Community event planning");
  await page
    .getByLabel("Description")
    .fill("Thoughtful planning and coordination for local community events.");
  await page.getByLabel("City").fill("Pune");
  await page.getByLabel("Pricing model").selectOption("fixed");
  await page.getByLabel("Price in INR").fill("0");

  const createdResponsePromise = page.waitForResponse(
    (response) =>
      response.url().includes("/api/v1/professional/service-listings") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Create service" }).click();
  const createdResponse = await createdResponsePromise;
  expect(createdResponse.status()).toBe(201);
  const createdBody = (await createdResponse.json()) as {
    data: { listing: { id: string } };
  };
  const listingId = createdBody.data.listing.id;
  await expect(page.getByText("Service listing created.")).toBeVisible();
  await expect(page.getByText("Community event planning")).toBeVisible();

  await page.getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("Service title").fill("Local event coordination");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Service changes saved.")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Local event coordination")).toBeVisible();

  const unpublishedSearch = await page.request.get(
    `${baseURL}/api/v1/service-listings`,
  );
  const unpublishedBody = (await unpublishedSearch.json()) as {
    data: { listings: Array<{ id: string }> };
  };
  expect(unpublishedBody.data.listings.some(({ id }) => id === listingId)).toBe(
    false,
  );

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("Service published.")).toBeVisible();
  const publishedState = await db?.query<{
    publication: string;
    moderation: string;
    account_status: string;
    role: string;
    approved: boolean;
    listing_city: string;
  }>(
    `SELECT sl.publication_status AS publication,
            sl.moderation_status AS moderation,
            u.status AS account_status,
            u.role,
            EXISTS (
              SELECT 1 FROM provider_applications pa
               WHERE pa.user_id = u.id AND pa.status = 'approved'
            ) AS approved,
            sl.city AS listing_city
       FROM service_listings sl
       JOIN professional_profiles pp
         ON pp.id = sl.professional_profile_id
       JOIN users u ON u.id = pp.user_id
      WHERE sl.id = $1`,
    [listingId],
  );
  expect(publishedState?.rows[0]).toEqual({
    publication: "published",
    moderation: "visible",
    account_status: "active",
    role: "professional",
    approved: true,
    listing_city: "Pune",
  });
  const publiclyEligibleListing = await db?.query<{ total: string }>(
    `SELECT count(*)::text AS total
       FROM service_listings sl
       JOIN professional_profiles pp
         ON pp.id = sl.professional_profile_id
       JOIN users u ON u.id = pp.user_id
       JOIN service_categories sc ON sc.slug = sl.category_slug
      WHERE sl.id = $1
        AND sl.publication_status = 'published'
        AND sl.moderation_status = 'visible'
        AND u.status = 'active'
        AND u.role = 'professional'
        AND EXISTS (
          SELECT 1 FROM provider_applications pa
           WHERE pa.user_id = u.id AND pa.status = 'approved'
        )`,
    [listingId],
  );
  expect(publiclyEligibleListing?.rows[0]?.total).toBe("1");
  const directPublicDetail = await page.request.get(
    `http://127.0.0.1:3001/api/v1/service-listings/${listingId}`,
  );
  expect(directPublicDetail.status()).toBe(200);
  expect(
    (
      await page.request.get(`${baseURL}/api/v1/service-listings/${listingId}`)
    ).status(),
  ).toBe(200);
  const publicSearch = await page.request.get(
    `${baseURL}/api/v1/service-listings`,
  );
  expect(publicSearch.status()).toBe(200);
  const publicBody = (await publicSearch.json()) as {
    data: {
      listings: Array<Record<string, unknown> & { id: string }>;
      pagination: { total: number };
    };
  };
  expect(publicBody.data.pagination.total).toBeGreaterThan(0);
  const publicListing = publicBody.data.listings.find(
    ({ id }) => id === listingId,
  );
  expect(publicListing).toBeTruthy();
  for (const privateField of [
    "userId",
    "professionalProfileId",
    "email",
    "moderationReason",
    "reviewerUserId",
  ]) {
    expect(publicListing).not.toHaveProperty(privateField);
  }

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Edit" }).click();
  await expect(
    page.getByRole("heading", { name: "Edit service" }),
  ).toBeVisible();
  await page.getByLabel("Service title").fill("Published event coordination");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Service changes saved.")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Published event coordination")).toBeVisible();
  const publicAfterEdit = await page.request.get(
    `${baseURL}/api/v1/service-listings/${listingId}`,
  );
  expect(publicAfterEdit.status()).toBe(200);
  const publicDetail = (await publicAfterEdit.json()) as {
    data: { listing: { title: string } };
  };
  expect(publicDetail.data.listing.title).toBe("Published event coordination");

  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  await login(adminPage, adminEmail);
  const adminRead = await adminPage.request.get(
    `${baseURL}/api/v1/admin/service-listings/${listingId}`,
  );
  expect(adminRead.status()).toBe(200);
  const listingEtag = adminRead.headers().etag;
  expect(listingEtag).toBeTruthy();
  const csrfResponse = await adminPage.request.get(
    `${baseURL}/api/v1/auth/csrf`,
  );
  const csrfBody = (await csrfResponse.json()) as {
    data: { csrfToken: string };
  };
  const hidden = await adminPage.request.post(
    `${baseURL}/api/v1/admin/service-listings/${listingId}/hide`,
    {
      data: { reason: "Automated privacy verification." },
      headers: {
        Origin: baseURL,
        "X-CSRF-Token": csrfBody.data.csrfToken,
        "If-Match": listingEtag ?? "",
      },
    },
  );
  expect(hidden.status()).toBe(200);
  await adminContext.close();

  const publicAfterHide = await page.request.get(
    `${baseURL}/api/v1/service-listings`,
  );
  const hiddenSearchBody = (await publicAfterHide.json()) as {
    data: { listings: Array<{ id: string }> };
  };
  expect(
    hiddenSearchBody.data.listings.some(({ id }) => id === listingId),
  ).toBe(false);
  expect(
    (
      await page.request.get(`${baseURL}/api/v1/service-listings/${listingId}`)
    ).status(),
  ).toBe(404);

  await db?.query("UPDATE users SET status = 'suspended' WHERE id = $1", [
    providerUserId,
  ]);
  expect(
    (
      await page.request.get(`${baseURL}/api/v1/professional/service-listings`)
    ).status(),
  ).toBe(401);
  await page.reload();
  await expect(
    page.getByText("Sign in with an approved provider account."),
  ).toBeVisible();
  const responsiveMetrics = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
  }));
  expect(responsiveMetrics.content).toBeLessThanOrEqual(
    responsiveMetrics.viewport,
  );
});

test("customer and unapproved professional are denied provider listing access", async ({
  page,
}) => {
  await login(page, unapprovedEmail);
  expectHttpFailure(page, {
    method: "GET",
    pathname: "/api/v1/professional/service-listings",
    status: 403,
  });
  await page.goto("/professional/services");
  await expect(page.getByRole("alert")).toContainText(
    "not currently eligible to manage services",
  );
  expect(
    (
      await page.request.get(`${baseURL}/api/v1/professional/service-listings`)
    ).status(),
  ).toBe(403);

  await page.getByRole("button", { name: "Sign out" }).click();
  await login(page, customerEmail);
  await page.goto("/professional/services");
  await expect(
    page.getByRole("heading", { name: "Provider access required" }),
  ).toBeVisible();
  expect(
    (
      await page.request.get(`${baseURL}/api/v1/professional/service-listings`)
    ).status(),
  ).toBe(403);
});
