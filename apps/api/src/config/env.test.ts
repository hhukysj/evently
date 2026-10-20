import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("API environment configuration", () => {
  it("validates the PostgreSQL URL and defaults blank optional settings", async () => {
    vi.stubEnv(
      "DATABASE_URL",
      "postgresql://evently_local:local-only@127.0.0.1:5432/evently_local",
    );
    vi.stubEnv("PORT", "");
    vi.stubEnv("NODE_ENV", "");

    const { env } = await import("./env.js");

    expect(env.PORT).toBe(3001);
    expect(env.NODE_ENV).toBe("development");
  });

  it("fails fast when DATABASE_URL is missing", async () => {
    vi.stubEnv("DATABASE_URL", "");

    await expect(import("./env.js")).rejects.toThrow(
      "Invalid API environment configuration: DATABASE_URL",
    );
  });
});
