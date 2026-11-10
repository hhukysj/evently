import { describe, expect, it, vi } from "vitest";
import {
  assertIntegrationDatabaseIdentity,
  assertIntegrationDatabaseTarget,
  requireIntegrationDatabaseUrl,
  verifyIntegrationDatabase,
  type IntegrationDatabaseEnvironment,
  type IntegrationDatabaseIdentity,
} from "./integration-database.js";

const localEnvironment: IntegrationDatabaseEnvironment = {};
const ciEnvironment: IntegrationDatabaseEnvironment = {
  CI: "true",
  GITHUB_ACTIONS: "true",
  GITHUB_WORKFLOW: "CI",
};
const localUrl =
  "postgresql://evently_verifier@127.0.0.1:5432/evently_verify_fresh";
const ciUrl = "postgresql://evently:ci-only@localhost:5432/evently_test";

function identity(
  overrides: Partial<IntegrationDatabaseIdentity> = {},
): IntegrationDatabaseIdentity {
  return {
    database: "evently_verify_fresh",
    role: "evently_verifier",
    owner: "evently_verifier",
    address: "127.0.0.1",
    port: 5432,
    version: "170005",
    ...overrides,
  };
}

describe("integration database target policy", () => {
  it("requires the explicit test URL instead of DATABASE_URL fallback", () => {
    expect(() =>
      requireIntegrationDatabaseUrl({
        DATABASE_URL: "postgresql://evently@localhost:5432/evently",
      }),
    ).toThrow("EVENTLY_INTEGRATION_DATABASE_URL is required.");
    expect(
      requireIntegrationDatabaseUrl({
        DATABASE_URL: "postgresql://evently@localhost:5432/evently",
        EVENTLY_INTEGRATION_DATABASE_URL: localUrl,
      }),
    ).toBe(localUrl);
  });

  it("accepts only explicitly approved local verifier targets", () => {
    expect(assertIntegrationDatabaseTarget(localUrl, localEnvironment)).toBe(
      "local",
    );
    expect(() =>
      assertIntegrationDatabaseTarget(
        "postgresql://evently_verifier@127.0.0.1:5432/evently",
        localEnvironment,
      ),
    ).toThrow();
    expect(() =>
      assertIntegrationDatabaseTarget(
        "postgresql://evently_verifier@remote.example:5432/evently_verify_fresh",
        localEnvironment,
      ),
    ).toThrow();
    expect(() =>
      assertIntegrationDatabaseTarget(
        "postgresql://evently_verifier:password@127.0.0.1:5432/evently_verify_fresh",
        localEnvironment,
      ),
    ).toThrow();
  });

  it("separates the GitHub Actions target from local verifier targets", () => {
    expect(assertIntegrationDatabaseTarget(ciUrl, ciEnvironment)).toBe("ci");
    expect(() =>
      assertIntegrationDatabaseTarget(ciUrl, localEnvironment),
    ).toThrow();
    expect(() =>
      assertIntegrationDatabaseTarget(localUrl, ciEnvironment),
    ).toThrow();
    expect(() =>
      assertIntegrationDatabaseTarget(ciUrl, { CI: "true" }),
    ).toThrow();
    expect(() =>
      assertIntegrationDatabaseTarget(ciUrl, {
        CI: "true",
        GITHUB_ACTIONS: "true",
        GITHUB_WORKFLOW: "other",
      }),
    ).toThrow();
  });

  it("rejects unexpected roles, owners, configuration, and missing identity", () => {
    for (const invalidIdentity of [
      identity({ role: "evently" }),
      identity({ owner: "postgres" }),
      identity({ database: "evently" }),
      identity({ address: null }),
      identity({ port: null }),
      identity({ version: "160000" }),
      identity({ version: "17unexpected" }),
      identity({ version: null }),
    ]) {
      expect(() =>
        assertIntegrationDatabaseIdentity(invalidIdentity, localUrl, "local"),
      ).toThrow();
    }
    expect(() =>
      assertIntegrationDatabaseIdentity(undefined, localUrl, "local"),
    ).toThrow();
  });

  it("requires the CI database owner and private service address", () => {
    const ciIdentity = identity({
      database: "evently_test",
      role: "evently",
      owner: "evently",
      address: "172.20.0.2",
    });
    expect(() =>
      assertIntegrationDatabaseIdentity(ciIdentity, ciUrl, "ci"),
    ).not.toThrow();
    expect(() =>
      assertIntegrationDatabaseIdentity(
        { ...ciIdentity, owner: "postgres" },
        ciUrl,
        "ci",
      ),
    ).toThrow();
    expect(() =>
      assertIntegrationDatabaseIdentity(
        { ...ciIdentity, address: "203.0.113.10" },
        ciUrl,
        "ci",
      ),
    ).toThrow();
    expect(() =>
      assertIntegrationDatabaseIdentity(
        { ...ciIdentity, address: null },
        ciUrl,
        "ci",
      ),
    ).toThrow();
  });

  it("runs a read-only identity query before accepting a target", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [identity()] });
    await expect(
      verifyIntegrationDatabase(localUrl, { query }, localEnvironment),
    ).resolves.toBeUndefined();
    expect(query).toHaveBeenCalledOnce();
    expect(query.mock.calls[0]?.[0]).toContain("current_database()");

    const rejectedQuery = vi.fn().mockResolvedValue({ rows: [] });
    await expect(
      verifyIntegrationDatabase(
        localUrl,
        { query: rejectedQuery },
        localEnvironment,
      ),
    ).rejects.toThrow();

    const mismatchedTargetQuery = vi.fn();
    await expect(
      verifyIntegrationDatabase(
        localUrl,
        { query: mismatchedTargetQuery },
        localEnvironment,
        "postgresql://evently_verifier@127.0.0.1:5432/evently",
      ),
    ).rejects.toThrow();
    expect(mismatchedTargetQuery).not.toHaveBeenCalled();
  });
});
