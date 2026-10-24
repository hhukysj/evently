// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App.js";

const authenticatedUser = {
  id: "7d984179-9852-45ca-bacb-33a1e21e051c",
  email: "customer@example.com",
  role: "customer",
  createdAt: "2026-10-20T08:00:00.000Z",
};

function mockFetch(
  responses: Record<string, (init?: RequestInit) => Response>,
): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input), window.location.origin).pathname;
    const response = responses[path];
    if (!response) {
      throw new Error(`Unexpected request to ${path}`);
    }
    return Promise.resolve(response(init));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function setPath(path: string): void {
  window.history.replaceState({}, "", path);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setPath("/");
});

describe("authentication screens", () => {
  it("registers through the CSRF-protected API and shows non-delivery local inbox links", async () => {
    const fetchMock = mockFetch({
      "/api/v1/auth/me": () =>
        jsonResponse({ error: { message: "Sign in" } }, 401),
      "/api/v1/auth/csrf": () =>
        jsonResponse({ data: { csrfToken: "csrf-value" } }),
      "/api/v1/auth/register": () =>
        jsonResponse(
          {
            data: {
              message:
                "If this address can be registered, account instructions are available through the configured channel.",
            },
          },
          202,
        ),
      "/api/v1/dev/email-inbox": () =>
        jsonResponse({
          data: {
            messages: [
              {
                id: "message-id",
                type: "email_verification",
                email: "customer@example.com",
                token: "v".repeat(43),
                createdAt: "2026-10-20T08:00:00.000Z",
              },
            ],
          },
        }),
    });
    setPath("/register");
    render(<App />);

    fireEvent.change(screen.getByLabelText("Email address"), {
      target: { value: "customer@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "long-enough-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Show password" }));
    expect(screen.getByLabelText("Password").getAttribute("type")).toBe("text");
    fireEvent.click(screen.getByRole("button", { name: "Hide password" }));
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));

    expect(
      await screen.findByText(/If this address can be registered/),
    ).toBeTruthy();
    expect(
      (
        await screen.findByRole("link", { name: "Open local link" })
      ).getAttribute("href"),
    ).toBe(`/verify-email?token=${"v".repeat(43)}`);
    expect(
      screen.getByText(/They are not sent to an email address/),
    ).toBeTruthy();

    const registrationRequest = fetchMock.mock.calls.find(
      ([input]) => String(input) === "/api/v1/auth/register",
    );
    expect(registrationRequest?.[1]?.method).toBe("POST");
    expect(
      new Headers(registrationRequest?.[1]?.headers).get("X-CSRF-Token"),
    ).toBe("csrf-value");
    expect(registrationRequest?.[1]?.credentials).toBe("same-origin");
  });

  it("signs in with a generic API error path and invalidates the session on logout", async () => {
    const calls: Array<{ path: string; init?: RequestInit }> = [];
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input), window.location.origin).pathname;
      calls.push({ path, init });
      if (path === "/api/v1/auth/me") {
        return Promise.resolve(
          calls.filter((call) => call.path === path).length === 1
            ? jsonResponse({ error: { message: "Unauthenticated" } }, 401)
            : jsonResponse({ data: { user: authenticatedUser } }),
        );
      }
      if (path === "/api/v1/auth/csrf") {
        return Promise.resolve(
          jsonResponse({ data: { csrfToken: "csrf-value" } }),
        );
      }
      if (path === "/api/v1/auth/login") {
        return Promise.resolve(
          jsonResponse({
            data: { user: authenticatedUser, csrfToken: "rotated" },
          }),
        );
      }
      if (path === "/api/v1/auth/logout") {
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      if (path === "/api/v1/dev/email-inbox") {
        return Promise.resolve(jsonResponse({ data: { messages: [] } }));
      }
      throw new Error(`Unexpected request to ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    setPath("/login");
    render(<App />);

    fireEvent.change(screen.getByLabelText("Email address"), {
      target: { value: authenticatedUser.email },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "long-enough-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(
      await screen.findByText(
        `You are signed in as ${authenticatedUser.email}.`,
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await waitFor(() =>
      expect(screen.getByRole("link", { name: "Sign in" })).toBeTruthy(),
    );
    await waitFor(() =>
      expect(
        screen.queryByText(`You are signed in as ${authenticatedUser.email}.`),
      ).toBeNull(),
    );

    const logoutCall = calls.find(
      (call) => call.path === "/api/v1/auth/logout",
    );
    expect(logoutCall?.init?.method).toBe("POST");
    expect(new Headers(logoutCall?.init?.headers).get("X-CSRF-Token")).toBe(
      "csrf-value",
    );
    expect(calls.some((call) => call.path === "/api/v1/auth/login")).toBe(true);
  });

  it("submits verification and password-reset tokens without rendering them as fields", async () => {
    const fetchMock = mockFetch({
      "/api/v1/auth/me": () =>
        jsonResponse({ error: { message: "Sign in" } }, 401),
      "/api/v1/auth/csrf": () =>
        jsonResponse({ data: { csrfToken: "csrf-value" } }),
      "/api/v1/auth/verify-email": () =>
        jsonResponse({
          data: {
            message: "If the verification link was valid, it is complete.",
          },
        }),
      "/api/v1/auth/reset-password": () =>
        jsonResponse({
          data: {
            message: "If the reset link was valid, the password is updated.",
          },
        }),
      "/api/v1/dev/email-inbox": () => jsonResponse({ data: { messages: [] } }),
    });
    setPath(`/verify-email?token=${"t".repeat(43)}`);
    const { unmount } = render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Verify email" }));
    expect(
      await screen.findByText(/If the verification link was valid/),
    ).toBeTruthy();

    unmount();
    setPath(`/reset-password?token=${"r".repeat(43)}`);
    render(<App />);
    fireEvent.change(screen.getByLabelText("New password"), {
      target: { value: "new-password-long-enough" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Update password" }));
    expect(await screen.findByText(/If the reset link was valid/)).toBeTruthy();
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toContain(
      "/api/v1/auth/verify-email",
    );
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toContain(
      "/api/v1/auth/reset-password",
    );
  });

  it("provides an account-enumeration-neutral forgot-password form and surfaces server errors", async () => {
    mockFetch({
      "/api/v1/auth/me": () =>
        jsonResponse({ error: { message: "Sign in" } }, 401),
      "/api/v1/auth/csrf": () =>
        jsonResponse({ data: { csrfToken: "csrf-value" } }),
      "/api/v1/auth/forgot-password": () =>
        jsonResponse(
          {
            error: {
              code: "EMAIL_DELIVERY_UNAVAILABLE",
              message: "Account email delivery is not configured",
            },
          },
          503,
        ),
      "/api/v1/dev/email-inbox": () => jsonResponse({ data: { messages: [] } }),
    });
    setPath("/forgot-password");
    render(<App />);

    expect(
      screen.getByText(/response does not reveal whether an account exists/i),
    ).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Email address"), {
      target: { value: "customer@example.com" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Request password reset" }),
    );
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Account email delivery is not configured",
    );
  });
});
