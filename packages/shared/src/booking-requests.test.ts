import { describe, expect, it, vi } from "vitest";
import {
  bookingRequestCreationInputSchema,
  bookingRequestDtoSchema,
} from "./booking-requests.js";

const validInput = {
  serviceListingId: "00000000-0000-4000-8000-000000000001",
  idempotencyKey: "00000000-0000-4000-8000-000000000002",
  eventType: "Community festival",
  eventDate: "2099-12-31",
  eventTimezone: "Asia/Kolkata",
  eventLocation: { city: "Pune" },
  guestCount: 80,
};

describe("booking request contracts", () => {
  it("accepts canonical IANA zones and UTC but rejects fixed offsets", () => {
    expect(
      bookingRequestCreationInputSchema.safeParse({
        ...validInput,
        eventTimezone: "UTC",
      }).success,
    ).toBe(true);
    expect(
      bookingRequestCreationInputSchema.safeParse(validInput).success,
    ).toBe(true);
    let supportsAsiaCalcutta = true;
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Calcutta" });
    } catch {
      supportsAsiaCalcutta = false;
    }
    expect(
      bookingRequestCreationInputSchema.safeParse({
        ...validInput,
        eventTimezone: "Asia/Calcutta",
      }).success,
    ).toBe(supportsAsiaCalcutta);
    expect(
      bookingRequestCreationInputSchema.safeParse({
        ...validInput,
        eventTimezone: "+01:00",
      }).success,
    ).toBe(false);
    expect(
      bookingRequestCreationInputSchema.safeParse({
        ...validInput,
        eventTimezone: "Not/A_Timezone",
      }).success,
    ).toBe(false);
  });

  it("rejects past or invalid calendar dates", () => {
    expect(
      bookingRequestCreationInputSchema.safeParse({
        ...validInput,
        eventDate: "2000-01-01",
      }).success,
    ).toBe(false);
    expect(
      bookingRequestCreationInputSchema.safeParse({
        ...validInput,
        eventDate: "2099-02-29",
      }).success,
    ).toBe(false);
  });

  it("compares the event date against the local date at a UTC date boundary", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-02T00:30:00.000Z"));
    try {
      const result = bookingRequestCreationInputSchema.safeParse({
        ...validInput,
        eventDate: "2026-01-01",
        eventTimezone: "America/Los_Angeles",
      });
      expect(result.success).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects unknown ownership and snapshot fields and invalid guest/budget values", () => {
    expect(
      bookingRequestCreationInputSchema.safeParse({
        ...validInput,
        customerUserId: "00000000-0000-4000-8000-000000000003",
      }).success,
    ).toBe(false);
    expect(
      bookingRequestCreationInputSchema.safeParse({
        ...validInput,
        guestCount: 0,
      }).success,
    ).toBe(false);
    expect(
      bookingRequestCreationInputSchema.safeParse({
        ...validInput,
        budgetMinAmountPaise: 50_000,
        budgetMaxAmountPaise: 10_000,
      }).success,
    ).toBe(false);
  });

  it("validates DTO budget ordering and permits both bounds to be null", () => {
    const dto = {
      id: "00000000-0000-4000-8000-000000000010",
      serviceListingId: null,
      service: {
        title: "Festival catering",
        description: "Fresh locally prepared food for community celebrations.",
        city: "Pune",
        region: null,
        category: { slug: "catering_food", name: "Catering and food" },
        pricingMethod: "quote_only",
        priceAmountPaise: null,
        currency: "INR",
      },
      providerDisplayName: "Community Caterers",
      eventType: "Community festival",
      eventDate: "2099-12-31",
      eventTimezone: "UTC",
      eventLocation: { city: "Pune", region: null, venueOrArea: null },
      guestCount: 80,
      budgetMinAmountPaise: null,
      budgetMaxAmountPaise: null,
      additionalNotes: null,
      status: "requested",
      statusHistory: [],
      createdAt: "2026-11-13T00:00:00.000Z",
      updatedAt: "2026-11-13T00:00:00.000Z",
    };
    expect(bookingRequestDtoSchema.safeParse(dto).success).toBe(true);
    expect(
      bookingRequestDtoSchema.safeParse({
        ...dto,
        budgetMinAmountPaise: 20_000,
        budgetMaxAmountPaise: 10_000,
      }).success,
    ).toBe(false);
    expect(
      bookingRequestDtoSchema.safeParse({
        ...dto,
        budgetMinAmountPaise: -1,
      }).success,
    ).toBe(false);
  });
});
