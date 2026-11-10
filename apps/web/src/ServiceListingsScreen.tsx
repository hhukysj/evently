import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  serviceCategories,
  serviceListingInputSchema,
  type ServiceListingInput,
  type ServiceListingPricingMethod,
} from "@evently/shared";
import type { CurrentUser } from "./auth-api.js";
import {
  providerGet,
  providerListingGet,
  providerListingMutation,
  ProviderApiError,
} from "./provider-api.js";

type OwnerServiceListing = {
  id: string;
  categorySlug: ServiceListingInput["categorySlug"];
  title: string;
  description: string;
  city: string;
  region: string | null;
  pricingMethod: ServiceListingPricingMethod;
  priceAmountPaise: number | null;
  currency: string;
  publicationStatus: "draft" | "published";
  moderationStatus: "visible" | "hidden";
  moderationReason: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};

type ListingForm = {
  title: string;
  description: string;
  categorySlug: ServiceListingInput["categorySlug"];
  city: string;
  region: string;
  pricingMethod: ServiceListingPricingMethod;
  priceAmount: string;
};

const emptyForm: ListingForm = {
  title: "",
  description: "",
  categorySlug: serviceCategories[0].slug,
  city: "",
  region: "",
  pricingMethod: "quote_only",
  priceAmount: "",
};

const listingPageSize = 25;

const categoryNames = new Map(
  serviceCategories.map((category) => [category.slug, category.name]),
);

function formFromListing(listing: OwnerServiceListing): ListingForm {
  return {
    title: listing.title,
    description: listing.description,
    categorySlug: listing.categorySlug,
    city: listing.city,
    region: listing.region ?? "",
    pricingMethod: listing.pricingMethod,
    priceAmount:
      listing.priceAmountPaise === null
        ? ""
        : (listing.priceAmountPaise / 100).toFixed(2),
  };
}

function amountInPaise(value: string): number | null {
  if (!value) {
    return null;
  }
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) {
    return Number.NaN;
  }
  const [rupees, fraction = ""] = value.split(".");
  return Number(rupees) * 100 + Number(fraction.padEnd(2, "0"));
}

function errorText(reason: unknown): string {
  if (
    reason instanceof ProviderApiError &&
    reason.code === "PROFESSIONAL_NOT_ELIGIBLE"
  ) {
    return "Your provider account is not currently eligible to manage services. An approved, active professional account is required.";
  }
  if (reason instanceof ProviderApiError && reason.status === 401) {
    return "Your session has ended. Sign in again to manage your services.";
  }
  return reason instanceof Error
    ? reason.message
    : "The request could not be completed. Please try again.";
}

function priceText(listing: OwnerServiceListing): string {
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

function getFieldErrors(
  issues: Array<{ path: PropertyKey[]; message: string }>,
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of issues) {
    const field = String(issue.path[0] ?? "form");
    errors[field] ??= issue.message;
  }
  return errors;
}

function updateListing(
  listings: OwnerServiceListing[],
  next: OwnerServiceListing,
): OwnerServiceListing[] {
  const found = listings.some((listing) => listing.id === next.id);
  return found
    ? listings.map((listing) => (listing.id === next.id ? next : listing))
    : [next, ...listings];
}

export function ServiceListingsScreen({ user }: { user: CurrentUser | null }) {
  const [listings, setListings] = useState<OwnerServiceListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [loadRevision, setLoadRevision] = useState(0);
  const [page, setPage] = useState(1);
  const [totalListings, setTotalListings] = useState(0);
  const [form, setForm] = useState<ListingForm | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [etag, setEtag] = useState<string | null>(null);
  const [publishedEditConfirmed, setPublishedEditConfirmed] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [pendingListingId, setPendingListingId] = useState<string | null>(null);
  const [conflictListingId, setConflictListingId] = useState<string | null>(
    null,
  );
  const serviceTitleRef = useRef<HTMLInputElement>(null);
  const formOpen = form !== null;

  useEffect(() => {
    if (!user || user.role !== "professional") {
      return;
    }
    let active = true;
    void providerGet<{
      listings: OwnerServiceListing[];
      pagination: { page: number; pageSize: number; total: number };
    }>(
      `/api/v1/professional/service-listings?page=${page}&pageSize=${listingPageSize}`,
    )
      .then(({ listings: ownListings, pagination }) => {
        if (active) {
          setListings(ownListings);
          setTotalListings(pagination.total);
        }
      })
      .catch((reason: unknown) => {
        if (active) {
          setLoadError(errorText(reason));
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [loadRevision, page, user]);

  useEffect(() => {
    if (formOpen) {
      serviceTitleRef.current?.focus();
    }
  }, [formOpen]);

  function startCreate() {
    setForm({ ...emptyForm });
    setEditingId(null);
    setEtag(null);
    setPublishedEditConfirmed(false);
    setFieldErrors({});
    setFormError("");
    setMessage("");
  }

  async function startEdit(listing: OwnerServiceListing) {
    setMessage("");
    setFormError("");
    setFieldErrors({});
    let confirmedPublishedEdit = false;
    if (listing.publicationStatus === "published") {
      confirmedPublishedEdit = window.confirm(
        "Editing this published service requires confirmation. Continue to load it for editing?",
      );
      if (!confirmedPublishedEdit) {
        return;
      }
    }
    setPendingListingId(listing.id);
    try {
      const current = await providerListingGet<{
        listing: OwnerServiceListing;
      }>(`/api/v1/professional/service-listings/${listing.id}`);
      if (
        current.data.listing.publicationStatus === "published" &&
        !confirmedPublishedEdit
      ) {
        confirmedPublishedEdit = window.confirm(
          "This service is now published. Confirm that you intend to edit the published listing.",
        );
        if (!confirmedPublishedEdit) {
          return;
        }
      }
      setForm(formFromListing(current.data.listing));
      setEditingId(listing.id);
      setEtag(current.etag);
      setPublishedEditConfirmed(
        current.data.listing.publicationStatus === "published" &&
          confirmedPublishedEdit,
      );
      if (!current.etag) {
        setFormError(
          "The server did not return a listing version token. Reload the listing before editing.",
        );
      }
    } catch (reason) {
      setFormError(errorText(reason));
    } finally {
      setPendingListingId(null);
    }
  }

  function closeForm() {
    setForm(null);
    setEditingId(null);
    setEtag(null);
    setPublishedEditConfirmed(false);
    setFieldErrors({});
    setFormError("");
  }

  async function submitForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form) {
      return;
    }
    setFormError("");
    setFieldErrors({});
    const parsed = serviceListingInputSchema.safeParse({
      title: form.title,
      description: form.description,
      categorySlug: form.categorySlug,
      city: form.city,
      region: form.region,
      pricingMethod: form.pricingMethod,
      priceAmountPaise:
        form.pricingMethod === "quote_only"
          ? null
          : amountInPaise(form.priceAmount),
    });
    if (!parsed.success) {
      setFieldErrors(getFieldErrors(parsed.error.issues));
      return;
    }
    if (editingId && !etag) {
      setFormError(
        "A current listing version token is required. Reload the listing before saving.",
      );
      return;
    }
    setSubmitting(true);
    setMessage("");
    try {
      const response = await providerListingMutation<{
        listing: OwnerServiceListing;
      }>(
        editingId ? "PATCH" : "POST",
        editingId
          ? `/api/v1/professional/service-listings/${editingId}`
          : "/api/v1/professional/service-listings",
        parsed.data,
        {
          ...(etag ? { etag } : {}),
          confirmPublishedEdit: publishedEditConfirmed,
        },
      );
      setListings((current) => updateListing(current, response.data.listing));
      if (!editingId) {
        setPage(1);
        setLoadRevision((revision) => revision + 1);
      }
      if (editingId && !response.etag) {
        setEtag(null);
        setConflictListingId(editingId);
        setFormError(
          "The server saved your changes but did not return a new version token. Reload before another edit or state change.",
        );
      } else {
        closeForm();
        setMessage(
          editingId ? "Service changes saved." : "Service listing created.",
        );
      }
    } catch (reason) {
      if (
        reason instanceof ProviderApiError &&
        (reason.status === 412 || reason.code === "PRECONDITION_FAILED")
      ) {
        setConflictListingId(editingId);
        setFormError(
          "This listing changed since you loaded it. Your edits were not applied. Reload the latest version before continuing.",
        );
      } else if (
        reason instanceof ProviderApiError &&
        reason.code === "PUBLISHED_EDIT_CONFIRMATION_REQUIRED"
      ) {
        if (
          window.confirm(
            "This service is now published. Confirm that you intend to edit the published listing.",
          )
        ) {
          setPublishedEditConfirmed(true);
          setFormError(
            "Confirmation recorded. Select Save changes again to apply your edit.",
          );
        } else {
          setFormError(
            "The published service was not changed. Confirm before saving if you want to proceed.",
          );
        }
      } else {
        setFormError(errorText(reason));
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function reloadListing(listingId: string) {
    setPendingListingId(listingId);
    setFormError("");
    try {
      const current = await providerListingGet<{
        listing: OwnerServiceListing;
      }>(`/api/v1/professional/service-listings/${listingId}`);
      setListings((items) => updateListing(items, current.data.listing));
      setConflictListingId(null);
      if (editingId === listingId) {
        setForm(formFromListing(current.data.listing));
        setEtag(current.etag);
        setPublishedEditConfirmed(false);
        if (!current.etag) {
          setFormError(
            "The server did not return a listing version token. Editing remains unavailable until a version token is available.",
          );
        }
      }
    } catch (reason) {
      setFormError(errorText(reason));
    } finally {
      setPendingListingId(null);
    }
  }

  async function transitionListing(
    listing: OwnerServiceListing,
    action: "publish" | "unpublish",
  ) {
    const actionLabel = action === "publish" ? "publish" : "unpublish";
    if (
      !window.confirm(
        action === "publish"
          ? "Publish this service? It may become visible to customers."
          : "Unpublish this service? It will no longer be publicly visible.",
      )
    ) {
      return;
    }
    setPendingListingId(listing.id);
    setFormError("");
    setMessage("");
    try {
      const current = await providerListingGet<{
        listing: OwnerServiceListing;
      }>(`/api/v1/professional/service-listings/${listing.id}`);
      if (!current.etag) {
        throw new Error(
          "The server did not return a listing version token. Reload the dashboard before retrying.",
        );
      }
      const changed = await providerListingMutation<{
        listing: OwnerServiceListing;
      }>(
        "POST",
        `/api/v1/professional/service-listings/${listing.id}/${action}`,
        {},
        { etag: current.etag },
      );
      setListings((items) => updateListing(items, changed.data.listing));
      setMessage(
        action === "publish" ? "Service published." : "Service unpublished.",
      );
      setConflictListingId(null);
      if (!changed.etag) {
        setConflictListingId(listing.id);
        setFormError(
          "The action succeeded, but the server did not return a new version token. Reload this listing before another change.",
        );
      }
    } catch (reason) {
      if (
        reason instanceof ProviderApiError &&
        (reason.status === 412 || reason.code === "PRECONDITION_FAILED")
      ) {
        setConflictListingId(listing.id);
        setFormError(
          "This listing changed before the action completed. Reload the latest version before retrying.",
        );
      } else {
        setFormError(
          `${actionLabel[0]?.toUpperCase()}${actionLabel.slice(1)} failed: ${errorText(reason)}`,
        );
      }
    } finally {
      setPendingListingId(null);
    }
  }

  if (!user) {
    return (
      <section className="auth-card marketplace-card">
        <h2>Manage your services</h2>
        <p className="muted">Sign in with an approved provider account.</p>
        <a className="button" href="/login">
          Sign in
        </a>
      </section>
    );
  }
  if (user.role !== "professional") {
    return (
      <section className="auth-card marketplace-card">
        <h2>Provider access required</h2>
        <p className="form-error" role="alert">
          Only approved professional accounts can manage service listings.
        </p>
        {user.role === "customer" && (
          <a className="button" href="/provider/apply">
            Apply as a provider
          </a>
        )}
      </section>
    );
  }
  if (loading) {
    return (
      <section
        className="auth-card marketplace-card"
        aria-busy="true"
        aria-labelledby="services-title"
      >
        <h2 id="services-title">Your services</h2>
        <p className="muted" role="status">
          Loading your service listings…
        </p>
      </section>
    );
  }
  if (loadError) {
    return (
      <section className="auth-card marketplace-card">
        <h2>Your services</h2>
        <p className="form-error" role="alert">
          {loadError}
        </p>
        <button
          className="button button-secondary"
          onClick={() => {
            setLoading(true);
            setLoadError("");
            setLoadRevision((revision) => revision + 1);
          }}
          type="button"
        >
          Retry
        </button>
        {loadError.startsWith("Your session has ended") && (
          <p>
            <a href="/login">Sign in again</a>
          </p>
        )}
      </section>
    );
  }
  const totalPages = Math.max(1, Math.ceil(totalListings / listingPageSize));

  return (
    <section
      className="auth-card marketplace-card marketplace-card-wide service-dashboard"
      aria-labelledby="services-title"
    >
      <div className="service-dashboard-heading">
        <div>
          <p className="eyebrow">Professional workspace</p>
          <h2 id="services-title">Your services</h2>
          <p className="muted">
            Manage service details and control whether each service is
            published.
          </p>
        </div>
        {!form && (
          <button className="button" onClick={startCreate} type="button">
            Create a service
          </button>
        )}
      </div>

      {message && (
        <p className="form-success" role="status">
          {message}
        </p>
      )}
      {formError && !form && (
        <p className="form-error" role="alert">
          {formError}
        </p>
      )}
      {conflictListingId && !form && (
        <button
          className="button button-secondary"
          disabled={pendingListingId === conflictListingId}
          onClick={() => void reloadListing(conflictListingId)}
          type="button"
        >
          {pendingListingId === conflictListingId
            ? "Reloading listing…"
            : "Reload latest listing"}
        </button>
      )}

      {form && (
        <form
          aria-busy={submitting}
          className="marketplace-form service-listing-form"
          noValidate
          onSubmit={(event) => void submitForm(event)}
        >
          <h3>{editingId ? "Edit service" : "Create a service"}</h3>
          {editingId && (
            <p className="field-hint">
              Listing version{" "}
              {listings.find((item) => item.id === editingId)?.version ??
                "current"}
              .
              {publishedEditConfirmed &&
                " Published-edit confirmation recorded."}
            </p>
          )}
          <label htmlFor="service-title">Service title</label>
          <input
            aria-describedby={
              fieldErrors.title ? "service-title-error" : undefined
            }
            aria-invalid={Boolean(fieldErrors.title)}
            id="service-title"
            maxLength={120}
            minLength={2}
            onChange={(event) =>
              setForm({ ...form, title: event.currentTarget.value })
            }
            ref={serviceTitleRef}
            required
            value={form.title}
          />
          {fieldErrors.title && (
            <span className="field-error" id="service-title-error">
              {fieldErrors.title}
            </span>
          )}

          <label htmlFor="service-description">Description</label>
          <textarea
            aria-describedby={
              fieldErrors.description ? "service-description-error" : undefined
            }
            aria-invalid={Boolean(fieldErrors.description)}
            id="service-description"
            maxLength={1200}
            minLength={20}
            onChange={(event) =>
              setForm({ ...form, description: event.currentTarget.value })
            }
            required
            rows={5}
            value={form.description}
          />
          {fieldErrors.description && (
            <span className="field-error" id="service-description-error">
              {fieldErrors.description}
            </span>
          )}

          <label htmlFor="service-category">Category</label>
          <select
            id="service-category"
            onChange={(event) =>
              setForm({
                ...form,
                categorySlug: event.currentTarget
                  .value as ServiceListingInput["categorySlug"],
              })
            }
            value={form.categorySlug}
          >
            {serviceCategories.map((category) => (
              <option key={category.slug} value={category.slug}>
                {category.name}
              </option>
            ))}
          </select>

          <div className="service-form-grid">
            <div>
              <label htmlFor="service-city">City</label>
              <input
                aria-describedby={
                  fieldErrors.city ? "service-city-error" : undefined
                }
                aria-invalid={Boolean(fieldErrors.city)}
                id="service-city"
                maxLength={120}
                minLength={2}
                onChange={(event) =>
                  setForm({ ...form, city: event.currentTarget.value })
                }
                required
                value={form.city}
              />
              {fieldErrors.city && (
                <span className="field-error" id="service-city-error">
                  {fieldErrors.city}
                </span>
              )}
            </div>
            <div>
              <label htmlFor="service-region">Region or state</label>
              <input
                aria-describedby={
                  fieldErrors.region ? "service-region-error" : undefined
                }
                aria-invalid={Boolean(fieldErrors.region)}
                id="service-region"
                maxLength={120}
                onChange={(event) =>
                  setForm({ ...form, region: event.currentTarget.value })
                }
                value={form.region}
              />
              {fieldErrors.region && (
                <span className="field-error" id="service-region-error">
                  {fieldErrors.region}
                </span>
              )}
            </div>
          </div>

          <label htmlFor="service-pricing-method">Pricing model</label>
          <select
            id="service-pricing-method"
            onChange={(event) => {
              const pricingMethod = event.currentTarget
                .value as ServiceListingPricingMethod;
              setForm({
                ...form,
                pricingMethod,
                priceAmount:
                  pricingMethod === "quote_only" ? "" : form.priceAmount,
              });
            }}
            value={form.pricingMethod}
          >
            <option value="quote_only">Request a quote</option>
            <option value="fixed">Fixed price</option>
            <option value="starting_at">Starting at</option>
          </select>
          {form.pricingMethod !== "quote_only" && (
            <>
              <label htmlFor="service-price">Price in INR</label>
              <input
                aria-describedby={
                  fieldErrors.priceAmountPaise
                    ? "service-price-error"
                    : undefined
                }
                aria-invalid={Boolean(fieldErrors.priceAmountPaise)}
                id="service-price"
                inputMode="decimal"
                max="21474836.47"
                min="0"
                onChange={(event) =>
                  setForm({ ...form, priceAmount: event.currentTarget.value })
                }
                placeholder="0.00"
                step="0.01"
                type="number"
                value={form.priceAmount}
              />
              <p className="field-hint">
                Enter a non-negative amount. Zero is allowed.
              </p>
              {fieldErrors.priceAmountPaise && (
                <span className="field-error" id="service-price-error">
                  {fieldErrors.priceAmountPaise}
                </span>
              )}
            </>
          )}
          {fieldErrors.form && (
            <p className="form-error" role="alert">
              {fieldErrors.form}
            </p>
          )}
          {formError && (
            <p className="form-error" role="alert">
              {formError}
            </p>
          )}
          {editingId && conflictListingId === editingId && (
            <button
              className="button button-secondary"
              disabled={pendingListingId === editingId}
              onClick={() => void reloadListing(editingId)}
              type="button"
            >
              {pendingListingId === editingId
                ? "Reloading listing…"
                : "Reload latest version"}
            </button>
          )}
          <div className="service-form-actions">
            <button className="button" disabled={submitting} type="submit">
              {submitting
                ? "Saving service…"
                : editingId
                  ? "Save changes"
                  : "Create service"}
            </button>
            <button
              className="button button-secondary"
              disabled={submitting}
              onClick={closeForm}
              type="button"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
      {form && listings.length > 0 && (
        <p className="field-hint">
          Finish or cancel this form before editing or changing another service.
        </p>
      )}

      {listings.length === 0 ? (
        <div className="service-empty-state">
          <h3>No services yet</h3>
          <p className="muted">
            Create a service to describe what you offer and how customers can
            enquire.
          </p>
          {!form && (
            <button
              className="button button-secondary"
              onClick={startCreate}
              type="button"
            >
              Create your first service
            </button>
          )}
        </div>
      ) : (
        <ul className="service-list">
          {listings.map((listing) => (
            <li className="service-list-card" key={listing.id}>
              <div className="service-list-card-heading">
                <div>
                  <p className="eyebrow">
                    {categoryNames.get(listing.categorySlug) ??
                      "Service category"}
                  </p>
                  <h3>{listing.title}</h3>
                </div>
                <span className="service-version">
                  Version {listing.version}
                </span>
              </div>
              <p className="service-description">{listing.description}</p>
              {listing.moderationStatus === "hidden" && (
                <p className="moderation-reason" role="status">
                  <strong>Hidden by moderation:</strong>{" "}
                  {listing.moderationReason ?? "No reason was recorded."}
                </p>
              )}
              <dl className="service-facts">
                <div>
                  <dt>Pricing</dt>
                  <dd>{priceText(listing)}</dd>
                </div>
                <div>
                  <dt>Publication</dt>
                  <dd>{listing.publicationStatus}</dd>
                </div>
                <div>
                  <dt>Moderation</dt>
                  <dd>{listing.moderationStatus}</dd>
                </div>
                <div>
                  <dt>Service area</dt>
                  <dd>
                    {listing.city}
                    {listing.region ? `, ${listing.region}` : ""}
                  </dd>
                </div>
              </dl>
              <div className="service-list-actions">
                <button
                  className="button button-secondary"
                  disabled={pendingListingId === listing.id || Boolean(form)}
                  onClick={() => void startEdit(listing)}
                  title={
                    form
                      ? "Finish or cancel the current form first."
                      : undefined
                  }
                  type="button"
                >
                  {pendingListingId === listing.id ? "Loading…" : "Edit"}
                </button>
                {listing.publicationStatus === "draft" ? (
                  <button
                    className="button"
                    disabled={
                      listing.moderationStatus === "hidden" ||
                      pendingListingId === listing.id ||
                      Boolean(form)
                    }
                    onClick={() => void transitionListing(listing, "publish")}
                    title={
                      listing.moderationStatus === "hidden"
                        ? "A moderated listing cannot be published."
                        : form
                          ? "Finish or cancel the current form first."
                          : undefined
                    }
                    type="button"
                  >
                    Publish
                  </button>
                ) : (
                  <button
                    className="button button-secondary"
                    disabled={pendingListingId === listing.id || Boolean(form)}
                    onClick={() => void transitionListing(listing, "unpublish")}
                    title={
                      form
                        ? "Finish or cancel the current form first."
                        : undefined
                    }
                    type="button"
                  >
                    Unpublish
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {totalPages > 1 && (
        <nav className="pagination-controls" aria-label="Service listing pages">
          <button
            className="button button-secondary"
            disabled={page <= 1 || loading}
            onClick={() => {
              setLoading(true);
              setPage((current) => Math.max(1, current - 1));
            }}
            type="button"
          >
            Previous
          </button>
          <span>
            Page {page} of {totalPages} · {totalListings} services
          </span>
          <button
            className="button button-secondary"
            disabled={page >= totalPages || loading}
            onClick={() => {
              setLoading(true);
              setPage((current) => Math.min(totalPages, current + 1));
            }}
            type="button"
          >
            Next
          </button>
        </nav>
      )}
    </section>
  );
}
