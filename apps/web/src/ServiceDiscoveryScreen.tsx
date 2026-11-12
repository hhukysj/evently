import { useEffect, useState, type FormEvent } from "react";
import {
  publicServiceListingQuerySchema,
  serviceCategories,
  type PublicServiceListingDto,
  type PublicServiceListingQuery,
} from "@evently/shared";
import {
  fetchPublicServiceListings,
  PublicServiceListingApiError,
} from "./public-service-listings-api.js";

const pageSize = 25;
const defaultQuery = publicServiceListingQuerySchema.parse({});
const categoryNames = new Map(
  serviceCategories.map(({ slug, name }) => [slug, name]),
);

interface SearchFilters {
  categorySlug: string;
  city: string;
  region: string;
  pricingMethod: string;
}

type ListingRequestState =
  | { key: string; status: "loading" }
  | { key: string; status: "error"; error: string }
  | {
      key: string;
      status: "success";
      listings: PublicServiceListingDto[];
      total: number;
    };

function queryResultFromLocation() {
  const entries = Array.from(
    new URLSearchParams(window.location.search).entries(),
  );
  if (new Set(entries.map(([key]) => key)).size !== entries.length) {
    return { success: false as const };
  }
  return publicServiceListingQuerySchema.safeParse(Object.fromEntries(entries));
}

function queryFromLocation(): PublicServiceListingQuery {
  const result = queryResultFromLocation();
  return result.success ? result.data : defaultQuery;
}

function sameQuery(
  left: PublicServiceListingQuery,
  right: PublicServiceListingQuery,
): boolean {
  return (
    left.page === right.page &&
    left.pageSize === right.pageSize &&
    left.categorySlug === right.categorySlug &&
    left.city === right.city &&
    left.region === right.region &&
    left.pricingMethod === right.pricingMethod
  );
}

function queryKey(query: PublicServiceListingQuery): string {
  return JSON.stringify([
    query.page,
    query.pageSize,
    query.categorySlug,
    query.city,
    query.region,
    query.pricingMethod,
  ]);
}

function filtersFromQuery(query: PublicServiceListingQuery): SearchFilters {
  return {
    categorySlug: query.categorySlug ?? "",
    city: query.city ?? "",
    region: query.region ?? "",
    pricingMethod: query.pricingMethod ?? "",
  };
}

function writeQueryToLocation(
  query: PublicServiceListingQuery,
  replace = false,
): void {
  const params = new URLSearchParams({
    page: String(query.page),
    pageSize: String(query.pageSize),
  });
  if (query.categorySlug) params.set("categorySlug", query.categorySlug);
  if (query.city) params.set("city", query.city);
  if (query.region) params.set("region", query.region);
  if (query.pricingMethod) params.set("pricingMethod", query.pricingMethod);
  const method = replace ? "replaceState" : "pushState";
  window.history[method]({}, "", `/services?${params.toString()}`);
}

function categoryName(listing: PublicServiceListingDto): string {
  return categoryNames.get(listing.category.slug) ?? listing.category.name;
}

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

function descriptionExcerpt(description: string): string {
  const excerpt = description.trim();
  return excerpt.length > 190 ? `${excerpt.slice(0, 187).trimEnd()}…` : excerpt;
}

function errorMessage(error: unknown): string {
  if (error instanceof PublicServiceListingApiError && error.status === 400) {
    return "Some search filters are invalid. Reset them and try again.";
  }
  return error instanceof Error
    ? error.message
    : "The request could not be completed. Please try again.";
}

export function ServiceDiscoveryScreen() {
  const [query, setQuery] = useState(queryFromLocation);
  const [filterDraft, setFilterDraft] = useState<{
    queryKey: string;
    filters: SearchFilters;
  } | null>(null);
  const [filterError, setFilterError] = useState("");
  const [loadRevision, setLoadRevision] = useState(0);
  const activeQueryKey = queryKey(query);
  const filters =
    filterDraft?.queryKey === activeQueryKey
      ? filterDraft.filters
      : filtersFromQuery(query);
  const requestKey = JSON.stringify([activeQueryKey, loadRevision]);
  const [requestState, setRequestState] = useState<ListingRequestState>(() => ({
    key: requestKey,
    status: "loading",
  }));
  const visibleRequestState: ListingRequestState =
    requestState.key === requestKey
      ? requestState
      : { key: requestKey, status: "loading" };
  const loading = visibleRequestState.status === "loading";
  const loadError =
    visibleRequestState.status === "error" ? visibleRequestState.error : "";
  const listings =
    visibleRequestState.status === "success"
      ? visibleRequestState.listings
      : [];
  const total =
    visibleRequestState.status === "success" ? visibleRequestState.total : 0;

  useEffect(() => {
    const onPopState = () => {
      const result = queryResultFromLocation();
      if (!result.success) {
        writeQueryToLocation(defaultQuery, true);
        setQuery(defaultQuery);
        setFilterDraft(null);
        setFilterError("");
        return;
      }
      setQuery((current) =>
        sameQuery(current, result.data) ? current : result.data,
      );
      setFilterDraft(null);
      setFilterError("");
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    if (!queryResultFromLocation().success) {
      writeQueryToLocation(defaultQuery, true);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void fetchPublicServiceListings(query, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) {
          setRequestState({
            key: requestKey,
            status: "success",
            listings: result.listings,
            total: result.pagination.total,
          });
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setRequestState({
            key: requestKey,
            status: "error",
            error: errorMessage(error),
          });
        }
      });
    return () => controller.abort();
  }, [query, requestKey]);

  function applyQuery(nextQuery: PublicServiceListingQuery): void {
    writeQueryToLocation(nextQuery);
    setQuery(nextQuery);
    setFilterDraft(null);
    setFilterError("");
  }

  function updateFilters(changes: Partial<SearchFilters>): void {
    setFilterDraft({
      queryKey: activeQueryKey,
      filters: { ...filters, ...changes },
    });
  }

  function submitFilters(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const candidate = {
      page: 1,
      pageSize,
      ...(filters.categorySlug ? { categorySlug: filters.categorySlug } : {}),
      ...(filters.city.trim() ? { city: filters.city.trim() } : {}),
      ...(filters.region.trim() ? { region: filters.region.trim() } : {}),
      ...(filters.pricingMethod
        ? { pricingMethod: filters.pricingMethod }
        : {}),
    };
    const result = publicServiceListingQuerySchema.safeParse(candidate);
    if (!result.success) {
      setFilterError(
        "City and region must contain 2 to 120 characters. Check the filters and try again.",
      );
      return;
    }
    setFilterError("");
    applyQuery(result.data);
  }

  function resetFilters(): void {
    setFilterDraft(null);
    setFilterError("");
    applyQuery(defaultQuery);
  }

  function goToPage(page: number): void {
    applyQuery({ ...query, page });
  }

  const totalPages = Math.max(1, Math.ceil(total / query.pageSize));

  return (
    <section
      className="public-discovery"
      aria-labelledby="service-discovery-title"
      aria-busy={loading}
    >
      <form className="discovery-filters" onSubmit={submitFilters}>
        <div className="discovery-filter-heading">
          <div>
            <p className="eyebrow">Find a service</p>
            <h2>Refine the listings</h2>
          </div>
          <button
            className="button button-secondary"
            onClick={resetFilters}
            type="button"
          >
            Reset filters
          </button>
        </div>
        <div className="discovery-filter-grid">
          <label>
            Category
            <select
              onChange={(event) =>
                updateFilters({ categorySlug: event.currentTarget.value })
              }
              value={filters.categorySlug}
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
              autoComplete="address-level2"
              maxLength={120}
              onChange={(event) =>
                updateFilters({ city: event.currentTarget.value })
              }
              value={filters.city}
            />
          </label>
          <label>
            Region
            <input
              autoComplete="address-level1"
              maxLength={120}
              onChange={(event) =>
                updateFilters({ region: event.currentTarget.value })
              }
              value={filters.region}
            />
          </label>
          <label>
            Pricing
            <select
              onChange={(event) =>
                updateFilters({ pricingMethod: event.currentTarget.value })
              }
              value={filters.pricingMethod}
            >
              <option value="">All pricing</option>
              <option value="fixed">Fixed price</option>
              <option value="starting_at">Starting at</option>
              <option value="quote_only">Request a quote</option>
            </select>
          </label>
        </div>
        {filterError && (
          <p className="form-error" role="alert">
            {filterError}
          </p>
        )}
        <button className="button" type="submit">
          Apply filters
        </button>
      </form>

      <div className="discovery-results-heading">
        <div>
          <p className="eyebrow">Service listings</p>
          <h2 id="service-discovery-title">Explore event services</h2>
        </div>
        {!loading && !loadError && <p>{total} listings</p>}
      </div>

      {loading && (
        <p className="muted" role="status" aria-live="polite">
          Loading service listings…
        </p>
      )}
      {!loading && loadError && (
        <div className="service-empty-state" role="alert">
          <h3>Listings could not be loaded</h3>
          <p>{loadError}</p>
          <button
            className="button button-secondary"
            onClick={() => setLoadRevision((revision) => revision + 1)}
            type="button"
          >
            Retry
          </button>
        </div>
      )}
      {!loading && !loadError && total === 0 && (
        <div className="service-empty-state">
          <h3>No service listings match these filters</h3>
          <p>Try a different category or location, or reset the filters.</p>
          <button
            className="button button-secondary"
            onClick={resetFilters}
            type="button"
          >
            Reset filters
          </button>
        </div>
      )}
      {!loading && !loadError && total > 0 && listings.length === 0 && (
        <div className="service-empty-state">
          <h3>There are no listings on this page</h3>
          <button
            className="button button-secondary"
            onClick={() => goToPage(1)}
            type="button"
          >
            Go to the first page
          </button>
        </div>
      )}
      {!loading && !loadError && listings.length > 0 && (
        <>
          <ul className="public-service-list" aria-label="Available services">
            {listings.map((listing) => (
              <li className="public-service-card" key={listing.id}>
                <p className="eyebrow">{categoryName(listing)}</p>
                <h3>
                  <a
                    href={`/services/${encodeURIComponent(listing.id)}${window.location.search}`}
                  >
                    {listing.title}
                  </a>
                </h3>
                <p className="public-service-location">
                  {listing.city}
                  {listing.region ? `, ${listing.region}` : ""}
                </p>
                <p className="public-service-excerpt">
                  {descriptionExcerpt(listing.description)}
                </p>
                <p className="public-service-provider">
                  Service provider: {listing.provider.displayName}
                </p>
                <p className="public-service-price">{priceText(listing)}</p>
                <a
                  className="text-link"
                  href={`/services/${encodeURIComponent(listing.id)}${window.location.search}`}
                >
                  View service details
                </a>
              </li>
            ))}
          </ul>
          {totalPages > 1 && (
            <nav
              className="pagination-controls"
              aria-label="Service listing pages"
            >
              <button
                className="button button-secondary"
                disabled={query.page <= 1 || loading}
                onClick={() => goToPage(query.page - 1)}
                type="button"
              >
                Previous
              </button>
              <span>
                Page {query.page} of {totalPages}
              </span>
              <button
                className="button button-secondary"
                disabled={query.page >= totalPages || loading}
                onClick={() => goToPage(query.page + 1)}
                type="button"
              >
                Next
              </button>
            </nav>
          )}
        </>
      )}
    </section>
  );
}
