import {
  bookingRequestCreationInputSchema,
  bookingRequestDtoSchema,
  type BookingRequestCreationInput,
  type BookingRequestDto,
} from "@evently/shared";

export class BookingApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "BookingApiError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readData(payload: unknown): unknown {
  if (isRecord(payload) && "data" in payload) {
    return payload.data;
  }
  throw new BookingApiError("The server returned an unexpected response.", 502);
}

async function readPayload(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new BookingApiError(
      "The server returned an unreadable response.",
      502,
    );
  }
}

function toApiError(status: number, payload: unknown): BookingApiError {
  const error =
    isRecord(payload) && isRecord(payload.error) ? payload.error : undefined;
  return new BookingApiError(
    error && typeof error.message === "string"
      ? error.message
      : "The request could not be completed. Please try again.",
    status,
    error && typeof error.code === "string" ? error.code : undefined,
  );
}

async function requestJson(path: string, init?: RequestInit): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(path, {
      credentials: "same-origin",
      ...init,
    });
  } catch (error) {
    if (init?.signal?.aborted) throw error;
    throw new BookingApiError(
      "Unable to reach Evently. Check your connection and try again.",
      0,
    );
  }
  const payload = await readPayload(response);
  if (!response.ok) throw toApiError(response.status, payload);
  return readData(payload);
}

function parseBookingRequest(value: unknown): BookingRequestDto {
  const result = bookingRequestDtoSchema.safeParse(value);
  if (!result.success) {
    throw new BookingApiError(
      "The server returned an invalid booking request.",
      502,
    );
  }
  return result.data;
}

export async function fetchCustomerBookingRequests(
  page: number,
  signal?: AbortSignal,
): Promise<{ bookingRequests: BookingRequestDto[]; total: number }> {
  const data = await requestJson(
    `/api/v1/booking-requests/me?page=${page}&pageSize=25`,
    { ...(signal ? { signal } : {}) },
  );
  if (!isRecord(data) || !Array.isArray(data.bookingRequests)) {
    throw new BookingApiError(
      "The server returned an invalid request list.",
      502,
    );
  }
  const bookingRequests = data.bookingRequests.map(parseBookingRequest);
  const total = isRecord(data.pagination) ? data.pagination.total : undefined;
  if (typeof total !== "number" || !Number.isInteger(total) || total < 0) {
    throw new BookingApiError(
      "The server returned invalid pagination data.",
      502,
    );
  }
  return { bookingRequests, total };
}

export async function fetchProfessionalBookingRequests(
  page: number,
  signal?: AbortSignal,
): Promise<{ bookingRequests: BookingRequestDto[]; total: number }> {
  const data = await requestJson(
    `/api/v1/professional/booking-requests?page=${page}&pageSize=25`,
    { ...(signal ? { signal } : {}) },
  );
  if (!isRecord(data) || !Array.isArray(data.bookingRequests)) {
    throw new BookingApiError(
      "The server returned an invalid request list.",
      502,
    );
  }
  const bookingRequests = data.bookingRequests.map(parseBookingRequest);
  const total = isRecord(data.pagination) ? data.pagination.total : undefined;
  if (typeof total !== "number" || !Number.isInteger(total) || total < 0) {
    throw new BookingApiError(
      "The server returned invalid pagination data.",
      502,
    );
  }
  return { bookingRequests, total };
}

export async function createBookingRequest(
  input: BookingRequestCreationInput,
): Promise<BookingRequestDto> {
  const parsed = bookingRequestCreationInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new BookingApiError(
      "Please correct the event brief and try again.",
      400,
    );
  }
  const csrfData = await requestJson("/api/v1/auth/csrf");
  if (!isRecord(csrfData) || typeof csrfData.csrfToken !== "string") {
    throw new BookingApiError("Could not prepare a secure request.", 502);
  }
  const data = await requestJson("/api/v1/booking-requests", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": csrfData.csrfToken,
    },
    body: JSON.stringify(parsed.data),
  });
  if (!isRecord(data)) {
    throw new BookingApiError(
      "The server returned an invalid booking request.",
      502,
    );
  }
  return parseBookingRequest(data.bookingRequest);
}

export async function decideBookingRequest(
  requestId: string,
  decision: "accept" | "decline",
): Promise<BookingRequestDto> {
  const csrfData = await requestJson("/api/v1/auth/csrf");
  if (!isRecord(csrfData) || typeof csrfData.csrfToken !== "string") {
    throw new BookingApiError("Could not prepare a secure request.", 502);
  }
  const data = await requestJson(
    `/api/v1/professional/booking-requests/${encodeURIComponent(requestId)}/${decision}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": csrfData.csrfToken,
      },
      body: "{}",
    },
  );
  if (!isRecord(data)) {
    throw new BookingApiError(
      "The server returned an invalid booking request.",
      502,
    );
  }
  return parseBookingRequest(data.bookingRequest);
}
