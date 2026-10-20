import { describe, expect, it } from "vitest";
import { ApiErrorResponseSchema, HealthResponseSchema } from "./index.js";

describe("shared API contracts", () => {
  it("accepts the health response envelope", () => {
    expect(
      HealthResponseSchema.safeParse({
        data: { status: "ok", service: "evently-api" },
      }).success,
    ).toBe(true);
  });

  it("requires a request ID and safe error fields", () => {
    expect(
      ApiErrorResponseSchema.safeParse({
        error: {
          code: "NOT_FOUND",
          message: "API route not found",
          requestId: "not-a-uuid",
        },
      }).success,
    ).toBe(false);
  });
});
