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

  it("bounds API error fields and rejects empty values", () => {
    const response = (code: string, message: string) =>
      ApiErrorResponseSchema.safeParse({
        error: {
          code,
          message,
          requestId: "7d984179-9852-45ca-bacb-33a1e21e051c",
        },
      }).success;

    expect(response("NOT_FOUND", "API route not found")).toBe(true);
    expect(response("", "API route not found")).toBe(false);
    expect(response("N".repeat(65), "API route not found")).toBe(false);
    expect(response("NOT_FOUND", "")).toBe(false);
    expect(response("NOT_FOUND", "m".repeat(1025))).toBe(false);
  });
});
