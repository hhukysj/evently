import { useEffect, useState, type FormEvent } from "react";
import type { CurrentUser } from "./auth-api.js";
import {
  providerGet,
  providerMutation,
  type AdminProviderApplication,
  type ProfessionalProfile,
  type ProviderApplication,
  type ProviderType,
} from "./provider-api.js";

const providerTypeLabels: Record<ProviderType, string> = {
  event_organizer: "Event organizer",
  event_manager: "Event manager",
  artist_performer: "Artist / performer",
  vendor_service_provider: "Vendor / service provider",
};

type ApplicationForm = {
  displayName: string;
  description: string;
  city: string;
  region: string;
  country: string;
};

const emptyApplicationForm: ApplicationForm = {
  displayName: "",
  description: "",
  city: "",
  region: "",
  country: "India",
};

export function ProviderApplicationScreen({
  user,
}: {
  user: CurrentUser | null;
}) {
  const [application, setApplication] = useState<ProviderApplication | null>(
    null,
  );
  const [form, setForm] = useState(emptyApplicationForm);
  const [selectedTypes, setSelectedTypes] = useState<ProviderType[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!user || user.role !== "customer") {
      return;
    }
    let active = true;
    void providerGet<{ application: ProviderApplication | null }>(
      "/api/v1/provider-applications/me",
    )
      .then(({ application: current }) => {
        if (active) {
          setApplication(current);
          if (current?.status === "rejected") {
            setForm({
              displayName: current.displayName,
              description: current.description,
              city: current.city,
              region: current.region ?? "",
              country: current.country,
            });
            setSelectedTypes(current.providerTypes);
          }
        }
      })
      .catch((reason: unknown) => {
        if (active) {
          setLoadFailed(true);
          setError(errorMessage(reason));
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
  }, [refreshVersion, user]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    if (selectedTypes.length === 0) {
      setError("Choose at least one provider type.");
      return;
    }
    setSubmitting(true);
    try {
      await providerMutation("POST", "/api/v1/provider-applications", {
        ...form,
        providerTypes: selectedTypes,
      });
      const result = await providerGet<{
        application: ProviderApplication | null;
      }>("/api/v1/provider-applications/me");
      setApplication(result.application);
      setMessage("Your application was submitted for admin review.");
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setSubmitting(false);
    }
  }

  function toggleType(type: ProviderType) {
    setSelectedTypes((current) =>
      current.includes(type)
        ? current.filter((value) => value !== type)
        : [...current, type],
    );
  }

  if (!user) {
    return (
      <section className="auth-card marketplace-card">
        <h2>Apply to offer event services</h2>
        <p className="muted">
          Sign in with a verified customer account to apply.
        </p>
        <a className="button" href="/login">
          Sign in
        </a>
      </section>
    );
  }
  if (user.role === "professional") {
    return (
      <section className="auth-card marketplace-card">
        <h2>Your provider application was approved</h2>
        <p className="muted">
          Your professional profile is a private draft until a later publishing
          flow is available.
        </p>
        <a className="button" href="/professional/profile">
          Manage your profile
        </a>
      </section>
    );
  }
  if (user.role !== "customer") {
    return (
      <section className="auth-card marketplace-card">
        <h2>Provider applications</h2>
        <p className="muted">
          Admin accounts cannot submit provider applications.
        </p>
      </section>
    );
  }

  if (loading) {
    return (
      <section className="auth-card marketplace-card" aria-busy="true">
        <h2>Provider application</h2>
        <p className="muted" role="status">
          Loading your application status…
        </p>
      </section>
    );
  }
  if (loadFailed && application === null) {
    return (
      <section className="auth-card marketplace-card">
        <h2>Provider application</h2>
        <p className="form-error" role="alert">
          {error}
        </p>
        <button
          className="button button-secondary"
          onClick={() => {
            setLoadFailed(false);
            setLoading(true);
            setRefreshVersion((revision) => revision + 1);
          }}
          type="button"
        >
          Retry
        </button>
      </section>
    );
  }
  if (application?.status === "pending") {
    return (
      <section className="auth-card marketplace-card">
        <h2>Application under review</h2>
        <p className="form-success" role="status">
          Your application is pending admin review. You can return here to check
          its status.
        </p>
        <p className="muted">
          Submitted as {application.displayName} for{" "}
          {application.providerTypes
            .map((type) => providerTypeLabels[type])
            .join(", ")}
          .
        </p>
      </section>
    );
  }
  if (application?.status === "approved") {
    return (
      <section className="auth-card marketplace-card">
        <h2>Application approved</h2>
        <p className="form-success" role="status">
          You can now manage your professional profile.
        </p>
        <a className="button" href="/professional/profile">
          Manage your profile
        </a>
      </section>
    );
  }

  return (
    <section className="auth-card marketplace-card">
      <h2>
        {application?.status === "rejected"
          ? "Resubmit your provider application"
          : "Apply to offer event services"}
      </h2>
      {application?.status === "rejected" && (
        <p className="muted">
          This application was not approved. You may update the details and
          submit a new application. Internal review notes are not shown here.
        </p>
      )}
      <p className="muted">
        An admin reviews applications before a professional account is created.
        Your profile will remain a draft and will not be publicly discoverable.
      </p>
      <form
        aria-busy={submitting}
        className="marketplace-form"
        onSubmit={(event) => void submit(event)}
      >
        <label htmlFor="application-display-name">
          Business or display name
        </label>
        <input
          autoComplete="organization"
          id="application-display-name"
          maxLength={120}
          minLength={2}
          onChange={(event) =>
            setForm({ ...form, displayName: event.currentTarget.value })
          }
          required
          value={form.displayName}
        />

        <fieldset className="provider-type-fieldset">
          <legend>Provider type (choose one or more)</legend>
          {Object.entries(providerTypeLabels).map(([value, label]) => {
            const type = value as ProviderType;
            return (
              <label className="provider-type-option" key={type}>
                <input
                  checked={selectedTypes.includes(type)}
                  onChange={() => toggleType(type)}
                  type="checkbox"
                />
                <span>{label}</span>
              </label>
            );
          })}
        </fieldset>

        <label htmlFor="application-description">
          Briefly describe your services
        </label>
        <textarea
          id="application-description"
          maxLength={1200}
          minLength={20}
          onChange={(event) =>
            setForm({ ...form, description: event.currentTarget.value })
          }
          required
          rows={5}
          value={form.description}
        />

        <label htmlFor="application-city">City</label>
        <input
          autoComplete="address-level2"
          id="application-city"
          maxLength={120}
          minLength={2}
          onChange={(event) =>
            setForm({ ...form, city: event.currentTarget.value })
          }
          required
          value={form.city}
        />
        <label htmlFor="application-region">Region or state</label>
        <input
          autoComplete="address-level1"
          id="application-region"
          maxLength={120}
          onChange={(event) =>
            setForm({ ...form, region: event.currentTarget.value })
          }
          value={form.region}
        />
        <label htmlFor="application-country">Country</label>
        <input
          autoComplete="country-name"
          id="application-country"
          maxLength={80}
          minLength={2}
          onChange={(event) =>
            setForm({ ...form, country: event.currentTarget.value })
          }
          required
          value={form.country}
        />
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {message && (
          <p className="form-success" role="status">
            {message}
          </p>
        )}
        <button className="button" disabled={submitting} type="submit">
          {submitting
            ? "Submitting application…"
            : application?.status === "rejected"
              ? "Resubmit application"
              : "Submit application"}
        </button>
      </form>
    </section>
  );
}

export function AdminProviderApplicationsScreen({
  user,
}: {
  user: CurrentUser | null;
}) {
  const [applications, setApplications] = useState<AdminProviderApplication[]>(
    [],
  );
  const [selected, setSelected] = useState<AdminProviderApplication | null>(
    null,
  );
  const [statusFilter, setStatusFilter] = useState("pending");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loadedRequest, setLoadedRequest] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [refreshVersion, setRefreshVersion] = useState(0);
  const pageSize = 20;
  const userId = user?.id;
  const isAdmin = user?.role === "admin";
  const requestKey = `${userId ?? ""}:${statusFilter}:${page}:${refreshVersion}`;
  const loading = loadedRequest !== requestKey;

  useEffect(() => {
    if (!userId || !isAdmin) {
      return;
    }
    let active = true;
    const search = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
    });
    if (statusFilter !== "all") {
      search.set("status", statusFilter);
    }
    void providerGet<{
      applications: AdminProviderApplication[];
      pagination: { total: number };
    }>(`/api/v1/admin/provider-applications?${search}`)
      .then((result) => {
        if (active) {
          setError("");
          setApplications(result.applications);
          setTotal(result.pagination.total);
          setSelected((current) =>
            current &&
            !result.applications.some((item) => item.id === current.id)
              ? null
              : current,
          );
        }
      })
      .catch((reason: unknown) => {
        if (active) {
          setError(errorMessage(reason));
        }
      })
      .finally(() => {
        if (active) {
          setLoadedRequest(requestKey);
        }
      });
    return () => {
      active = false;
    };
  }, [
    isAdmin,
    page,
    pageSize,
    refreshVersion,
    requestKey,
    statusFilter,
    userId,
  ]);

  async function refreshSelected(id: string) {
    const result = await providerGet<{ application: AdminProviderApplication }>(
      `/api/v1/admin/provider-applications/${id}`,
    );
    setSelected(result.application);
  }

  async function review(action: "approve" | "reject") {
    if (!selected || reviewing) {
      return;
    }
    setReviewing(true);
    setError("");
    setMessage("");
    try {
      await providerMutation(
        "POST",
        `/api/v1/admin/provider-applications/${selected.id}/${action}`,
        action === "reject" ? { reason } : {},
      );
      setMessage(
        action === "approve"
          ? "Application approved and professional profile created."
          : "Application rejected.",
      );
      setReason("");
      await refreshSelected(selected.id);
      setPage(1);
      setRefreshVersion((revision) => revision + 1);
    } catch (reasonValue) {
      setError(errorMessage(reasonValue));
    } finally {
      setReviewing(false);
    }
  }

  if (!user) {
    return (
      <section className="auth-card marketplace-card">
        <h2>Admin review</h2>
        <p className="muted">Sign in with an administrator account.</p>
        <a className="button" href="/login">
          Sign in
        </a>
      </section>
    );
  }
  if (user.role !== "admin") {
    return (
      <section className="auth-card marketplace-card">
        <h2>Admin access required</h2>
        <p className="form-error" role="alert">
          Your account is not authorized to review provider applications.
        </p>
      </section>
    );
  }

  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  return (
    <section className="auth-card marketplace-card marketplace-card-wide">
      <h2>Provider applications</h2>
      <p className="muted">
        Review submitted provider details. Approval creates a professional
        account and a private draft profile.
      </p>
      <div className="admin-filter">
        <label htmlFor="application-status-filter">Status</label>
        <select
          id="application-status-filter"
          onChange={(event) => {
            setPage(1);
            setSelected(null);
            setStatusFilter(event.currentTarget.value);
          }}
          value={statusFilter}
        >
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="all">All</option>
        </select>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {error && (
        <button
          className="button button-secondary button-small"
          onClick={() => {
            setError("");
            setRefreshVersion((revision) => revision + 1);
          }}
          type="button"
        >
          Retry loading applications
        </button>
      )}
      {message && (
        <p className="form-success" role="status">
          {message}
        </p>
      )}
      <div className="admin-review-layout" aria-busy={loading || reviewing}>
        <div>
          <h3>Applications ({total})</h3>
          {loading && (
            <p className="muted" role="status">
              Loading applications…
            </p>
          )}
          {!loading && applications.length === 0 && (
            <p className="muted">No applications match this filter.</p>
          )}
          <ul className="application-list">
            {applications.map((application) => (
              <li key={application.id}>
                <button
                  aria-current={selected?.id === application.id}
                  className="application-list-item"
                  onClick={() => {
                    setError("");
                    setMessage("");
                    void refreshSelected(application.id).catch(
                      (reason: unknown) => setError(errorMessage(reason)),
                    );
                  }}
                  type="button"
                >
                  <strong>{application.displayName}</strong>
                  <span>{application.applicant.email}</span>
                  <span>
                    {application.city}, {application.country} ·{" "}
                    {application.status}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <div className="pagination-controls">
            <button
              className="button button-secondary button-small"
              disabled={page <= 1 || loading}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              type="button"
            >
              Previous
            </button>
            <span aria-live="polite">
              Page {page} of {pageCount}
            </span>
            <button
              className="button button-secondary button-small"
              disabled={page >= pageCount || loading}
              onClick={() =>
                setPage((current) => Math.min(pageCount, current + 1))
              }
              type="button"
            >
              Next
            </button>
          </div>
        </div>
        <div className="application-detail">
          {!selected && (
            <p className="muted">
              Select an application to review its details.
            </p>
          )}
          {selected && (
            <>
              <h3>{selected.displayName}</h3>
              <dl>
                <dt>Applicant</dt>
                <dd>{selected.applicant.email}</dd>
                <dt>Provider types</dt>
                <dd>
                  {selected.providerTypes
                    .map((type) => providerTypeLabels[type])
                    .join(", ")}
                </dd>
                <dt>Service description</dt>
                <dd>{selected.description}</dd>
                <dt>Location</dt>
                <dd>
                  {[selected.city, selected.region, selected.country]
                    .filter(Boolean)
                    .join(", ")}
                </dd>
                <dt>Status</dt>
                <dd>{selected.status}</dd>
                {selected.rejectionReason && (
                  <>
                    <dt>Internal rejection reason</dt>
                    <dd>{selected.rejectionReason}</dd>
                  </>
                )}
              </dl>
              {selected.status === "pending" && (
                <div className="review-actions">
                  <label htmlFor="application-rejection-reason">
                    Rejection reason (required to reject)
                  </label>
                  <textarea
                    id="application-rejection-reason"
                    maxLength={500}
                    minLength={8}
                    onChange={(event) => setReason(event.currentTarget.value)}
                    rows={3}
                    value={reason}
                  />
                  <button
                    className="button"
                    disabled={reviewing}
                    onClick={() => void review("approve")}
                    type="button"
                  >
                    {reviewing ? "Saving review…" : "Approve application"}
                  </button>
                  <button
                    className="button button-secondary"
                    disabled={
                      reviewing ||
                      reason.trim().length < 8 ||
                      reason.length > 500
                    }
                    onClick={() => void review("reject")}
                    type="button"
                  >
                    {reviewing ? "Saving review…" : "Reject application"}
                  </button>
                </div>
              )}
              {selected.reviewerUserId && (
                <p className="muted">
                  Reviewed{" "}
                  {selected.reviewedAt
                    ? new Date(selected.reviewedAt).toLocaleString()
                    : ""}
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}

type ProfileForm = {
  displayName: string;
  headline: string;
  bio: string;
  city: string;
  region: string;
  country: string;
};

export function ProfessionalProfileScreen({
  user,
}: {
  user: CurrentUser | null;
}) {
  const [profile, setProfile] = useState<ProfessionalProfile | null>(null);
  const [form, setForm] = useState<ProfileForm>({
    displayName: "",
    headline: "",
    bio: "",
    city: "",
    region: "",
    country: "",
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!user || user.role !== "professional") {
      return;
    }
    let active = true;
    void providerGet<{ profile: ProfessionalProfile }>(
      "/api/v1/professional/me",
    )
      .then(({ profile: current }) => {
        if (active) {
          setProfile(current);
          setForm({
            displayName: current.displayName,
            headline: current.headline ?? "",
            bio: current.bio ?? "",
            city: current.city,
            region: current.region ?? "",
            country: current.country,
          });
        }
      })
      .catch((reason: unknown) => {
        if (active) {
          setError(errorMessage(reason));
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
  }, [user]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const result = await providerMutation<{ profile: ProfessionalProfile }>(
        "PATCH",
        "/api/v1/professional/me/profile",
        form,
      );
      setProfile(result.profile);
      setMessage("Profile changes saved.");
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setSaving(false);
    }
  }

  if (!user) {
    return (
      <section className="auth-card marketplace-card">
        <h2>Professional profile</h2>
        <p className="muted">Sign in to manage your profile.</p>
        <a className="button" href="/login">
          Sign in
        </a>
      </section>
    );
  }
  if (user.role !== "professional") {
    return (
      <section className="auth-card marketplace-card">
        <h2>Professional access required</h2>
        <p className="form-error" role="alert">
          Only approved professional accounts can manage a provider profile.
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
      <section className="auth-card marketplace-card" aria-busy="true">
        <h2>Your professional profile</h2>
        <p className="muted" role="status">
          Loading your profile…
        </p>
      </section>
    );
  }
  if (!profile) {
    return (
      <section className="auth-card marketplace-card">
        <h2>Your professional profile</h2>
        <p className="form-error" role="alert">
          {error ||
            "No profile is available for this account. Contact an administrator."}
        </p>
        <button
          className="button button-secondary"
          onClick={() => window.location.reload()}
          type="button"
        >
          Retry
        </button>
      </section>
    );
  }

  return (
    <section className="auth-card marketplace-card">
      <h2>Your professional profile</h2>
      <p className="muted">
        This profile is a private draft. Public publishing is not available in
        this milestone.
      </p>
      <p className="profile-state">
        Draft ·{" "}
        {profile.providerTypes
          .map((type) => providerTypeLabels[type])
          .join(", ")}
      </p>
      <p className="field-hint">
        Profile URL slug: <code>{profile.slug}</code> (generated and not
        editable)
      </p>
      <form
        aria-busy={saving}
        className="marketplace-form"
        onSubmit={(event) => void save(event)}
      >
        <label htmlFor="profile-display-name">Display name</label>
        <input
          id="profile-display-name"
          maxLength={120}
          minLength={2}
          onChange={(event) =>
            setForm({ ...form, displayName: event.currentTarget.value })
          }
          required
          value={form.displayName}
        />
        <label htmlFor="profile-headline">Headline</label>
        <input
          id="profile-headline"
          maxLength={160}
          onChange={(event) =>
            setForm({ ...form, headline: event.currentTarget.value })
          }
          value={form.headline}
        />
        <label htmlFor="profile-bio">Bio</label>
        <textarea
          id="profile-bio"
          maxLength={1200}
          onChange={(event) =>
            setForm({ ...form, bio: event.currentTarget.value })
          }
          rows={5}
          value={form.bio}
        />
        <label htmlFor="profile-city">City</label>
        <input
          id="profile-city"
          maxLength={120}
          minLength={2}
          onChange={(event) =>
            setForm({ ...form, city: event.currentTarget.value })
          }
          required
          value={form.city}
        />
        <label htmlFor="profile-region">Region or state</label>
        <input
          id="profile-region"
          maxLength={120}
          onChange={(event) =>
            setForm({ ...form, region: event.currentTarget.value })
          }
          value={form.region}
        />
        <label htmlFor="profile-country">Country</label>
        <input
          id="profile-country"
          maxLength={80}
          minLength={2}
          onChange={(event) =>
            setForm({ ...form, country: event.currentTarget.value })
          }
          required
          value={form.country}
        />
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {message && (
          <p className="form-success" role="status">
            {message}
          </p>
        )}
        <button className="button" disabled={saving} type="submit">
          {saving ? "Saving profile…" : "Save profile"}
        </button>
      </form>
    </section>
  );
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error
    ? reason.message
    : "The request could not be completed. Please try again.";
}
