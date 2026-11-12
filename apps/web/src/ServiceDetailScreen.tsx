import { useEffect, useState } from "react";
import {
  serviceCategories,
  type PublicServiceListingDto,
} from "@evently/shared";
import {
  fetchPublicServiceListing,
  PublicServiceListingApiError,
} from "./public-service-listings-api.js";

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

export function ServiceDetailScreen({ listingId }: { listingId: string }) {
  const [revision, setRevision] = useState(0);
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
        </article>
      )}
    </section>
  );
}
