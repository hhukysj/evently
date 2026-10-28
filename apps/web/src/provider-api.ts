export type ProviderType =
  | "event_organizer"
  | "event_manager"
  | "artist_performer"
  | "vendor_service_provider";

export type ProviderApplicationStatus = "pending" | "approved" | "rejected";

export interface ProviderApplication {
  id: string;
  displayName: string;
  description: string;
  city: string;
  region: string | null;
  country: string;
  providerTypes: ProviderType[];
  status: ProviderApplicationStatus;
  createdAt: string;
}

export interface AdminProviderApplication extends ProviderApplication {
  applicant: { id: string; email: string };
  reviewerUserId: string | null;
  rejectionReason: string | null;
  reviewedAt: string | null;
}

export interface ProfessionalProfile {
  id: string;
  displayName: string;
  slug: string;
  headline: string | null;
  bio: string | null;
  city: string;
  region: string | null;
  country: string;
  status: "draft";
  providerTypes: ProviderType[];
  createdAt: string;
  updatedAt: string;
}

export class ProviderApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ProviderApiError";
  }
}

async function readResponse(response: Response): Promise<unknown> {
  if (response.status === 204) {
    return undefined;
  }
  try {
    return await response.json();
  } catch {
    throw new ProviderApiError(
      "The server returned an unreadable response.",
      502,
    );
  }
}

function responseData<T>(payload: unknown): T {
  if (typeof payload === "object" && payload !== null && "data" in payload) {
    return payload.data as T;
  }
  throw new ProviderApiError(
    "The server returned an unexpected response.",
    502,
  );
}

function apiError(status: number, payload: unknown): ProviderApiError {
  if (
    typeof payload === "object" &&
    payload !== null &&
    "error" in payload &&
    typeof payload.error === "object" &&
    payload.error !== null &&
    "message" in payload.error &&
    typeof payload.error.message === "string"
  ) {
    return new ProviderApiError(payload.error.message, status);
  }
  return new ProviderApiError(
    "The request could not be completed. Please try again.",
    status,
  );
}

export async function providerGet<T>(path: string): Promise<T> {
  const response = await fetch(path, { credentials: "same-origin" });
  const payload = await readResponse(response);
  if (!response.ok) {
    throw apiError(response.status, payload);
  }
  return responseData<T>(payload);
}

async function csrfToken(): Promise<string> {
  const data = await providerGet<{ csrfToken: string }>("/api/v1/auth/csrf");
  return data.csrfToken;
}

export async function providerMutation<T>(
  method: "POST" | "PATCH",
  path: string,
  body: Record<string, unknown>,
): Promise<T> {
  const token = await csrfToken();
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": token,
    },
    body: JSON.stringify(body),
  });
  const payload = await readResponse(response);
  if (!response.ok) {
    throw apiError(response.status, payload);
  }
  return responseData<T>(payload);
}
