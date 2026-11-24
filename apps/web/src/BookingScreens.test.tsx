// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BookingRequestDto } from "@evently/shared";
import {
  BookingRequestForm,
  CustomerBookingRequestsScreen,
  ProfessionalBookingRequestsScreen,
} from "./BookingScreens.js";

const customer = {
  id: "7528f841-005a-4da9-ad77-c48c8213e857",
  email: "customer@example.test",
  role: "customer" as const,
  createdAt: "2026-01-01T00:00:00.000Z",
};

const professional = {
  ...customer,
  id: "fb02dece-e40d-486e-b08f-e9b18df37f0c",
  email: "professional@example.test",
  role: "professional" as const,
};

const requestDto: BookingRequestDto = {
  id: "c690e6ad-c3f8-4993-8a76-f077b723a23a",
  serviceListingId: "e018e9bc-6c5e-424d-939d-a61ad517c9fd",
  service: {
    title: "Community event planning",
    description: "Planning and coordination for community events of all sizes.",
    city: "Pune",
    region: "Maharashtra",
    category: {
      slug: "planning_coordination",
      name: "Planning and coordination",
    },
    pricingMethod: "fixed",
    priceAmountPaise: 125000,
    currency: "INR",
  },
  providerDisplayName: "Local Event Studio",
  eventType: "Community festival",
  eventDate: "2099-12-31",
  eventTimezone: "Asia/Kolkata",
  eventLocation: { city: "Pune", region: "Maharashtra", venueOrArea: null },
  guestCount: 80,
  budgetMinAmountPaise: 50000,
  budgetMaxAmountPaise: 200000,
  additionalNotes: "Accessible seating, please.",
  status: "requested",
  cancellation: null,
  statusHistory: [
    {
      id: "45dbab1c-39a5-4ac6-b192-f70ce39b73d1",
      previousStatus: null,
      newStatus: "requested",
      actorRole: "customer",
      reason: null,
      createdAt: "2026-01-02T00:00:00.000Z",
    },
  ],
  createdAt: "2026-01-02T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
};

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function listResponse(request: BookingRequestDto): Response {
  return jsonResponse({
    data: {
      bookingRequests: [request],
      pagination: { page: 1, pageSize: 25, total: 1 },
    },
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("customer booking request form", () => {
  it("validates the shared event brief and does not submit invalid timezones", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(
      <BookingRequestForm
        customer={customer}
        listingId={requestDto.serviceListingId!}
        onClose={() => undefined}
      />,
    );

    fireEvent.change(screen.getByLabelText("Event type"), {
      target: { value: "Community festival" },
    });
    fireEvent.change(screen.getByLabelText("Event date"), {
      target: { value: "2099-12-31" },
    });
    fireEvent.change(screen.getByLabelText("Event timezone (IANA)"), {
      target: { value: "Not/A_Timezone" },
    });
    fireEvent.change(screen.getByLabelText("Event city"), {
      target: { value: "Pune" },
    });
    fireEvent.change(screen.getByLabelText("Estimated guest count"), {
      target: { value: "80" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Send booking request" }),
    );

    expect(
      await screen.findByText("Use a valid IANA timezone identifier."),
    ).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("retains the idempotency key for an unchanged retry and shows request-pending success", async () => {
    const postBodies: Array<{ idempotencyKey: string }> = [];
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === "/api/v1/auth/csrf") {
        return Promise.resolve(
          jsonResponse({ data: { csrfToken: "csrf-test" } }),
        );
      }
      if (path === "/api/v1/booking-requests" && init?.method === "POST") {
        postBodies.push(
          JSON.parse(String(init.body)) as { idempotencyKey: string },
        );
        return Promise.resolve(
          postBodies.length === 1
            ? jsonResponse(
                { error: { code: "TEMPORARY_FAILURE", message: "Try again." } },
                503,
              )
            : jsonResponse({ data: { bookingRequest: requestDto } }, 201),
        );
      }
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });
    vi.stubGlobal("fetch", fetchMock);
    render(
      <BookingRequestForm
        customer={customer}
        listingId={requestDto.serviceListingId!}
        onClose={() => undefined}
      />,
    );
    fireEvent.change(screen.getByLabelText("Event type"), {
      target: { value: "Community festival" },
    });
    fireEvent.change(screen.getByLabelText("Event date"), {
      target: { value: "2099-12-31" },
    });
    fireEvent.change(screen.getByLabelText("Event city"), {
      target: { value: "Pune" },
    });
    fireEvent.change(screen.getByLabelText("Estimated guest count"), {
      target: { value: "80" },
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Send booking request" }),
    );
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Try again.",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Send booking request" }),
    );

    expect(
      await screen.findByRole("heading", { name: "Request sent" }),
    ).toBeTruthy();
    expect(screen.getByText(/not a confirmed booking yet/)).toBeTruthy();
    await waitFor(() => expect(postBodies).toHaveLength(2));
    expect(postBodies[0]?.idempotencyKey).toBe(postBodies[1]?.idempotencyKey);
  });
});

describe("booking request lists", () => {
  it("lets the professional accept an incoming request and reloads its status", async () => {
    let current = requestDto;
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.startsWith("/api/v1/professional/booking-requests?")) {
        return Promise.resolve(listResponse(current));
      }
      if (path === "/api/v1/auth/csrf") {
        return Promise.resolve(
          jsonResponse({ data: { csrfToken: "csrf-test" } }),
        );
      }
      if (path.endsWith("/accept") && init?.method === "POST") {
        current = {
          ...current,
          status: "accepted",
          statusHistory: [
            ...current.statusHistory,
            {
              id: "3404fa19-48be-4c08-85ae-1faef5c6b08a",
              previousStatus: "requested",
              newStatus: "accepted",
              actorRole: "professional",
              reason: null,
              createdAt: "2026-01-03T00:00:00.000Z",
            },
          ],
        };
        return Promise.resolve(
          jsonResponse({ data: { bookingRequest: current } }),
        );
      }
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <ProfessionalBookingRequestsScreen
        user={professional}
        userLoading={false}
      />,
    );
    expect(await screen.findByText("Community festival")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Accept request" }));

    expect(await screen.findByText("Booking request accepted.")).toBeTruthy();
    expect(await screen.findByText("Accepted by professional")).toBeTruthy();
  });

  it("shows customer requests and a useful sign-in state", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(listResponse(requestDto))),
    );
    const { rerender } = render(
      <CustomerBookingRequestsScreen user={customer} userLoading={false} />,
    );
    expect(
      await screen.findByText("Awaiting professional response"),
    ).toBeTruthy();
    expect(screen.getByText("Community festival")).toBeTruthy();

    rerender(<CustomerBookingRequestsScreen user={null} userLoading={false} />);
    expect(
      screen.getByRole("link", { name: "Sign in" }).getAttribute("href"),
    ).toContain("returnTo=%2Fbooking-requests");
  });

  it("shows the conversation and appends a server-confirmed message", async () => {
    const message = {
      id: "6d61e0ed-512f-465b-b66b-28bd9bbcd791",
      senderRole: "customer",
      body: "Please let me know about setup timing.",
      createdAt: "2026-01-03T12:00:00.000Z",
      readAt: null,
    };
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.startsWith("/api/v1/booking-requests/me?")) {
        return Promise.resolve(listResponse(requestDto));
      }
      if (
        path === `/api/v1/bookings/${requestDto.id}/messages?page=1&pageSize=25`
      ) {
        return Promise.resolve(
          jsonResponse({
            data: {
              messages: [],
              pagination: { page: 1, pageSize: 25, total: 0 },
            },
          }),
        );
      }
      if (path === "/api/v1/auth/csrf") {
        return Promise.resolve(
          jsonResponse({ data: { csrfToken: "csrf-test" } }),
        );
      }
      if (
        path === `/api/v1/bookings/${requestDto.id}/messages` &&
        init?.method === "POST"
      ) {
        return Promise.resolve(jsonResponse({ data: { message } }, 201));
      }
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });
    vi.stubGlobal("fetch", fetchMock);
    render(
      <CustomerBookingRequestsScreen user={customer} userLoading={false} />,
    );

    fireEvent.change(await screen.findByLabelText("Write a message"), {
      target: { value: message.body },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    expect(await screen.findByText(message.body)).toBeTruthy();
    expect(screen.getByText("You")).toBeTruthy();
    expect(await screen.findByRole("status")).toBeTruthy();
  });

  it("requires confirmation before cancellation and refreshes the server status", async () => {
    let current: BookingRequestDto = { ...requestDto, status: "accepted" };
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.startsWith("/api/v1/booking-requests/me?")) {
        return Promise.resolve(listResponse(current));
      }
      if (path === "/api/v1/auth/csrf") {
        return Promise.resolve(
          jsonResponse({ data: { csrfToken: "csrf-test" } }),
        );
      }
      if (
        path === `/api/v1/bookings/${requestDto.id}/cancel` &&
        init?.method === "POST"
      ) {
        current = {
          ...current,
          status: "cancelled",
          cancellation: {
            cancelledAt: "2026-01-03T12:00:00.000Z",
            cancelledByRole: "customer",
            reason: null,
          },
        };
        return Promise.resolve(
          jsonResponse({ data: { bookingRequest: current } }),
        );
      }
      if (path.startsWith(`/api/v1/bookings/${requestDto.id}/messages?`)) {
        return Promise.resolve(
          jsonResponse({
            data: {
              messages: [],
              pagination: { page: 1, pageSize: 25, total: 0 },
            },
          }),
        );
      }
      return Promise.reject(new Error(`Unexpected request: ${path}`));
    });
    vi.stubGlobal("fetch", fetchMock);
    render(
      <CustomerBookingRequestsScreen user={customer} userLoading={false} />,
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "Cancel booking" }),
    );
    expect(
      screen.getByText(
        /mark the request as cancelled and notify the other participant/i,
      ),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Confirm cancellation" }),
    );

    expect(await screen.findByText("Cancelled")).toBeTruthy();
    expect(
      await screen.findByText(
        "Booking cancelled. The other participant has been notified.",
      ),
    ).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/v1/bookings/${requestDto.id}/cancel`,
      expect.objectContaining({ method: "POST" }),
    );
  });
});
