import { describe, expect, it } from "vitest";
import {
  hideServiceListing,
  isPublicListingState,
  publishServiceListing,
  adminServiceListingQuerySchema,
  providerServiceListingQuerySchema,
  publicServiceListingQuerySchema,
  restoreServiceListing,
  serviceCategories,
  serviceListingInputSchema,
  serviceListingStateSchema,
  serviceListingPatchSchema,
  unpublishServiceListing,
} from "./service-listings.js";

const validListing = {
  categorySlug: "planning_coordination",
  title: "Community event planning",
  description: "Planning and coordination for local community events.",
  city: "Pune",
  pricingMethod: "fixed",
  priceAmountPaise: 0,
};

describe("service listing contracts", () => {
  it("defines the eight approved categories with stable slugs", () => {
    expect(serviceCategories).toEqual([
      { slug: "planning_coordination", name: "Planning and coordination" },
      { slug: "venues_decor", name: "Venues and decor" },
      { slug: "catering_food", name: "Catering and food" },
      {
        slug: "entertainment_performers",
        name: "Entertainment and performers",
      },
      { slug: "photography_video", name: "Photography and video" },
      { slug: "production_rentals", name: "Production and rentals" },
      { slug: "transport_logistics", name: "Transport and logistics" },
      { slug: "other_event_services", name: "Other event services" },
    ]);
  });

  it("accepts a fixed listing with an explicit zero price", () => {
    expect(serviceListingInputSchema.parse(validListing)).toMatchObject({
      pricingMethod: "fixed",
      priceAmountPaise: 0,
    });
  });

  it("requires a price for fixed and starting-at listings, and none for quote-only", () => {
    expect(
      serviceListingInputSchema.safeParse({
        ...validListing,
        pricingMethod: "starting_at",
        priceAmountPaise: 250000,
      }).success,
    ).toBe(true);
    expect(
      serviceListingInputSchema.safeParse({
        ...validListing,
        pricingMethod: "quote_only",
        priceAmountPaise: null,
      }).success,
    ).toBe(true);
    expect(
      serviceListingInputSchema.safeParse({
        ...validListing,
        priceAmountPaise: null,
      }).success,
    ).toBe(false);
    expect(
      serviceListingInputSchema.safeParse({
        ...validListing,
        pricingMethod: "quote_only",
      }).success,
    ).toBe(false);
  });

  it("normalizes omitted, null, blank, and whitespace regions consistently", () => {
    expect(
      serviceListingInputSchema.parse(validListing).region,
    ).toBeUndefined();
    for (const region of [null, "", "   ", "\t\n"]) {
      expect(
        serviceListingInputSchema.parse({ ...validListing, region }).region,
      ).toBeNull();
    }
    expect(
      serviceListingInputSchema.parse({
        ...validListing,
        region: " Maharashtra ",
      }).region,
    ).toBe("Maharashtra");
    expect(
      serviceListingInputSchema.safeParse({
        ...validListing,
        region: "x",
      }).success,
    ).toBe(false);
    expect(
      serviceListingPatchSchema.parse({ region: "   " }).region,
    ).toBeNull();
    expect(
      serviceListingPatchSchema.parse({ title: "Updated title" }).region,
    ).toBeUndefined();
    expect(serviceListingPatchSchema.parse({ region: null }).region).toBeNull();
    expect(
      serviceListingPatchSchema.parse({ region: " Maharashtra " }).region,
    ).toBe("Maharashtra");
  });

  it("rejects invalid text, unsupported fields, and invalid paise values", () => {
    for (const [field, value] of [
      ["title", "\t\t"],
      ["description", "\t".repeat(20)],
      ["city", "\t\t"],
    ] as const) {
      expect(
        serviceListingInputSchema.safeParse({
          ...validListing,
          [field]: value,
        }).success,
      ).toBe(false);
    }

    for (const priceAmountPaise of [-1, 1.5, 2_147_483_648]) {
      expect(
        serviceListingInputSchema.safeParse({
          ...validListing,
          priceAmountPaise,
        }).success,
      ).toBe(false);
    }
    expect(
      serviceListingInputSchema.safeParse({
        ...validListing,
        categorySlug: "event_organizer",
      }).success,
    ).toBe(false);
    expect(
      serviceListingInputSchema.safeParse({
        ...validListing,
        userId: "another-provider",
      }).success,
    ).toBe(false);
    expect(
      serviceListingInputSchema.safeParse({
        ...validListing,
        status: "published",
      }).success,
    ).toBe(false);
    expect(
      serviceListingInputSchema.safeParse({
        ...validListing,
        currency: "USD",
      }).success,
    ).toBe(false);
  });

  it("requires a nonempty patch and paired pricing updates", () => {
    expect(serviceListingPatchSchema.safeParse({}).success).toBe(false);
    expect(
      serviceListingPatchSchema.safeParse({ pricingMethod: "quote_only" })
        .success,
    ).toBe(false);
    expect(
      serviceListingPatchSchema.safeParse({ priceAmountPaise: null }).success,
    ).toBe(false);
    expect(
      serviceListingPatchSchema.safeParse({
        pricingMethod: "quote_only",
        priceAmountPaise: null,
      }).success,
    ).toBe(true);
    expect(
      serviceListingPatchSchema.safeParse({ status: "published" }).success,
    ).toBe(false);
  });

  it("keeps provider publication intent separate from admin moderation", () => {
    const states = [
      { publicationStatus: "draft", moderationStatus: "visible" },
      { publicationStatus: "draft", moderationStatus: "hidden" },
      { publicationStatus: "published", moderationStatus: "visible" },
      { publicationStatus: "published", moderationStatus: "hidden" },
    ] as const;
    for (const state of states) {
      expect(serviceListingStateSchema.parse(state)).toEqual(state);
    }
    expect(states.map(isPublicListingState)).toEqual([
      false,
      false,
      true,
      false,
    ]);

    const hiddenDraft = hideServiceListing(states[0]);
    expect(restoreServiceListing(hiddenDraft)).toEqual(states[0]);
    expect(isPublicListingState(restoreServiceListing(hiddenDraft))).toBe(
      false,
    );

    const hiddenPublished = hideServiceListing(states[2]);
    expect(isPublicListingState(publishServiceListing(hiddenPublished))).toBe(
      false,
    );
    expect(unpublishServiceListing(hiddenPublished)).toEqual(states[1]);
    expect(
      restoreServiceListing(unpublishServiceListing(hiddenPublished)),
    ).toEqual(states[0]);
    expect(isPublicListingState(restoreServiceListing(hiddenPublished))).toBe(
      true,
    );
  });

  it("bounds and validates public search filters", () => {
    expect(publicServiceListingQuerySchema.parse({}).pageSize).toBe(25);
    expect(
      publicServiceListingQuerySchema.safeParse({
        page: "1001",
      }).success,
    ).toBe(false);
    expect(
      publicServiceListingQuerySchema.safeParse({
        pageSize: "51",
      }).success,
    ).toBe(false);
    expect(
      publicServiceListingQuerySchema.safeParse({
        status: "draft",
      }).success,
    ).toBe(false);
    expect(
      publicServiceListingQuerySchema.safeParse({
        ownerId: "another-provider",
      }).success,
    ).toBe(false);
  });

  it("bounds provider-owned listing pagination", () => {
    expect(providerServiceListingQuerySchema.parse({})).toEqual({
      page: 1,
      pageSize: 25,
    });
    expect(
      providerServiceListingQuerySchema.parse({
        page: "2",
        pageSize: "50",
      }),
    ).toEqual({ page: 2, pageSize: 50 });
    expect(
      providerServiceListingQuerySchema.safeParse({ page: "0" }).success,
    ).toBe(false);
    expect(
      providerServiceListingQuerySchema.safeParse({
        pageSize: "51",
      }).success,
    ).toBe(false);
  });

  it("validates bounded admin listing queue filters", () => {
    expect(adminServiceListingQuerySchema.parse({})).toEqual({
      page: 1,
      pageSize: 25,
    });
    expect(
      adminServiceListingQuerySchema.parse({
        page: "2",
        pageSize: "50",
        publicationStatus: "published",
        moderationStatus: "hidden",
        categorySlug: "planning_coordination",
        city: "Pune",
      }),
    ).toEqual({
      page: 2,
      pageSize: 50,
      publicationStatus: "published",
      moderationStatus: "hidden",
      categorySlug: "planning_coordination",
      city: "Pune",
    });
    for (const query of [
      { pageSize: "51" },
      { publicationStatus: "archived" },
      { moderationStatus: "pending" },
      { categorySlug: "unsupported" },
      { ownerId: "another-user" },
    ]) {
      expect(adminServiceListingQuerySchema.safeParse(query).success).toBe(
        false,
      );
    }
  });
});
