import type {
  PublicServiceListingDto,
  PublicServiceListingQuery,
} from "@evently/shared";

export interface PublicServiceListingPage {
  listings: PublicServiceListingDto[];
  pagination: { page: number; pageSize: number; total: number };
}

export class PublicServiceListingApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "PublicServiceListingApiError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function readResponse(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new PublicServiceListingApiError(
      "The server returned an unreadable response.",
      502,
    );
  }
}

function responseData<T>(payload: unknown): T {
  if (isRecord(payload) && "data" in payload) {
    return payload.data as T;
  }
  throw new PublicServiceListingApiError(
    "The server returned an unexpected response.",
    502,
  );
}

function apiError(
  status: number,
  payload: unknown,
): PublicServiceListingApiError {
  const error =
    isRecord(payload) && isRecord(payload.error) ? payload.error : undefined;
  return new PublicServiceListingApiError(
    error && typeof error.message === "string"
      ? error.message
      : "The request could not be completed. Please try again.",
    status,
    error && typeof error.code === "string" ? error.code : undefined,
  );
}

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      credentials: "same-origin",
      ...(signal ? { signal } : {}),
    });
  } catch (error) {
    if (signal?.aborted) {
      throw error;
    }
    throw new PublicServiceListingApiError(
      "Unable to reach service listings. Check your connection and try again.",
      0,
    );
  }

  const payload = await readResponse(response);
  if (!response.ok) {
    throw apiError(response.status, payload);
  }
  return responseData<T>(payload);
}

export function publicServiceListingSearchPath(
  query: PublicServiceListingQuery,
): string {
  const params = new URLSearchParams({
    page: String(query.page),
    pageSize: String(query.pageSize),
  });
  if (query.categorySlug) params.set("categorySlug", query.categorySlug);
  if (query.city) params.set("city", query.city);
  if (query.region) params.set("region", query.region);
  if (query.pricingMethod) params.set("pricingMethod", query.pricingMethod);
  return `/api/v1/service-listings?${params.toString()}`;
}

export function fetchPublicServiceListings(
  query: PublicServiceListingQuery,
  signal?: AbortSignal,
): Promise<PublicServiceListingPage> {
  return getJson(publicServiceListingSearchPath(query), signal);
}

export function fetchPublicServiceListing(
  listingId: string,
  signal?: AbortSignal,
): Promise<{ listing: PublicServiceListingDto }> {
  return getJson(
    `/api/v1/service-listings/${encodeURIComponent(listingId)}`,
    signal,
  );
}
