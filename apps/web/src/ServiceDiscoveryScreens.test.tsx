// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PublicServiceListingDto } from "@evently/shared";
import { ServiceDetailScreen } from "./ServiceDetailScreen.js";
import { ServiceDiscoveryScreen } from "./ServiceDiscoveryScreen.js";

const fixedListing: PublicServiceListingDto = {
  id: "a42a3df3-9a23-47e8-aad5-1770d0f037a1",
  title: "Community event planning",
  description:
    "Thoughtful planning and coordination for community events of all sizes.",
  category: {
    slug: "planning_coordination",
    name: "Planning and coordination",
  },
  city: "Pune",
  region: "Maharashtra",
  pricingMethod: "fixed",
  priceAmountPaise: 125000,
  currency: "INR",
  provider: {
    displayName: "Local Event Studio",
    slug: "local-event-studio",
    headline: "Planning for community celebrations",
  },
};

const quoteListing: PublicServiceListingDto = {
  ...fixedListing,
  id: "4702a630-55ad-4aae-b7bf-6e51619819ae",
  title: "Event photography",
  category: { slug: "photography_video", name: "Photography and video" },
  pricingMethod: "quote_only",
  priceAmountPaise: null,
};

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/services");
});

describe("public service discovery", () => {
  it("normalizes invalid URL filters and fetches the canonical default query", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (
        String(input) !== "/api/v1/service-listings?page=1&pageSize=25" ||
        init?.credentials !== "same-origin"
      ) {
        return Promise.reject(new Error("Unexpected public search request"));
      }
      return Promise.resolve(
        jsonResponse({
          data: {
            listings: [],
            pagination: { page: 1, pageSize: 25, total: 0 },
          },
        }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    window.history.replaceState(
      {},
      "",
      "/services?categorySlug=unknown&city=Mumbai&city=Pune&extra=unsupported",
    );

    render(<ServiceDiscoveryScreen />);

    await waitFor(() => {
      expect(window.location.pathname + window.location.search).toBe(
        "/services?page=1&pageSize=25",
      );
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.getByLabelText("Category")).toHaveProperty("value", "");
    expect(screen.getByLabelText("City")).toHaveProperty("value", "");
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "/api/v1/service-listings?page=1&pageSize=25",
    );
  });

  it("loads real filtered listings, prices them, links to details, and paginates", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const path = String(input);
      const page = new URL(path, window.location.origin).searchParams.get(
        "page",
      );
      return Promise.resolve(
        jsonResponse({
          data: {
            listings: page === "2" ? [quoteListing] : [fixedListing],
            pagination: { page: Number(page ?? 1), pageSize: 25, total: 26 },
          },
        }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    window.history.replaceState(
      {},
      "",
      "/services?categorySlug=planning_coordination&city=Pune&region=Maharashtra&pricingMethod=fixed",
    );

    render(<ServiceDiscoveryScreen />);

    expect(await screen.findByText("Community event planning")).toBeTruthy();
    expect(
      screen.getAllByText("Planning and coordination").length,
    ).toBeGreaterThan(0);
    expect(screen.getByText("Pune, Maharashtra")).toBeTruthy();
    expect(
      screen.getByText(/Thoughtful planning and coordination/),
    ).toBeTruthy();
    expect(screen.getByText(/₹1,250\.00/)).toBeTruthy();
    expect(
      screen.queryByText(/rating|reviews|verified|available today/i),
    ).toBeNull();
    expect(
      screen
        .getByRole("link", { name: "View service details" })
        .getAttribute("href"),
    ).toContain(
      `/services/${fixedListing.id}?categorySlug=planning_coordination`,
    );

    const initialRequest = String(fetchMock.mock.calls[0]?.[0]);
    expect(initialRequest).toContain("categorySlug=planning_coordination");
    expect(initialRequest).toContain("city=Pune");
    expect(initialRequest).toContain("region=Maharashtra");
    expect(initialRequest).toContain("pricingMethod=fixed");

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("Event photography")).toBeTruthy();
    const photographyLink = screen.getByRole("link", {
      name: "Event photography",
    });
    const photographyCard = photographyLink.closest("li");
    if (!photographyCard) {
      throw new Error("Event photography link is not inside a service card");
    }
    expect(within(photographyCard).getByText("Request a quote")).toBeTruthy();
    expect(new URLSearchParams(window.location.search).get("page")).toBe("2");
  });

  it("applies supported filters and resets them in the URL", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        jsonResponse({
          data: {
            listings: [],
            pagination: { page: 1, pageSize: 25, total: 0 },
          },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<ServiceDiscoveryScreen />);

    await screen.findByText("No service listings match these filters");
    fireEvent.change(screen.getByLabelText("Category"), {
      target: { value: "venues_decor" },
    });
    fireEvent.change(screen.getByLabelText("City"), {
      target: { value: "Mumbai" },
    });
    fireEvent.change(screen.getByLabelText("Pricing"), {
      target: { value: "starting_at" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply filters" }));

    await waitFor(() => {
      const query = new URLSearchParams(window.location.search);
      expect(query.get("categorySlug")).toBe("venues_decor");
      expect(query.get("city")).toBe("Mumbai");
      expect(query.get("pricingMethod")).toBe("starting_at");
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    fireEvent.click(
      screen.getAllByRole("button", { name: "Reset filters" })[0]!,
    );
    await waitFor(() => {
      const query = new URLSearchParams(window.location.search);
      expect(query.get("categorySlug")).toBeNull();
      expect(query.get("city")).toBeNull();
      expect(query.get("pricingMethod")).toBeNull();
    });
  });

  it("shows a retry state when the public API fails", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          {
            error: { code: "TEMPORARY_FAILURE", message: "Try again shortly." },
          },
          503,
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            listings: [fixedListing],
            pagination: { page: 1, pageSize: 25, total: 1 },
          },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    render(<ServiceDiscoveryScreen />);

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Try again shortly.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText(fixedListing.title)).toBeTruthy();
  });
});

describe("public service details", () => {
  it("shows the API listing and a route back to discovery", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(jsonResponse({ data: { listing: fixedListing } })),
      ),
    );
    window.history.replaceState(
      {},
      "",
      "/services/example-id?city=Pune&page=2",
    );

    render(<ServiceDetailScreen listingId={fixedListing.id} />);

    expect(
      await screen.findByRole("heading", { name: fixedListing.title }),
    ).toBeTruthy();
    expect(screen.getByText("Planning and coordination")).toBeTruthy();
    expect(screen.getByText("Pune, Maharashtra")).toBeTruthy();
    expect(screen.getByText(fixedListing.description)).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "Back to service listings" })
        .getAttribute("href"),
    ).toBe("/services?city=Pune&page=2");
    expect(screen.queryByRole("button", { name: /book|request/i })).toBeNull();
    expect(screen.queryByText(/moderation|reviewer|email|phone/i)).toBeNull();
  });

  it("explains unavailable listings without showing private or moderation data", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          jsonResponse(
            {
              error: {
                code: "SERVICE_LISTING_NOT_FOUND",
                message: "Not found",
              },
            },
            404,
          ),
        ),
      ),
    );
    render(<ServiceDetailScreen listingId="deleted-or-hidden" />);

    expect((await screen.findByRole("alert")).textContent).toContain(
      "This service is no longer available",
    );
    expect(screen.queryByText(/moderation reason|owner email/i)).toBeNull();
  });

  it("explains when a service ID is invalid", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          jsonResponse(
            {
              error: { code: "INVALID_REQUEST", message: "Invalid listing ID" },
            },
            400,
          ),
        ),
      ),
    );
    render(<ServiceDetailScreen listingId="not-a-uuid" />);

    expect((await screen.findByRole("alert")).textContent).toContain(
      "This service link is invalid.",
    );
  });
});
