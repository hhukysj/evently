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
import { ServiceListingsScreen } from "./ServiceListingsScreen.js";

const professional: CurrentUser = {
  id: "6c8c0b42-3173-4f4b-9e90-0c1a8b7b8711",
  email: "provider@example.test",
  role: "professional",
  createdAt: "2026-10-20T08:00:00.000Z",
};

type TestListing = {
  id: string;
  categorySlug: "planning_coordination";
  title: string;
  description: string;
  city: string;
  region: string;
  pricingMethod: "fixed";
  priceAmountPaise: number;
  currency: string;
  publicationStatus: "draft" | "published";
  moderationStatus: "visible" | "hidden";
  moderationReason: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};

const draftListing: TestListing = {
  id: "3b511912-4304-4bc0-9002-a4f8a82bd9e8",
  categorySlug: "planning_coordination",
  title: "Community event planning",
  description: "Planning small and medium community events with care.",
  city: "Pune",
  region: "Maharashtra",
  pricingMethod: "fixed",
  priceAmountPaise: 0,
  currency: "INR",
  publicationStatus: "draft",
  moderationStatus: "visible",
  moderationReason: null,
  version: 1,
  createdAt: "2026-10-21T08:00:00.000Z",
  updatedAt: "2026-10-21T08:00:00.000Z",
};

const publishedListing = {
  ...draftListing,
  publicationStatus: "published",
  version: 2,
};

function jsonResponse(data: unknown, status = 200, etag?: string): Response {
  const isError = typeof data === "object" && data !== null && "error" in data;
  const wrappedData =
    typeof data === "object" &&
    data !== null &&
    "listings" in data &&
    Array.isArray(data.listings) &&
    !("pagination" in data)
      ? {
          ...data,
          pagination: {
            page: 1,
            pageSize: 25,
            total: data.listings.length,
          },
        }
      : data;
  return new Response(JSON.stringify(isError ? data : { data: wrappedData }), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...(etag ? { ETag: etag } : {}),
    },
  });
}

function stubFetch(
  handler: (
    path: string,
    init?: RequestInit,
    search?: string,
  ) => Response | Promise<Response>,
): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), window.location.origin);
    return Promise.resolve(handler(url.pathname, init, url.search));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function setConfirmed(value: boolean) {
  vi.spyOn(window, "confirm").mockReturnValue(value);
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("provider service management", () => {
  it("shows a clear reason when its listing is hidden by moderation", async () => {
    const hiddenListing = {
      ...draftListing,
      moderationStatus: "hidden" as const,
      moderationReason: "Please update the service description.",
    };
    stubFetch((path) => {
      if (path === "/api/v1/professional/service-listings") {
        return jsonResponse({ listings: [hiddenListing] });
      }
      throw new Error(`Unexpected request to ${path}`);
    });
    render(<ServiceListingsScreen user={professional} />);
    expect(await screen.findByText(/Hidden by moderation:/)).toBeTruthy();
    expect(
      screen.getByText("Please update the service description."),
    ).toBeTruthy();
  });

  it("shows loading, empty, and retryable error states", async () => {
    let resolveList: ((response: Response) => void) | undefined;
    stubFetch((path) => {
      if (path === "/api/v1/professional/service-listings") {
        return new Promise<Response>((resolve) => {
          resolveList = resolve;
        });
      }
      throw new Error(`Unexpected request to ${path}`);
    });
    render(<ServiceListingsScreen user={professional} />);
    expect(
      await screen.findByText("Loading your service listings…"),
    ).toBeTruthy();
    resolveList?.(jsonResponse({ listings: [] }));
    expect(await screen.findByText("No services yet")).toBeTruthy();

    let attempts = 0;
    stubFetch((path) => {
      if (path === "/api/v1/professional/service-listings") {
        attempts += 1;
        return attempts === 1
          ? jsonResponse({ error: { message: "Temporary server error" } }, 500)
          : jsonResponse({ listings: [] });
      }
      throw new Error(`Unexpected request to ${path}`);
    });
    cleanup();
    render(<ServiceListingsScreen user={professional} />);
    expect(await screen.findByText("Temporary server error")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("No services yet")).toBeTruthy();
    expect(attempts).toBe(2);
  });

  it("uses bounded provider pagination and exposes page navigation", async () => {
    const firstPage = Array.from({ length: 25 }, (_, index) => ({
      ...draftListing,
      id: `service-${index}`,
      title: `Service ${index + 1}`,
    }));
    const fetchMock = stubFetch((path, _init, search) => {
      if (path === "/api/v1/professional/service-listings") {
        return search?.includes("page=2")
          ? jsonResponse({
              listings: [
                { ...draftListing, id: "service-last", title: "Final listing" },
              ],
              pagination: { page: 2, pageSize: 25, total: 26 },
            })
          : jsonResponse({
              listings: firstPage,
              pagination: { page: 1, pageSize: 25, total: 26 },
            });
      }
      throw new Error(`Unexpected request to ${path}`);
    });
    render(<ServiceListingsScreen user={professional} />);
    expect(await screen.findByText("Service 1")).toBeTruthy();
    expect(screen.getByText("Page 1 of 2 · 26 services")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("Final listing")).toBeTruthy();
    expect(screen.getByText("Page 2 of 2 · 26 services")).toBeTruthy();
    expect(String(fetchMock.mock.calls.at(-1)?.[0])).toContain(
      "page=2&pageSize=25",
    );
    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    expect(await screen.findByText("Service 1")).toBeTruthy();
  });

  it("validates fields and creates a quote-only service through the API", async () => {
    let savedListing: Record<string, unknown> | null = null;
    const fetchMock = stubFetch((path, init) => {
      if (path === "/api/v1/professional/service-listings" && !init?.method) {
        return jsonResponse({ listings: savedListing ? [savedListing] : [] });
      }
      if (path === "/api/v1/auth/csrf") {
        return jsonResponse({ csrfToken: "csrf-test" });
      }
      if (
        path === "/api/v1/professional/service-listings" &&
        init?.method === "POST"
      ) {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        expect(body).toMatchObject({
          title: "Event coordination",
          pricingMethod: "quote_only",
          priceAmountPaise: null,
          city: "Pune",
        });
        savedListing = { ...draftListing, ...body };
        return jsonResponse(
          { listing: savedListing },
          201,
          '"service-listing:new:v1"',
        );
      }
      throw new Error(`Unexpected request to ${path}`);
    });
    render(<ServiceListingsScreen user={professional} />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Create a service" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Create service" }));
    expect(
      (await screen.findByLabelText("Service title")).getAttribute(
        "aria-invalid",
      ),
    ).toBe("true");
    expect(
      fetchMock.mock.calls.some(
        ([input, init]) =>
          String(input) === "/api/v1/professional/service-listings" &&
          init?.method === "POST",
      ),
    ).toBe(false);

    fireEvent.change(screen.getByLabelText("Service title"), {
      target: { value: "Event coordination" },
    });
    fireEvent.change(screen.getByLabelText("Description"), {
      target: {
        value:
          "Coordinating community events with a clear plan and reliable local partners.",
      },
    });
    fireEvent.change(screen.getByLabelText("City"), {
      target: { value: "Pune" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create service" }));

    expect(await screen.findByText("Service listing created.")).toBeTruthy();
    const post = fetchMock.mock.calls.find(
      ([input, init]) =>
        String(input) === "/api/v1/professional/service-listings" &&
        init?.method === "POST",
    );
    expect(new Headers(post?.[1]?.headers).get("X-CSRF-Token")).toBe(
      "csrf-test",
    );
    expect(post?.[1]?.credentials).toBe("same-origin");
    expect(screen.getByText("Request a quote")).toBeTruthy();
  });

  it("supports zero-price services and prevents duplicate submissions", async () => {
    let finishPost: ((response: Response) => void) | undefined;
    let postCount = 0;
    let savedListing: Record<string, unknown> | null = null;
    const fetchMock = stubFetch((path, init) => {
      if (path === "/api/v1/professional/service-listings" && !init?.method) {
        return jsonResponse({ listings: savedListing ? [savedListing] : [] });
      }
      if (path === "/api/v1/auth/csrf") {
        return jsonResponse({ csrfToken: "csrf-test" });
      }
      if (
        path === "/api/v1/professional/service-listings" &&
        init?.method === "POST"
      ) {
        postCount += 1;
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        expect(body.priceAmountPaise).toBe(0);
        savedListing = {
          ...draftListing,
          title: "Free community consultation",
          ...body,
        };
        return new Promise<Response>((resolve) => {
          finishPost = resolve;
        });
      }
      throw new Error(`Unexpected request to ${path}`);
    });
    render(<ServiceListingsScreen user={professional} />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Create a service" }),
    );
    fireEvent.change(screen.getByLabelText("Service title"), {
      target: { value: "Free community consultation" },
    });
    fireEvent.change(screen.getByLabelText("Description"), {
      target: {
        value:
          "A no-cost planning consultation for local community events and organizers.",
      },
    });
    fireEvent.change(screen.getByLabelText("City"), {
      target: { value: "Pune" },
    });
    fireEvent.change(screen.getByLabelText("Pricing model"), {
      target: { value: "fixed" },
    });
    fireEvent.change(screen.getByLabelText("Price in INR"), {
      target: { value: "0" },
    });
    const createButton = screen.getByRole("button", { name: "Create service" });
    fireEvent.click(createButton);
    await waitFor(() => expect(postCount).toBe(1));
    expect(createButton.hasAttribute("disabled")).toBe(true);
    finishPost?.(
      jsonResponse(
        {
          listing: {
            ...draftListing,
            title: "Free community consultation",
            priceAmountPaise: 0,
          },
        },
        201,
        '"service-listing:new:v1"',
      ),
    );
    expect(await screen.findByText("Service listing created.")).toBeTruthy();
    expect(postCount).toBe(1);
    expect(screen.getByText("₹0.00")).toBeTruthy();
    expect(
      fetchMock.mock.calls.some(([input]) => String(input).includes("evently")),
    ).toBe(false);
  });

  it("uses fresh ETags and CSRF for publish and unpublish transitions", async () => {
    let listing = { ...draftListing };
    const fetchMock = stubFetch((path, init) => {
      if (path === "/api/v1/professional/service-listings" && !init?.method) {
        return jsonResponse({ listings: [listing] });
      }
      if (
        path === `/api/v1/professional/service-listings/${listing.id}` &&
        !init?.method
      ) {
        return jsonResponse(
          { listing },
          200,
          `"service-listing:${listing.id}:v${listing.version}"`,
        );
      }
      if (path === "/api/v1/auth/csrf") {
        return jsonResponse({ csrfToken: "transition-csrf" });
      }
      if (path.endsWith("/publish") && init?.method === "POST") {
        expect(new Headers(init.headers).get("If-Match")).toBe(
          `"service-listing:${listing.id}:v${listing.version}"`,
        );
        expect(new Headers(init.headers).get("X-CSRF-Token")).toBe(
          "transition-csrf",
        );
        listing = {
          ...listing,
          publicationStatus: "published",
          version: listing.version + 1,
        };
        return jsonResponse(
          { listing },
          200,
          `"service-listing:${listing.id}:v${listing.version}"`,
        );
      }
      if (path.endsWith("/unpublish") && init?.method === "POST") {
        expect(new Headers(init.headers).get("If-Match")).toBe(
          `"service-listing:${listing.id}:v${listing.version}"`,
        );
        listing = {
          ...listing,
          publicationStatus: "draft",
          version: listing.version + 1,
        };
        return jsonResponse(
          { listing },
          200,
          `"service-listing:${listing.id}:v${listing.version}"`,
        );
      }
      throw new Error(`Unexpected request to ${path}`);
    });
    setConfirmed(true);
    render(<ServiceListingsScreen user={professional} />);
    expect(await screen.findByText("Community event planning")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    expect(await screen.findByText("Service published.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Unpublish" }));
    expect(await screen.findByText("Service unpublished.")).toBeTruthy();
    expect(
      fetchMock.mock.calls.filter(
        ([input, init]) =>
          (String(input).endsWith("/publish") ||
            String(input).endsWith("/unpublish")) &&
          init?.method === "POST",
      ),
    ).toHaveLength(2);
  });

  it("requires published-edit confirmation and sends If-Match with the update", async () => {
    const fetchMock = stubFetch((path, init) => {
      if (path === "/api/v1/professional/service-listings" && !init?.method) {
        return jsonResponse({ listings: [publishedListing] });
      }
      if (
        path ===
          `/api/v1/professional/service-listings/${publishedListing.id}` &&
        !init?.method
      ) {
        return jsonResponse(
          { listing: publishedListing },
          200,
          `"service-listing:${publishedListing.id}:v2"`,
        );
      }
      if (path === "/api/v1/auth/csrf") {
        return jsonResponse({ csrfToken: "edit-csrf" });
      }
      if (
        path ===
          `/api/v1/professional/service-listings/${publishedListing.id}` &&
        init?.method === "PATCH"
      ) {
        const headers = new Headers(init.headers);
        expect(headers.get("If-Match")).toBe(
          `"service-listing:${publishedListing.id}:v2"`,
        );
        expect(headers.get("X-Confirm-Published-Edit")).toBe("true");
        return jsonResponse(
          {
            listing: {
              ...publishedListing,
              title: "Updated event planning",
              version: 3,
            },
          },
          200,
          `"service-listing:${publishedListing.id}:v3"`,
        );
      }
      throw new Error(`Unexpected request to ${path}`);
    });
    const confirm = vi.spyOn(window, "confirm");
    confirm.mockReturnValueOnce(false).mockReturnValueOnce(true);
    render(<ServiceListingsScreen user={professional} />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(
      fetchMock.mock.calls.some(
        ([input]) =>
          String(input) ===
          `/api/v1/professional/service-listings/${publishedListing.id}`,
      ),
    ).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(await screen.findByLabelText("Service title")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Service title"), {
      target: { value: "Updated event planning" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText("Service changes saved.")).toBeTruthy();
    expect(
      fetchMock.mock.calls.some(
        ([input, init]) =>
          String(input) ===
            `/api/v1/professional/service-listings/${publishedListing.id}` &&
          init?.method === "PATCH",
      ),
    ).toBe(true);
  });

  it("reconfirms if the listing became published after the dashboard loaded", async () => {
    const fetchMock = stubFetch((path, init) => {
      if (path === "/api/v1/professional/service-listings" && !init?.method) {
        return jsonResponse({ listings: [draftListing] });
      }
      if (
        path === `/api/v1/professional/service-listings/${draftListing.id}` &&
        !init?.method
      ) {
        return jsonResponse(
          { listing: publishedListing },
          200,
          `"service-listing:${draftListing.id}:v2"`,
        );
      }
      if (path === "/api/v1/auth/csrf") {
        return jsonResponse({ csrfToken: "csrf-test" });
      }
      if (
        path === `/api/v1/professional/service-listings/${draftListing.id}` &&
        init?.method === "PATCH"
      ) {
        expect(new Headers(init.headers).get("X-Confirm-Published-Edit")).toBe(
          "true",
        );
        return jsonResponse(
          { listing: { ...publishedListing, title: "Confirmed change" } },
          200,
          `"service-listing:${draftListing.id}:v3"`,
        );
      }
      throw new Error(`Unexpected request to ${path}`);
    });
    const confirm = vi
      .spyOn(window, "confirm")
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    render(<ServiceListingsScreen user={professional} />);

    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
    expect(screen.queryByLabelText("Service title")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(await screen.findByLabelText("Service title")).toBeTruthy();
    expect(confirm).toHaveBeenCalledTimes(2);
    fireEvent.change(screen.getByLabelText("Service title"), {
      target: { value: "Confirmed change" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText("Service changes saved.")).toBeTruthy();
    expect(
      fetchMock.mock.calls.some(([, init]) => init?.method === "PATCH"),
    ).toBe(true);
  });

  it("offers a safe reload after a stale ETag conflict", async () => {
    let detailReads = 0;
    let title: string = draftListing.title;
    const fetchMock = stubFetch((path, init) => {
      if (path === "/api/v1/professional/service-listings" && !init?.method) {
        return jsonResponse({ listings: [{ ...draftListing, title }] });
      }
      if (
        path === `/api/v1/professional/service-listings/${draftListing.id}` &&
        !init?.method
      ) {
        detailReads += 1;
        if (detailReads > 1) {
          title = "Changed by another session";
        }
        return jsonResponse(
          { listing: { ...draftListing, title, version: detailReads } },
          200,
          `"service-listing:${draftListing.id}:v${detailReads}"`,
        );
      }
      if (path === "/api/v1/auth/csrf") {
        return jsonResponse({ csrfToken: "stale-csrf" });
      }
      if (
        path === `/api/v1/professional/service-listings/${draftListing.id}` &&
        init?.method === "PATCH"
      ) {
        return jsonResponse(
          {
            error: {
              code: "PRECONDITION_FAILED",
              message: "The listing changed; reload it and retry",
            },
          },
          412,
        );
      }
      throw new Error(`Unexpected request to ${path}`);
    });
    render(<ServiceListingsScreen user={professional} />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    fireEvent.change(await screen.findByLabelText("Service title"), {
      target: { value: "My unsaved overwrite" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(
      await screen.findByText(/This listing changed since you loaded it/),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Reload latest version" }),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Reload latest version" }),
    );
    await waitFor(() =>
      expect(screen.getByLabelText("Service title")).toHaveProperty(
        "value",
        "Changed by another session",
      ),
    );
    expect(detailReads).toBe(2);
    expect(
      fetchMock.mock.calls.filter(
        ([input, init]) =>
          String(input) ===
            `/api/v1/professional/service-listings/${draftListing.id}` &&
          init?.method === "PATCH",
      ),
    ).toHaveLength(1);
  });

  it("blocks edits when an ETag is missing and reports ineligible access", async () => {
    const fetchMock = stubFetch((path, init) => {
      if (path === "/api/v1/professional/service-listings" && !init?.method) {
        return jsonResponse({ listings: [draftListing] });
      }
      if (
        path === `/api/v1/professional/service-listings/${draftListing.id}` &&
        !init?.method
      ) {
        return jsonResponse({ listing: draftListing });
      }
      if (path === "/api/v1/auth/csrf") {
        return jsonResponse({ csrfToken: "csrf-test" });
      }
      if (
        path === "/api/v1/professional/service-listings" &&
        init?.method === "GET"
      ) {
        return jsonResponse(
          {
            error: {
              code: "PROFESSIONAL_NOT_ELIGIBLE",
              message: "An approved, active professional account is required",
            },
          },
          403,
        );
      }
      throw new Error(`Unexpected request to ${path}`);
    });
    render(<ServiceListingsScreen user={professional} />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    expect(
      await screen.findByText(/did not return a listing version token/),
    ).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Service title"), {
      target: { value: "Changed title" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(
      await screen.findByText(/A current listing version token is required/),
    ).toBeTruthy();
    expect(
      fetchMock.mock.calls.some(([, init]) => init?.method === "PATCH"),
    ).toBe(false);
  });

  it("provides sign-in, role, and server eligibility messages", async () => {
    const { rerender } = render(<ServiceListingsScreen user={null} />);
    expect(screen.getByRole("link", { name: "Sign in" })).toBeTruthy();
    rerender(
      <ServiceListingsScreen user={{ ...professional, role: "customer" }} />,
    );
    expect(
      screen.getByRole("link", { name: "Apply as a provider" }),
    ).toBeTruthy();
    stubFetch((path) => {
      if (path === "/api/v1/professional/service-listings") {
        return jsonResponse(
          {
            error: {
              code: "PROFESSIONAL_NOT_ELIGIBLE",
              message: "An approved, active professional account is required",
            },
          },
          403,
        );
      }
      throw new Error(`Unexpected request to ${path}`);
    });
    rerender(<ServiceListingsScreen user={professional} />);
    expect(
      await screen.findByText(/not currently eligible to manage services/),
    ).toBeTruthy();
  });
});
