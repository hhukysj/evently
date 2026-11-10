import { describe, expect, it, vi } from "vitest";
import { serviceListings } from "../../db/schema.js";
import { PostgresServiceListingRepository } from "./repository.js";

const listing = {
  id: "00000000-0000-4000-8000-000000000001",
  professionalProfileId: "00000000-0000-4000-8000-000000000002",
  categorySlug: "planning_coordination",
  title: "Community event planning",
  description: "Planning and coordination for local community events.",
  city: "Pune",
  region: null,
  pricingMethod: "fixed",
  priceAmountPaise: 1000,
  currency: "INR",
  publicationStatus: "draft",
  moderationStatus: "visible",
  moderationHiddenByUserId: null,
  moderationHiddenAt: null,
  moderationReason: null,
  version: 1,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
} satisfies typeof serviceListings.$inferSelect;

const updatedListing = {
  ...listing,
  moderationStatus: "hidden",
  moderationHiddenByUserId: "00000000-0000-4000-8000-000000000003",
  moderationHiddenAt: new Date("2026-01-02T00:00:00.000Z"),
  moderationReason: "Requires additional policy review.",
  version: 2,
  updatedAt: new Date("2026-01-02T00:00:00.000Z"),
} satisfies typeof serviceListings.$inferSelect;

function createTransaction() {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          for: async () => [listing],
        }),
      }),
    }),
    update: () => ({
      set: () => ({
        where: () => ({
          returning: async () => [updatedListing],
        }),
      }),
    }),
    insert: () => ({
      values: () => ({
        returning: async () => [{ id: "00000000-0000-4000-8000-000000000004" }],
      }),
    }),
  };
}

function createRepositoryDatabase(options: { rejectCommit?: boolean } = {}) {
  let transactionResolved = false;
  const transaction = createTransaction();
  const database = {
    transaction: async (callback: (transaction: never) => Promise<unknown>) => {
      const result = await callback(transaction as never);
      if (options.rejectCommit) {
        throw new Error("Transaction commit failed");
      }
      transactionResolved = true;
      return result;
    },
  } as unknown as ConstructorParameters<
    typeof PostgresServiceListingRepository
  >[0];
  return { database, hasResolved: () => transactionResolved };
}

describe("service listing moderation audit tracking", () => {
  it("invokes the callback with the inserted IDs after the transaction resolves", async () => {
    const { database, hasResolved } = createRepositoryDatabase();
    const callback = vi.fn((auditId: string, listingId: string) => {
      expect(hasResolved()).toBe(true);
      expect(auditId).toBe("00000000-0000-4000-8000-000000000004");
      expect(listingId).toBe(listing.id);
    });
    const repository = new PostgresServiceListingRepository(database, callback);

    const result = await repository.moderate(
      listing.id,
      "00000000-0000-4000-8000-000000000003",
      1,
      "hide",
      "Requires additional policy review.",
    );

    expect(result.type).toBe("success");
    expect(callback).toHaveBeenCalledOnce();
    expect(callback).toHaveBeenCalledWith(
      "00000000-0000-4000-8000-000000000004",
      listing.id,
    );
  });

  it("does not track the inserted audit ID when transaction completion fails", async () => {
    const { database } = createRepositoryDatabase({ rejectCommit: true });
    const trackedAuditIds: { id: string; ownerId: string }[] = [];
    const callback = vi.fn((id: string, ownerId: string) => {
      trackedAuditIds.push({ id, ownerId });
    });
    const repository = new PostgresServiceListingRepository(database, callback);

    await expect(
      repository.moderate(
        listing.id,
        "00000000-0000-4000-8000-000000000003",
        1,
        "hide",
        "Requires additional policy review.",
      ),
    ).rejects.toThrow("Transaction commit failed");

    expect(callback).not.toHaveBeenCalled();
    expect(trackedAuditIds).toEqual([]);
  });
});
