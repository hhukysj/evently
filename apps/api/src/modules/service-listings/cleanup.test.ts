import { describe, expect, it, vi } from "vitest";
import {
  createServiceListingFixtureCleanupScope,
  formatRetainedFixtureReport,
  planListingAuditCleanup,
  reportAmbiguousListingRetention,
  resolveListingAttempt,
  teardownIntegrationResources,
} from "./cleanup.js";

describe("service listing fixture cleanup scope", () => {
  it("includes only deduplicated records owned by this run's fixture identities", () => {
    const scope = createServiceListingFixtureCleanupScope({
      userIds: ["user-a", "user-a", "user-b"],
      profileIds: [
        { id: "profile-a", ownerId: "user-a" },
        { id: "profile-b", ownerId: "user-b" },
        { id: "unowned-profile", ownerId: "other-user" },
        { id: "profile-a", ownerId: "user-a" },
      ],
      applicationIds: [
        { id: "application-a", ownerId: "user-a" },
        { id: "reviewed-by-fixture", ownerId: "other-user" },
      ],
      auditIds: [
        { id: "audit-a", ownerId: "listing-a" },
        { id: "audit-unowned", ownerId: "listing-other" },
      ],
      listingIds: [
        { id: "listing-a", ownerId: "profile-a" },
        { id: "listing-b", ownerId: "profile-b" },
        { id: "listing-on-unowned-profile", ownerId: "unowned-profile" },
        { id: "listing-a", ownerId: "profile-a" },
      ],
    });

    expect(scope).toEqual({
      userIds: ["user-a", "user-b"],
      profiles: [
        { id: "profile-a", ownerId: "user-a" },
        { id: "profile-b", ownerId: "user-b" },
      ],
      applications: [{ id: "application-a", ownerId: "user-a" }],
      listings: [
        { id: "listing-a", ownerId: "profile-a" },
        { id: "listing-b", ownerId: "profile-b" },
      ],
      audits: [{ id: "audit-a", ownerId: "listing-a" }],
    });
  });

  it("does not include a listing when its owner profile is outside the scope", () => {
    const scope = createServiceListingFixtureCleanupScope({
      userIds: ["fixture-user"],
      profileIds: [],
      applicationIds: [],
      listingIds: [{ id: "listing-a", ownerId: "profile-not-in-scope" }],
      auditIds: [],
    });

    expect(scope.listings).toEqual([]);
  });

  it("deletes only exactly tracked audits and reports each unowned audit row", () => {
    const plan = planListingAuditCleanup(
      [
        { id: "listing-owned", ownerId: "profile-owned" },
        { id: "listing-audited", ownerId: "profile-owned" },
      ],
      [
        { id: "audit-owned", ownerId: "listing-audited" },
        { id: "audit-other-process", ownerId: "listing-audited" },
      ],
      [{ id: "audit-owned", ownerId: "listing-audited" }],
    );

    expect(plan).toEqual({
      auditIds: ["audit-owned"],
      listingIds: ["listing-owned"],
      retainedAudits: [
        {
          type: "audit",
          id: "audit-other-process",
          reason:
            "references retained listing listing-audited; test-run ownership was not established",
        },
      ],
      retainedListings: [
        {
          type: "listing",
          id: "listing-audited",
          reason: "has 1 audit record(s) without proven test-run ownership",
        },
      ],
    });
  });

  it("does not delete an audit with a tracked ID attached to a different listing", () => {
    const plan = planListingAuditCleanup(
      [{ id: "listing-a", ownerId: "profile-a" }],
      [{ id: "audit-a", ownerId: "listing-a" }],
      [{ id: "audit-a", ownerId: "listing-b" }],
    );

    expect(plan.auditIds).toEqual([]);
    expect(plan.listingIds).toEqual([]);
    expect(plan.retainedAudits).toEqual([
      {
        type: "audit",
        id: "audit-a",
        reason:
          "references retained listing listing-a; test-run ownership was not established",
      },
    ]);
    expect(plan.retainedListings).toHaveLength(1);
  });

  it("resolves marker recovery only for a unique exact-profile match", () => {
    expect(
      resolveListingAttempt("profile-a", [
        { id: "committed-listing-id", profileId: "profile-a" },
      ]),
    ).toEqual({ id: "committed-listing-id", ownerId: "profile-a" });
  });

  it("reports all retained IDs and reasons without personal data", () => {
    const report = formatRetainedFixtureReport([
      {
        type: "listing",
        id: "fixture-listing-id",
        reason: "has an audit record without proven test-run ownership",
      },
      {
        type: "audit",
        id: "unowned-audit-id",
        reason: "references retained listing fixture-listing-id",
      },
    ]);

    expect(report).toContain("listing fixture-listing-id");
    expect(report).toContain("audit unowned-audit-id");
    expect(report).toContain("test-run ownership");
    expect(report).not.toContain("@");
    expect(report).not.toContain("password");
    expect(report).not.toContain("token");
  });

  it("keeps marker recovery scoped and refuses ambiguous matches", () => {
    expect(
      resolveListingAttempt("profile-a", [
        { id: "committed-listing-id", profileId: "profile-a" },
      ]),
    ).toEqual({ id: "committed-listing-id", ownerId: "profile-a" });
    expect(
      resolveListingAttempt("profile-a", [
        { id: "unrelated-listing", profileId: "profile-b" },
      ]),
    ).toBeUndefined();
    expect(
      resolveListingAttempt("profile-a", [
        { id: "ambiguous-a", profileId: "profile-a" },
        { id: "ambiguous-b", profileId: "profile-a" },
      ]),
    ).toBeUndefined();
  });

  it("reports ambiguous listings and their exact retained audit IDs", () => {
    const retained = reportAmbiguousListingRetention(
      [
        { id: "ambiguous-listing-a", profileId: "profile-a" },
        { id: "ambiguous-listing-b", profileId: "profile-a" },
      ],
      [
        { id: "audit-a", listingId: "ambiguous-listing-a" },
        { id: "audit-b", listingId: "ambiguous-listing-b" },
        { id: "unrelated-audit", listingId: "listing-outside-scope" },
        { id: "unlinked-audit", listingId: null },
      ],
    );

    expect(retained).toEqual([
      {
        type: "listing",
        id: "ambiguous-listing-a",
        reason: "matches a test creation marker non-uniquely",
      },
      {
        type: "listing",
        id: "ambiguous-listing-b",
        reason: "matches a test creation marker non-uniquely",
      },
      {
        type: "audit",
        id: "audit-a",
        reason:
          "references ambiguous listing ambiguous-listing-a; listing is retained because marker recovery was non-unique",
      },
      {
        type: "audit",
        id: "audit-b",
        reason:
          "references ambiguous listing ambiguous-listing-b; listing is retained because marker recovery was non-unique",
      },
    ]);
  });

  it("shuts down resources when identity verification failed without database cleanup", async () => {
    const databaseCleanup = vi.fn(async () => {});
    const clear = vi.fn(async () => {});
    const shutdown = vi.fn(async () => {});
    const closeSessionStore = vi.fn();
    const closePool = vi.fn(async () => {});

    await teardownIntegrationResources({
      databaseVerified: false,
      cleanupDatabase: databaseCleanup,
      rateLimitStores: [{ clear, shutdown }],
      closeSessionStore,
      closePool,
    });

    expect(databaseCleanup).not.toHaveBeenCalled();
    expect(clear).not.toHaveBeenCalled();
    expect(shutdown).toHaveBeenCalledOnce();
    expect(closeSessionStore).toHaveBeenCalledOnce();
    expect(closePool).toHaveBeenCalledOnce();
  });

  it("attempts all resource closures and reports a prior shutdown failure", async () => {
    const shutdownError = new Error("rate limiter shutdown failed");
    const poolError = new Error("pool close failed");
    const closeSessionStore = vi.fn();
    const closePool = vi.fn(async () => {
      throw poolError;
    });

    await expect(
      teardownIntegrationResources({
        databaseVerified: false,
        cleanupDatabase: vi.fn(async () => {}),
        rateLimitStores: [
          {
            clear: vi.fn(async () => {}),
            shutdown: vi.fn(async () => {
              throw shutdownError;
            }),
          },
        ],
        closeSessionStore,
        closePool,
      }),
    ).rejects.toThrow("Integration-test teardown failed.");

    expect(closeSessionStore).toHaveBeenCalledOnce();
    expect(closePool).toHaveBeenCalledOnce();
  });

  it("attempts pool closure when session-store closure fails", async () => {
    const closePool = vi.fn(async () => {});

    await expect(
      teardownIntegrationResources({
        databaseVerified: false,
        cleanupDatabase: vi.fn(async () => {}),
        rateLimitStores: [],
        closeSessionStore: () => {
          throw new Error("session store close failed");
        },
        closePool,
      }),
    ).rejects.toThrow("session store close failed");

    expect(closePool).toHaveBeenCalledOnce();
  });
});
