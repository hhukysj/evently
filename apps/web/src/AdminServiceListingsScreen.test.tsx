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
import { AdminServiceListingsScreen } from "./AdminServiceListingsScreen.js";

const admin: CurrentUser = {
  id: "7660983b-946a-4281-a4c1-1b9ccce87d46",
  email: "admin@example.test",
  role: "admin",
  createdAt: "2026-10-20T08:00:00.000Z",
};

const visibleListing = {
  id: "3b511912-4304-4bc0-9002-a4f8a82bd9e8",
  category: {
    slug: "planning_coordination",
    name: "Planning and coordination",
  },
  title: "Community event planning",
  city: "Pune",
  region: "Maharashtra",
  pricingMethod: "fixed",
  priceAmountPaise: 250000,
  currency: "INR",
  publicationStatus: "published",
  moderationStatus: "visible",
  moderationReason: null,
  version: 1,
  createdAt: "2026-10-21T08:00:00.000Z",
  updatedAt: "2026-10-21T08:00:00.000Z",
  provider: { displayName: "Community Events", slug: "community-events" },
};

const hiddenDetail = {
  ...visibleListing,
  categorySlug: visibleListing.category.slug,
  description: "Planning and coordination for local community events.",
  moderationStatus: "hidden",
  moderationReason: "Please update the service description.",
  version: 2,
};

function response(data: unknown, status = 200, etag?: string): Response {
  const isError = typeof data === "object" && data !== null && "error" in data;
  return new Response(JSON.stringify(isError ? data : { data }), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...(etag ? { ETag: etag } : {}),
    },
  });
}

function stubFetch(
  handler: (path: string, init?: RequestInit) => Response | Promise<Response>,
) {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), window.location.origin);
    return Promise.resolve(handler(url.pathname, init));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("admin service listing moderation", () => {
  it("filters the queue, opens details, and restores a hidden listing", async () => {
    let restored = false;
    const fetchMock = stubFetch((path, init) => {
      if (path === "/api/v1/admin/service-listings" && !init?.method) {
        return response({
          listings: [
            {
              ...visibleListing,
              moderationStatus: restored ? "visible" : "hidden",
              moderationReason: restored
                ? null
                : "Please update the service description.",
            },
          ],
          pagination: { page: 1, pageSize: 25, total: 1 },
        });
      }
      if (
        path === `/api/v1/admin/service-listings/${visibleListing.id}` &&
        !init?.method
      ) {
        return response(
          { listing: hiddenDetail },
          200,
          '"service-listing:test:v2"',
        );
      }
      if (path === "/api/v1/auth/csrf") {
        return response({ csrfToken: "admin-csrf" });
      }
      if (
        path ===
          `/api/v1/admin/service-listings/${visibleListing.id}/restore` &&
        init?.method === "POST"
      ) {
        expect(new Headers(init.headers).get("If-Match")).toBe(
          '"service-listing:test:v2"',
        );
        expect(new Headers(init.headers).get("X-CSRF-Token")).toBe(
          "admin-csrf",
        );
        restored = true;
        return response(
          {
            listing: {
              ...hiddenDetail,
              moderationStatus: "visible",
              moderationReason: null,
              version: 3,
            },
          },
          200,
          '"service-listing:test:v3"',
        );
      }
      throw new Error(`Unexpected request to ${path}`);
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<AdminServiceListingsScreen user={admin} />);
    expect(await screen.findByText("Community event planning")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Moderation status"), {
      target: { value: "hidden" },
    });
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([input]) =>
          String(input).includes("moderationStatus=hidden"),
        ),
      ).toBe(true),
    );

    fireEvent.click(screen.getByRole("button", { name: "Review listing" }));
    expect(
      await screen.findByText("Please update the service description."),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Restore listing" }));
    expect(
      await screen.findByRole("button", { name: "Hide listing" }),
    ).toBeTruthy();
    expect(restored).toBe(true);
    expect(
      fetchMock.mock.calls.some(
        ([path, init]) =>
          String(path).endsWith("/restore") && init?.method === "POST",
      ),
    ).toBe(true);
  });

  it("submits a required reason when an administrator hides a visible listing", async () => {
    const fetchMock = stubFetch((path, init) => {
      if (path === "/api/v1/admin/service-listings" && !init?.method) {
        return response({
          listings: [visibleListing],
          pagination: { page: 1, pageSize: 25, total: 1 },
        });
      }
      if (
        path === `/api/v1/admin/service-listings/${visibleListing.id}` &&
        !init?.method
      ) {
        return response(
          {
            listing: {
              ...visibleListing,
              categorySlug: visibleListing.category.slug,
              description: "Planning and coordination for local events.",
            },
          },
          200,
          '"service-listing:test:v1"',
        );
      }
      if (path === "/api/v1/auth/csrf") {
        return response({ csrfToken: "admin-csrf" });
      }
      if (
        path === `/api/v1/admin/service-listings/${visibleListing.id}/hide` &&
        init?.method === "POST"
      ) {
        expect(JSON.parse(String(init.body))).toEqual({
          reason: "Content needs policy review.",
        });
        return response(
          {
            listing: {
              ...visibleListing,
              moderationStatus: "hidden",
              moderationReason: "Content needs policy review.",
              version: 2,
            },
          },
          200,
          '"service-listing:test:v2"',
        );
      }
      throw new Error(`Unexpected request to ${path}`);
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<AdminServiceListingsScreen user={admin} />);
    await screen.findByText("Community event planning");
    fireEvent.click(screen.getByRole("button", { name: "Review listing" }));
    await screen.findByText("Listing details");
    fireEvent.change(screen.getByLabelText("Reason for hiding this listing"), {
      target: { value: "Content needs policy review." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Hide listing" }));
    expect(
      await screen.findByText("Content needs policy review."),
    ).toBeTruthy();
    expect(
      fetchMock.mock.calls.some(
        ([path, init]) =>
          String(path).endsWith("/hide") && init?.method === "POST",
      ),
    ).toBe(true);
  });

  it("does not render the queue for non-admin users", () => {
    const fetchMock = stubFetch(() => {
      throw new Error("Non-admin rendered an admin endpoint request");
    });
    render(
      <AdminServiceListingsScreen user={{ ...admin, role: "professional" }} />,
    );
    expect(
      screen.getByText(
        "Only authorized administrators can review service listings.",
      ),
    ).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
