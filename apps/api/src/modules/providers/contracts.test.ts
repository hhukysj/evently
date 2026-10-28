import { describe, expect, it } from "vitest";
import {
  professionalProfilePatchSchema,
  providerApplicationQuerySchema,
  providerApplicationSchema,
  rejectProviderApplicationSchema,
} from "./contracts.js";

const validApplication = {
  displayName: "  Event Studio  ",
  description: "We organize small and medium community events across the city.",
  city: "  Pune ",
  region: "Maharashtra",
  country: "India",
  providerTypes: ["event_organizer", "artist_performer"],
};

describe("provider contracts", () => {
  it("normalizes valid applications and permits multiple distinct provider types", () => {
    expect(providerApplicationSchema.parse(validApplication)).toMatchObject({
      displayName: "Event Studio",
      city: "Pune",
      providerTypes: ["event_organizer", "artist_performer"],
    });
  });

  it("rejects role, owner, approval, unknown type and duplicate type fields", () => {
    expect(
      providerApplicationSchema.safeParse({
        ...validApplication,
        userId: "d577e5b3-2f4c-4f93-8fb3-4a01fe779dfa",
      }).success,
    ).toBe(false);
    expect(
      providerApplicationSchema.safeParse({
        ...validApplication,
        role: "professional",
      }).success,
    ).toBe(false);
    expect(
      providerApplicationSchema.safeParse({
        ...validApplication,
        status: "approved",
      }).success,
    ).toBe(false);
    expect(
      providerApplicationSchema.safeParse({
        ...validApplication,
        providerTypes: ["event_organizer", "event_organizer"],
      }).success,
    ).toBe(false);
    expect(
      providerApplicationSchema.safeParse({
        ...validApplication,
        providerTypes: ["made_up_type"],
      }).success,
    ).toBe(false);
  });

  it("bounds application text and requires a useful description", () => {
    expect(
      providerApplicationSchema.safeParse({
        ...validApplication,
        displayName: "x".repeat(121),
      }).success,
    ).toBe(false);
    expect(
      providerApplicationSchema.safeParse({
        ...validApplication,
        description: "too short",
      }).success,
    ).toBe(false);
    expect(
      providerApplicationSchema.safeParse({
        ...validApplication,
        description: "x".repeat(1201),
      }).success,
    ).toBe(false);
  });

  it("bounds admin pagination and rejects unknown or repeated query fields", () => {
    expect(providerApplicationQuerySchema.parse({}).pageSize).toBe(25);
    expect(
      providerApplicationQuerySchema.safeParse({
        page: "1001",
      }).success,
    ).toBe(false);
    expect(
      providerApplicationQuerySchema.safeParse({
        pageSize: "51",
      }).success,
    ).toBe(false);
    expect(
      providerApplicationQuerySchema.safeParse({
        page: ["1", "2"],
      }).success,
    ).toBe(false);
    expect(
      providerApplicationQuerySchema.safeParse({
        ownerId: "another-user",
      }).success,
    ).toBe(false);
  });

  it("allows only supported, nonempty profile updates and bounded rejection reasons", () => {
    expect(
      professionalProfilePatchSchema.safeParse({
        headline: "Event planner",
        city: "Pune",
      }).success,
    ).toBe(true);
    expect(
      professionalProfilePatchSchema.safeParse({
        slug: "unapproved-slug",
      }).success,
    ).toBe(false);
    expect(professionalProfilePatchSchema.safeParse({}).success).toBe(false);
    expect(
      rejectProviderApplicationSchema.safeParse({
        reason: "Please add more service details.",
      }).success,
    ).toBe(true);
    expect(
      rejectProviderApplicationSchema.safeParse({
        reason: "no",
      }).success,
    ).toBe(false);
  });
});
