// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CurrentUser } from "./auth-api.js";
import type {
  AdminProviderApplication,
  ProfessionalProfile,
  ProviderApplication,
} from "./provider-api.js";
import {
  AdminProviderApplicationsScreen,
  ProfessionalProfileScreen,
  ProviderApplicationScreen,
} from "./ProviderScreens.js";

const customer: CurrentUser = {
  id: "7d984179-9852-45ca-bacb-33a1e21e051c",
  email: "customer@example.test",
  role: "customer",
  createdAt: "2026-10-20T08:00:00.000Z",
};

const admin: CurrentUser = { ...customer, role: "admin" };
const professional: CurrentUser = { ...customer, role: "professional" };

const pendingApplication: AdminProviderApplication = {
  id: "3b511912-4304-4bc0-9002-a4f8a82bd9e8",
  displayName: "Event Studio",
  description: "Planning small and medium community events with care.",
  city: "Pune",
  region: "Maharashtra",
  country: "India",
  providerTypes: ["event_organizer"],
  status: "pending",
  createdAt: "2026-10-21T08:00:00.000Z",
  applicant: {
    id: "a51514f8-1d50-49bb-9649-35d3659c284f",
    email: "applicant@example.test",
  },
  reviewerUserId: null,
  rejectionReason: null,
  reviewedAt: null,
};

const profile: ProfessionalProfile = {
  id: "9a78ca98-5768-40eb-a8da-556d2d181331",
  displayName: "Event Studio",
  slug: "event-studio-7d984179-9852-45ca-bacb-33a1e21e051c",
  headline: "Thoughtful event planning",
  bio: "Planning community events.",
  city: "Pune",
  region: "Maharashtra",
  country: "India",
  status: "draft",
  providerTypes: ["event_organizer"],
  createdAt: "2026-10-21T08:00:00.000Z",
  updatedAt: "2026-10-21T08:00:00.000Z",
};

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function stubFetch(
  handler: (path: string, init?: RequestInit) => Response,
): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input), window.location.origin).pathname;
    return Promise.resolve(handler(path, init));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("provider onboarding and profile screens", () => {
  it("submits a real provider application and shows its server-confirmed status", async () => {
    let application: ProviderApplication | null = null;
    const fetchMock = stubFetch((path, init) => {
      if (path === "/api/v1/provider-applications/me") {
        return jsonResponse({ data: { application } });
      }
      if (path === "/api/v1/auth/csrf") {
        return jsonResponse({ data: { csrfToken: "csrf-test" } });
      }
      if (path === "/api/v1/provider-applications" && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as {
          displayName: string;
          providerTypes: string[];
        };
        expect(body.displayName).toBe("Event Studio");
        expect(body.providerTypes).toEqual(["event_organizer"]);
        application = {
          ...pendingApplication,
          displayName: body.displayName,
          status: "pending",
        };
        return jsonResponse({ data: { status: "pending" } }, 201);
      }
      throw new Error(`Unexpected request to ${path}`);
    });
    render(<ProviderApplicationScreen user={customer} />);

    fireEvent.change(await screen.findByLabelText("Business or display name"), {
      target: { value: "Event Studio" },
    });
    fireEvent.click(await screen.findByLabelText("Event organizer"));
    fireEvent.change(
      await screen.findByLabelText("Briefly describe your services"),
      {
        target: {
          value:
            "Planning small and medium community events with care and reliable local partners.",
        },
      },
    );
    fireEvent.change(await screen.findByLabelText("City"), {
      target: { value: "Pune" },
    });
    fireEvent.change(await screen.findByLabelText("Region or state"), {
      target: { value: "Maharashtra" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Submit application" }));

    expect(await screen.findByText("Application under review")).toBeTruthy();
    expect(
      fetchMock.mock.calls.some(([input]) =>
        String(input).includes("/api/v1/provider-applications"),
      ),
    ).toBe(true);
    const post = fetchMock.mock.calls.find(
      ([input, init]) =>
        String(input) === "/api/v1/provider-applications" &&
        init?.method === "POST",
    );
    expect(new Headers(post?.[1]?.headers).get("X-CSRF-Token")).toBe(
      "csrf-test",
    );
    expect(post?.[1]?.credentials).toBe("same-origin");
  });

  it("provides functional admin review and prevents duplicate review submission", async () => {
    let status = "pending";
    const fetchMock = stubFetch((path, init) => {
      if (path === "/api/v1/admin/provider-applications") {
        return jsonResponse({
          data: {
            applications: status === "pending" ? [pendingApplication] : [],
            pagination: { total: status === "pending" ? 1 : 0 },
          },
        });
      }
      if (
        path === `/api/v1/admin/provider-applications/${pendingApplication.id}`
      ) {
        return jsonResponse({
          data: {
            application: { ...pendingApplication, status },
          },
        });
      }
      if (path === "/api/v1/auth/csrf") {
        return jsonResponse({ data: { csrfToken: "admin-csrf" } });
      }
      if (path.endsWith("/approve") && init?.method === "POST") {
        status = "approved";
        return jsonResponse({ data: { status } });
      }
      throw new Error(`Unexpected request to ${path}`);
    });
    render(<AdminProviderApplicationsScreen user={admin} />);

    fireEvent.click(
      await screen.findByRole("button", { name: /Event Studio/ }),
    );
    expect(await screen.findByText("applicant@example.test")).toBeTruthy();
    const approve = screen.getByRole("button", {
      name: "Approve application",
    });
    fireEvent.click(approve);
    expect(
      await screen.findByText(
        "Application approved and professional profile created.",
      ),
    ).toBeTruthy();
    expect(
      fetchMock.mock.calls.some(([, init]) => init?.method === "POST"),
    ).toBe(true);
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Approve application" }),
      ).toBeNull(),
    );
  });

  it("loads and saves only the supported profile fields", async () => {
    let savedBody: Record<string, unknown> | undefined;
    let savedProfile: ProfessionalProfile = profile;
    const fetchMock = stubFetch((path, init) => {
      if (path === "/api/v1/professional/me") {
        return jsonResponse({ data: { profile: savedProfile } });
      }
      if (path === "/api/v1/auth/csrf") {
        return jsonResponse({ data: { csrfToken: "profile-csrf" } });
      }
      if (
        path === "/api/v1/professional/me/profile" &&
        init?.method === "PATCH"
      ) {
        savedBody = JSON.parse(String(init.body)) as Record<string, unknown>;
        savedProfile = {
          ...profile,
          ...(savedBody as Partial<typeof profile>),
        };
        return jsonResponse({ data: { profile: savedProfile } });
      }
      throw new Error(`Unexpected request to ${path}`);
    });
    render(<ProfessionalProfileScreen user={professional} />);

    fireEvent.change(await screen.findByLabelText("City"), {
      target: { value: "Mumbai" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save profile" }));

    expect(await screen.findByText("Profile changes saved.")).toBeTruthy();
    expect(savedBody).toMatchObject({ city: "Mumbai" });
    expect(savedBody).not.toHaveProperty("slug");
    expect(savedBody).not.toHaveProperty("userId");
    expect(
      fetchMock.mock.calls.some(
        ([input, init]) =>
          String(input) === "/api/v1/professional/me/profile" &&
          init?.method === "PATCH",
      ),
    ).toBe(true);
  });

  it("does not render admin review actions to a customer", () => {
    render(<AdminProviderApplicationsScreen user={customer} />);
    expect(screen.getByText("Admin access required")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Approve application" }),
    ).toBeNull();
  });
});
