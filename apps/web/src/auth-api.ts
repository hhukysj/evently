export interface CurrentUser {
  id: string;
  email: string;
  role: "customer" | "professional" | "admin";
  createdAt: string;
}

export interface DevelopmentEmailMessage {
  id: string;
  type: "email_verification" | "password_reset";
  email: string;
  token: string;
  createdAt: string;
}

export class AuthApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "AuthApiError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function readResponse(response: Response): Promise<unknown> {
  if (response.status === 204) {
    return undefined;
  }

  try {
    return await response.json();
  } catch {
    throw new AuthApiError("The server returned an unreadable response.", 502);
  }
}

function responseData<T>(payload: unknown): T {
  if (isRecord(payload) && "data" in payload) {
    return payload.data as T;
  }
  throw new AuthApiError("The server returned an unexpected response.", 502);
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { credentials: "same-origin" });
  const payload = await readResponse(response);
  if (!response.ok) {
    throw apiError(response.status, payload);
  }
  return responseData<T>(payload);
}

async function getCsrfToken(): Promise<string> {
  const data = await getJson<{ csrfToken: string }>("/api/v1/auth/csrf");
  return data.csrfToken;
}

export async function postAuth<T = { message?: string }>(
  path: string,
  body: Record<string, string>,
): Promise<T> {
  const csrfToken = await getCsrfToken();
  const response = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": csrfToken,
    },
    body: JSON.stringify(body),
  });
  const payload = await readResponse(response);
  if (!response.ok) {
    throw apiError(response.status, payload);
  }
  return response.status === 204 ? (undefined as T) : responseData<T>(payload);
}

export async function currentUser(): Promise<CurrentUser | null> {
  const response = await fetch("/api/v1/auth/me", {
    credentials: "same-origin",
  });
  const payload = await readResponse(response);
  if (response.status === 401) {
    return null;
  }
  if (!response.ok) {
    throw apiError(response.status, payload);
  }
  return responseData<{ user: CurrentUser }>(payload).user;
}

export async function developmentInbox(): Promise<DevelopmentEmailMessage[]> {
  const data = await getJson<{ messages: DevelopmentEmailMessage[] }>(
    "/api/v1/dev/email-inbox",
  );
  return data.messages;
}

function apiError(status: number, payload: unknown): AuthApiError {
  if (
    isRecord(payload) &&
    isRecord(payload.error) &&
    typeof payload.error.message === "string"
  ) {
    return new AuthApiError(payload.error.message, status);
  }
  return new AuthApiError(
    "The request could not be completed. Please try again.",
    status,
  );
}
