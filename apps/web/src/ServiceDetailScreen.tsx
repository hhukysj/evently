import { useEffect, useState } from "react";
import {
  serviceCategories,
  type PublicServiceListingDto,
} from "@evently/shared";
import {
  fetchPublicServiceListing,
  PublicServiceListingApiError,
} from "./public-service-listings-api.js";
import type { CurrentUser } from "./auth-api.js";
import { BookingRequestForm } from "./BookingScreens.js";

type DetailRequestState =
  | { key: string; status: "loading" }
  | { key: string; status: "error"; error: string }
  | { key: string; status: "success"; listing: PublicServiceListingDto };

const categoryNames = new Map(
  serviceCategories.map(({ slug, name }) => [slug, name]),
);

function priceText(listing: PublicServiceListingDto): string {
  if (listing.pricingMethod === "quote_only") {
    return "Request a quote";
  }
  if (listing.priceAmountPaise === null) {
    return "Price unavailable";
  }
  const amount = new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(listing.priceAmountPaise / 100);
  return listing.pricingMethod === "starting_at"
    ? `Starting at ${amount}`
    : amount;
}

function detailErrorMessage(error: unknown): string {
  if (error instanceof PublicServiceListingApiError) {
    if (error.status === 400) return "This service link is invalid.";
    if (error.status === 404) {
      return "This service is no longer available. It may have been unpublished or removed.";
    }
  }
  return error instanceof Error
    ? error.message
    : "The service details could not be loaded. Please try again.";
}

export function ServiceDetailScreen({
  listingId,
  user = null,
  userLoading = false,
}: {
  listingId: string;
  user?: CurrentUser | null;
  userLoading?: boolean;
}) {
  const [revision, setRevision] = useState(0);
  const [requestFormOpen, setRequestFormOpen] = useState(
    () =>
      new URLSearchParams(window.location.search).get("requestBooking") === "1",
  );
  const requestKey = JSON.stringify([listingId, revision]);
  const [requestState, setRequestState] = useState<DetailRequestState>(() => ({
    key: requestKey,
    status: "loading",
  }));
  const visibleRequestState: DetailRequestState =
    requestState.key === requestKey
      ? requestState
      : { key: requestKey, status: "loading" };
  const loading = visibleRequestState.status === "loading";
  const error =
    visibleRequestState.status === "error" ? visibleRequestState.error : "";
  const listing =
    visibleRequestState.status === "success"
      ? visibleRequestState.listing
      : null;

  function closeRequestForm(): void {
    setRequestFormOpen(false);
    const query = new URLSearchParams(window.location.search);
    query.delete("requestBooking");
    const search = query.toString();
    window.history.replaceState(
      {},
      "",
      `${window.location.pathname}${search ? `?${search}` : ""}`,
    );
  }

  useEffect(() => {
    const controller = new AbortController();
    void fetchPublicServiceListing(listingId, controller.signal)
      .then(({ listing: result }) => {
        if (!controller.signal.aborted) {
          setRequestState({
            key: requestKey,
            status: "success",
            listing: result,
          });
        }
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          setRequestState({
            key: requestKey,
            status: "error",
            error: detailErrorMessage(reason),
          });
        }
      });
    return () => controller.abort();
  }, [listingId, requestKey]);

  return (
    <section
      className="public-service-detail"
      aria-label="Public service details"
      aria-busy={loading}
    >
      <a className="text-link" href={`/services${window.location.search}`}>
        Back to service listings
      </a>
      {loading && (
        <p className="muted" role="status" aria-live="polite">
          Loading service details…
        </p>
      )}
      {!loading && error && (
        <div className="service-empty-state" role="alert">
          <h2>Service details unavailable</h2>
          <p>{error}</p>
          {!(
            error.startsWith("This service link is invalid") ||
            error.startsWith("This service is no longer available")
          ) && (
            <button
              className="button button-secondary"
              onClick={() => setRevision((value) => value + 1)}
              type="button"
            >
              Retry
            </button>
          )}
        </div>
      )}
      {!loading && !error && listing && (
        <article className="public-service-detail-card">
          <p className="eyebrow">
            {categoryNames.get(listing.category.slug) ?? listing.category.name}
          </p>
          <h2 id="service-detail-title">{listing.title}</h2>
          <p className="public-service-location">
            {listing.city}
            {listing.region ? `, ${listing.region}` : ""}
          </p>
          <p className="public-service-provider">
            Service provider: {listing.provider.displayName}
          </p>
          {listing.provider.headline && (
            <p className="muted">{listing.provider.headline}</p>
          )}
          <p className="public-service-detail-description">
            {listing.description}
          </p>
          <p className="public-service-price">{priceText(listing)}</p>
          {userLoading ? (
            <p className="muted" role="status">
              Checking your account…
            </p>
          ) : user?.role === "customer" ? (
            <button
              className="button"
              onClick={() => setRequestFormOpen((open) => !open)}
              type="button"
            >
              {requestFormOpen ? "Close request form" : "Request booking"}
            </button>
          ) : user ? (
            <p className="muted">
              Booking requests are available to customer accounts.
            </p>
          ) : (
            <a
              className="button"
              href={`/login?returnTo=${encodeURIComponent(`${window.location.pathname}?requestBooking=1`)}`}
            >
              Sign in to request this service
            </a>
          )}
        </article>
      )}
      {!loading && !error && listing && requestFormOpen && (
        <BookingRequestForm
          key={listing.id}
          customer={user}
          listingId={listing.id}
          onClose={closeRequestForm}
        />
      )}
    </section>
  );
}
