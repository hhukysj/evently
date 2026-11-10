import { afterEach, describe, expect, it, vi } from "vitest";
import type { ServiceListingInput } from "@evently/shared";
import type { OwnerServiceListing } from "./repository.js";
import { PostgresServiceListingRepository } from "./repository.js";
import { TrackingServiceListingRepository } from "./tracking-repository.js";

const userId = "00000000-0000-4000-8000-000000000003";
const profileId = "00000000-0000-4000-8000-000000000002";
const listing: OwnerServiceListing = {
  id: "00000000-0000-4000-8000-000000000001",
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
  moderationReason: null,
  version: 1,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
};
const input: ServiceListingInput = {
  categorySlug: "planning_coordination",
  title: listing.title,
  description: listing.description,
  city: listing.city,
  pricingMethod: listing.pricingMethod,
  priceAmountPaise: 1000,
};

const createSpy = vi.spyOn(
  PostgresServiceListingRepository.prototype,
  "create",
);

afterEach(() => {
  createSpy.mockReset();
});

describe("tracking service listing repository", () => {
  it("tracks the committed ID before a later response failure", async () => {
    let transactionResolved = false;
    createSpy.mockImplementation(async () => {
      transactionResolved = true;
      return listing;
    });

    const trackedListings: { id: string; ownerId: string }[] = [];
    const repository = new TrackingServiceListingRepository(
      {} as unknown as ConstructorParameters<
        typeof PostgresServiceListingRepository
      >[0],
      (requestedUserId) => (requestedUserId === userId ? profileId : undefined),
      (listingId, ownerProfileId) => {
        expect(transactionResolved).toBe(true);
        trackedListings.push({ id: listingId, ownerId: ownerProfileId });
      },
      vi.fn(),
    );

    const responsePromise = repository.create(userId, input).then(() => {
      throw new Error("Simulated route response failure");
    });

    await expect(responsePromise).rejects.toThrow(
      "Simulated route response failure",
    );
    expect(trackedListings).toEqual([{ id: listing.id, ownerId: profileId }]);
  });
});
