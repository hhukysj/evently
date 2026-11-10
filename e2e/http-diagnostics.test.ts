import { describe, expect, it } from "vitest";
import {
  assertNoUnexpectedHttpFailures,
  classifyHttpFailure,
  formatHttpFailure,
  type ExpectedHttpFailure,
} from "./http-diagnostics.js";

describe("browser HTTP diagnostics", () => {
  it("allows only explicitly expected method, path, and status combinations", () => {
    const expectedFailures: ExpectedHttpFailure[] = [
      {
        method: "POST",
        origin: "http://127.0.0.1:5174",
        pathname: "/api/v1/auth/login",
        status: 401,
      },
    ];

    expect(
      classifyHttpFailure(
        {
          method: "POST",
          url: "http://127.0.0.1:5174/api/v1/auth/login",
          status: 401,
        },
        expectedFailures,
      ),
    ).toBe(true);
    expect(expectedFailures).toEqual([]);
    expect(
      classifyHttpFailure(
        {
          method: "POST",
          url: "http://127.0.0.1:5174/api/v1/auth/login",
          status: 500,
        },
        expectedFailures,
      ),
    ).toBe(false);
    expect(
      classifyHttpFailure(
        {
          method: "POST",
          url: "http://127.0.0.1:3001/api/v1/auth/login",
          status: 401,
        },
        [
          {
            method: "POST",
            origin: "http://127.0.0.1:5174",
            pathname: "/api/v1/auth/login",
            status: 401,
          },
        ],
      ),
    ).toBe(false);
  });

  it("treats the unauthenticated current-user check as expected", () => {
    expect(
      classifyHttpFailure(
        {
          method: "GET",
          url: "http://127.0.0.1:5174/api/v1/auth/me",
          status: 401,
        },
        [],
      ),
    ).toBe(true);
  });

  it("fails with method, status, and a redacted request URL", () => {
    const failure = formatHttpFailure({
      method: "GET",
      url: "http://127.0.0.1:5174/api/v1/service-listings?token=private",
      status: 500,
    });

    expect(failure).toBe(
      "500 GET http://127.0.0.1:5174/api/v1/service-listings?[redacted]",
    );
    expect(() => assertNoUnexpectedHttpFailures([failure])).toThrow(
      `Unexpected HTTP failures:\n${failure}`,
    );
  });
});
