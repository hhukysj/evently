import { describe, expect, it } from "vitest";
import {
  accountEmailSchema,
  loginSchema,
  passwordResetSchema,
  registrationSchema,
  userIdParamsSchema,
  verificationSchema,
} from "./contracts.js";

describe("authentication request contracts", () => {
  it("normalizes valid email addresses without changing password contents", () => {
    expect(
      registrationSchema.parse({
        email: "  CUSTOMER+event@example.com ",
        password: "a-safe-test-password",
      }),
    ).toEqual({
      email: "customer+event@example.com",
      password: "a-safe-test-password",
    });
  });

  it("rejects oversized emails and passwords at registration and login", () => {
    const oversizedEmail = `${"a".repeat(250)}@example.com`;
    const oversizedPassword = "p".repeat(129);

    expect(
      registrationSchema.safeParse({
        email: oversizedEmail,
        password: "a-safe-test-password",
      }).success,
    ).toBe(false);
    expect(
      accountEmailSchema.safeParse({ email: oversizedEmail }).success,
    ).toBe(false);
    expect(
      registrationSchema.safeParse({
        email: "customer@example.com",
        password: oversizedPassword,
      }).success,
    ).toBe(false);
    expect(
      loginSchema.safeParse({
        email: "customer@example.com",
        password: oversizedPassword,
      }).success,
    ).toBe(false);
  });

  it("requires exact-length URL-safe tokens and bounded reset passwords", () => {
    const token = "a".repeat(43);
    expect(verificationSchema.safeParse({ token }).success).toBe(true);
    expect(verificationSchema.safeParse({ token: `${token}a` }).success).toBe(
      false,
    );
    expect(
      verificationSchema.safeParse({ token: "a".repeat(42) }).success,
    ).toBe(false);
    expect(
      passwordResetSchema.safeParse({
        token,
        password: "p".repeat(129),
      }).success,
    ).toBe(false);
  });

  it("rejects unknown authorization fields and malformed user identifiers", () => {
    expect(
      registrationSchema.safeParse({
        email: "customer@example.com",
        password: "a-safe-test-password",
        role: "admin",
      }).success,
    ).toBe(false);
    expect(userIdParamsSchema.safeParse({ userId: "not-a-uuid" }).success).toBe(
      false,
    );
  });

  it("rejects arrays and non-object request bodies", () => {
    expect(registrationSchema.safeParse([]).success).toBe(false);
    expect(accountEmailSchema.safeParse("customer@example.com").success).toBe(
      false,
    );
  });
});
