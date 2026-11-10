import { useEffect, useState, type FormEvent } from "react";
import { serviceCategories } from "@evently/shared";
import type { CurrentUser } from "./auth-api.js";
import {
  providerGet,
  providerListingGet,
  providerListingMutation,
  ProviderApiError,
} from "./provider-api.js";

type AdminQueueListing = {
  id: string;
  category: { slug: string; name: string };
  title: string;
  city: string;
  region: string | null;
  pricingMethod: "fixed" | "starting_at" | "quote_only";
  priceAmountPaise: number | null;
  currency: string;
  publicationStatus: "draft" | "published";
  moderationStatus: "visible" | "hidden";
  moderationReason: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  provider: { displayName: string; slug: string };
};

type AdminListingDetail = Omit<AdminQueueListing, "category" | "provider"> & {
  categorySlug: string;
  description: string;
};

type QueueResponse = {
  listings: AdminQueueListing[];
  pagination: { page: number; pageSize: number; total: number };
};

const pageSize = 25;

function failureMessage(reason: unknown): string {
  if (reason instanceof ProviderApiError && reason.status === 401) {
    return "Your session has ended. Sign in again to continue.";
  }
  return reason instanceof Error
    ? reason.message
    : "The request could not be completed. Please try again.";
}

function priceText(listing: AdminQueueListing | AdminListingDetail): string {
  if (listing.pricingMethod === "quote_only") {
    return "Request a quote";
  }
  const amount = new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: listing.currency,
    maximumFractionDigits: 2,
  }).format((listing.priceAmountPaise ?? 0) / 100);
  return listing.pricingMethod === "starting_at"
    ? `Starting at ${amount}`
    : amount;
}

export function AdminServiceListingsScreen({
  user,
}: {
  user: CurrentUser | null;
}) {
  const [listings, setListings] = useState<AdminQueueListing[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [publicationStatus, setPublicationStatus] = useState("");
  const [moderationStatus, setModerationStatus] = useState("");
  const [categorySlug, setCategorySlug] = useState("");
  const [city, setCity] = useState("");
  const [cityFilter, setCityFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<AdminListingDetail | null>(null);
  const [selectedEtag, setSelectedEtag] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [reason, setReason] = useState("");
  const [actionError, setActionError] = useState("");
  const [actionPending, setActionPending] = useState(false);

  useEffect(() => {
    if (user?.role !== "admin") {
      return;
    }
    let active = true;
    const query = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
    });
    if (publicationStatus) query.set("publicationStatus", publicationStatus);
    if (moderationStatus) query.set("moderationStatus", moderationStatus);
    if (categorySlug) query.set("categorySlug", categorySlug);
    if (cityFilter) query.set("city", cityFilter);

    void providerGet<QueueResponse>(
      `/api/v1/admin/service-listings?${query.toString()}`,
    )
      .then((response) => {
        if (active) {
          setListings(response.listings);
          setTotal(response.pagination.total);
          setLoadError("");
        }
      })
      .catch((failure: unknown) => {
        if (active) setLoadError(failureMessage(failure));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [
    categorySlug,
    cityFilter,
    moderationStatus,
    page,
    publicationStatus,
    revision,
    user,
  ]);

  async function openListing(listingId: string) {
    setDetailLoading(true);
    setDetailError("");
    setActionError("");
    setReason("");
    setSelected(null);
    setSelectedEtag(null);
    try {
      const response = await providerListingGet<{
        listing: AdminListingDetail;
      }>(`/api/v1/admin/service-listings/${listingId}`);
      setSelected(response.data.listing);
      setSelectedEtag(response.etag);
    } catch (failure) {
      setDetailError(failureMessage(failure));
    } finally {
      setDetailLoading(false);
    }
  }

  async function moderate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || !selectedEtag || actionPending) return;
    const hiding = selected.moderationStatus === "visible";
    const trimmedReason = reason.trim();
    if (hiding && (trimmedReason.length < 8 || trimmedReason.length > 500)) {
      setActionError("Enter a moderation reason between 8 and 500 characters.");
      return;
    }
    if (
      !window.confirm(
        hiding
          ? "Hide this service from public discovery?"
          : "Restore this service's moderation visibility?",
      )
    ) {
      return;
    }

    setActionPending(true);
    setActionError("");
    try {
      const response = await providerListingMutation<{
        listing: AdminListingDetail;
      }>(
        "POST",
        `/api/v1/admin/service-listings/${selected.id}/${hiding ? "hide" : "restore"}`,
        hiding ? { reason: trimmedReason } : {},
        { etag: selectedEtag },
      );
      setSelected(response.data.listing);
      setSelectedEtag(response.etag);
      setReason("");
      setLoading(true);
      setRevision((value) => value + 1);
    } catch (failure) {
      setActionError(failureMessage(failure));
    } finally {
      setActionPending(false);
    }
  }

  if (!user || user.role !== "admin") {
    return (
      <section className="auth-card marketplace-card">
        <h2>Administrator access required</h2>
        <p className="form-error" role="alert">
          Only authorized administrators can review service listings.
        </p>
      </section>
    );
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <section
      className="auth-card marketplace-card marketplace-card-wide service-dashboard"
      aria-labelledby="admin-services-title"
    >
      <div className="service-dashboard-heading">
        <div>
          <p className="eyebrow">Administration</p>
          <h2 id="admin-services-title">Service listing moderation</h2>
          <p className="muted">
            Review listing details and hide or restore public visibility.
          </p>
        </div>
      </div>

      <form
        className="admin-listing-filters"
        onSubmit={(event) => {
          event.preventDefault();
          setPage(1);
          setSelected(null);
          setLoading(true);
          setCityFilter(city.trim());
          setRevision((value) => value + 1);
        }}
      >
        <label>
          Publication status
          <select
            value={publicationStatus}
            onChange={(event) => {
              setLoading(true);
              setPublicationStatus(event.currentTarget.value);
              setPage(1);
              setSelected(null);
            }}
          >
            <option value="">All publication states</option>
            <option value="draft">Draft</option>
            <option value="published">Published</option>
          </select>
        </label>
        <label>
          Moderation status
          <select
            value={moderationStatus}
            onChange={(event) => {
              setLoading(true);
              setModerationStatus(event.currentTarget.value);
              setPage(1);
              setSelected(null);
            }}
          >
            <option value="">All moderation states</option>
            <option value="visible">Visible</option>
            <option value="hidden">Hidden</option>
          </select>
        </label>
        <label>
          Category
          <select
            value={categorySlug}
            onChange={(event) => {
              setLoading(true);
              setCategorySlug(event.currentTarget.value);
              setPage(1);
              setSelected(null);
            }}
          >
            <option value="">All categories</option>
            {serviceCategories.map((category) => (
              <option key={category.slug} value={category.slug}>
                {category.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          City
          <input
            maxLength={120}
            value={city}
            onChange={(event) => setCity(event.currentTarget.value)}
          />
        </label>
        <button className="button button-secondary" type="submit">
          Apply filters
        </button>
      </form>

      {loading && (
        <p className="muted" role="status">
          Loading service listings…
        </p>
      )}
      {loadError && (
        <div>
          <p className="form-error" role="alert">
            {loadError}
          </p>
          <button
            className="button button-secondary"
            onClick={() => {
              setLoading(true);
              setLoadError("");
              setRevision((value) => value + 1);
            }}
            type="button"
          >
            Retry
          </button>
        </div>
      )}
      {!loading && !loadError && listings.length === 0 && (
        <p className="muted">No service listings match these filters.</p>
      )}
      {!loading && listings.length > 0 && (
        <>
          <ul className="service-list">
            {listings.map((listing) => (
              <li className="service-list-card" key={listing.id}>
                <div className="service-list-card-heading">
                  <div>
                    <p className="eyebrow">
                      {listing.category.name} · {listing.provider.displayName}
                    </p>
                    <h3>{listing.title}</h3>
                  </div>
                  <span className="service-version">
                    {listing.publicationStatus} · {listing.moderationStatus}
                  </span>
                </div>
                <p className="muted">
                  {listing.city}
                  {listing.region ? `, ${listing.region}` : ""}
                </p>
                <button
                  className="button button-secondary"
                  onClick={() => void openListing(listing.id)}
                  type="button"
                >
                  Review listing
                </button>
              </li>
            ))}
          </ul>
          {totalPages > 1 && (
            <nav
              className="pagination-controls"
              aria-label="Admin listing pages"
            >
              <button
                className="button button-secondary"
                disabled={page <= 1 || loading}
                onClick={() => {
                  setLoading(true);
                  setPage((value) => Math.max(1, value - 1));
                }}
                type="button"
              >
                Previous
              </button>
              <span>
                Page {page} of {totalPages} · {total} listings
              </span>
              <button
                className="button button-secondary"
                disabled={page >= totalPages || loading}
                onClick={() => {
                  setLoading(true);
                  setPage((value) => Math.min(totalPages, value + 1));
                }}
                type="button"
              >
                Next
              </button>
            </nav>
          )}
        </>
      )}

      {(detailLoading || detailError) && (
        <section className="admin-listing-detail" aria-live="polite">
          {detailLoading && <p role="status">Loading listing details…</p>}
          {detailError && (
            <p className="form-error" role="alert">
              {detailError}
            </p>
          )}
        </section>
      )}
      {selected && (
        <section
          className="admin-listing-detail"
          aria-labelledby="detail-title"
        >
          <h3 id="detail-title">Listing details</h3>
          <p className="eyebrow">{selected.categorySlug}</p>
          <h4>{selected.title}</h4>
          <p>{selected.description}</p>
          <dl className="service-facts">
            <div>
              <dt>Location</dt>
              <dd>
                {selected.city}
                {selected.region ? `, ${selected.region}` : ""}
              </dd>
            </div>
            <div>
              <dt>Pricing</dt>
              <dd>{priceText(selected)}</dd>
            </div>
            <div>
              <dt>Publication</dt>
              <dd>{selected.publicationStatus}</dd>
            </div>
            <div>
              <dt>Moderation</dt>
              <dd>{selected.moderationStatus}</dd>
            </div>
          </dl>
          {selected.moderationStatus === "hidden" && (
            <p className="moderation-reason">
              <strong>Moderation reason:</strong>{" "}
              {selected.moderationReason ?? "No reason was recorded."}
            </p>
          )}
          {actionError && (
            <p className="form-error" role="alert">
              {actionError}
            </p>
          )}
          <form className="admin-moderation-actions" onSubmit={moderate}>
            {selected.moderationStatus === "visible" && (
              <label>
                Reason for hiding this listing
                <textarea
                  maxLength={500}
                  minLength={8}
                  onChange={(event) => setReason(event.currentTarget.value)}
                  required
                  value={reason}
                />
              </label>
            )}
            <button
              className="button"
              disabled={
                actionPending ||
                !selectedEtag ||
                (selected.moderationStatus === "visible" &&
                  reason.trim().length < 8)
              }
              type="submit"
            >
              {actionPending
                ? "Saving moderation…"
                : selected.moderationStatus === "hidden"
                  ? "Restore listing"
                  : "Hide listing"}
            </button>
          </form>
        </section>
      )}
    </section>
  );
}
