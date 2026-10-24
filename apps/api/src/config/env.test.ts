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
    vi.stubEnv("SESSION_SECRET", "test-only-session-secret-at-least-32-chars");
    vi.stubEnv("PORT", "");
    vi.stubEnv("NODE_ENV", "");
    vi.stubEnv("APP_ORIGIN", "");

    const { env } = await import("./env.js");

    expect(env.PORT).toBe(3001);
    expect(env.NODE_ENV).toBe("development");
  });

  it("fails fast when DATABASE_URL is missing", async () => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("SESSION_SECRET", "test-only-session-secret-at-least-32-chars");

    await expect(import("./env.js")).rejects.toThrow(
      "Invalid API environment configuration: DATABASE_URL",
    );
  });

  it("requires a sufficiently long session secret", async () => {
    vi.stubEnv("DATABASE_URL", "postgresql://user:password@localhost/evently");
    vi.stubEnv("SESSION_SECRET", "too-short");

    await expect(import("./env.js")).rejects.toThrow(
      "Invalid API environment configuration: SESSION_SECRET",
    );
  });

  it("rejects an application URL that is not an exact origin", async () => {
    vi.stubEnv("DATABASE_URL", "postgresql://user:password@localhost/evently");
    vi.stubEnv("SESSION_SECRET", "test-only-session-secret-at-least-32-chars");
    vi.stubEnv("APP_ORIGIN", "https://evently.example/app");

    await expect(import("./env.js")).rejects.toThrow(
      "Invalid API environment configuration: APP_ORIGIN",
    );
  });
});
