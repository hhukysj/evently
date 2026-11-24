import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import {
  bookingRequestCreationInputSchema,
  type BookingRequestCreationInput,
  type BookingRequestDto,
  type BookingMessageDto,
} from "@evently/shared";
import type { CurrentUser } from "./auth-api.js";
import {
  BookingApiError,
  cancelBookingRequest,
  createBookingRequest,
  decideBookingRequest,
  fetchBookingMessages,
  fetchCustomerBookingRequests,
  fetchProfessionalBookingRequests,
  sendBookingMessage,
} from "./booking-requests-api.js";

type BriefFields = {
  eventType: string;
  eventDate: string;
  eventTimezone: string;
  city: string;
  region: string;
  venueOrArea: string;
  guestCount: string;
  budgetMinimum: string;
  budgetMaximum: string;
  notes: string;
};

type BriefField = keyof BriefFields;

function newIdempotencyKey(): string {
  return globalThis.crypto?.randomUUID?.() ?? "";
}

function storedIdempotencyKey(listingId: string): string {
  const storageKey = `evently.booking-request.${listingId}`;
  try {
    const existing = window.sessionStorage.getItem(storageKey);
    if (
      existing &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        existing,
      )
    ) {
      return existing;
    }
    const generated = newIdempotencyKey();
    if (generated) window.sessionStorage.setItem(storageKey, generated);
    return generated;
  } catch {
    return newIdempotencyKey();
  }
}

function replaceIdempotencyKey(listingId: string): string {
  const generated = newIdempotencyKey();
  if (!generated) return "";
  try {
    window.sessionStorage.setItem(
      `evently.booking-request.${listingId}`,
      generated,
    );
  } catch {
    // The in-memory key still protects retries while this form remains mounted.
  }
  return generated;
}

function initialBriefFields(): BriefFields {
  return {
    eventType: "",
    eventDate: "",
    eventTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    city: "",
    region: "",
    venueOrArea: "",
    guestCount: "",
    budgetMinimum: "",
    budgetMaximum: "",
    notes: "",
  };
}

function toPaise(value: string): number {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.round(amount * 100) : Number.NaN;
}

function fieldForIssue(path: PropertyKey[]): BriefField | undefined {
  const field = path.join(".");
  const names: Record<string, BriefField> = {
    eventType: "eventType",
    eventDate: "eventDate",
    eventTimezone: "eventTimezone",
    "eventLocation.city": "city",
    "eventLocation.region": "region",
    "eventLocation.venueOrArea": "venueOrArea",
    guestCount: "guestCount",
    budgetMinAmountPaise: "budgetMinimum",
    budgetMaxAmountPaise: "budgetMaximum",
    additionalNotes: "notes",
  };
  return names[field];
}

function errorText(error: unknown): string {
  if (!(error instanceof BookingApiError)) {
    return "The request could not be completed. Please try again.";
  }
  if (error.code === "EMAIL_VERIFICATION_REQUIRED") {
    return "Verify your email before requesting a service. You can request a verification link from your account.";
  }
  if (error.code === "UNAUTHENTICATED") {
    return "Your session has expired. Sign in again to continue.";
  }
  if (error.code === "SERVICE_LISTING_NOT_FOUND") {
    return "This service is no longer available. Return to discovery to choose another service.";
  }
  if (error.code === "IDEMPOTENCY_KEY_REUSED") {
    return "This key was used for different details. A new request key is ready; review the brief and submit again.";
  }
  if (error.code === "BOOKING_LIFECYCLE_CONFLICT") {
    return "This request changed before the action completed. The latest status has been refreshed.";
  }
  return error.message;
}

function dateLabel(date: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "long",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00.000Z`));
}

function statusLabel(status: BookingRequestDto["status"]): string {
  switch (status) {
    case "requested":
      return "Awaiting professional response";
    case "accepted":
      return "Accepted by professional";
    case "declined":
      return "Declined by professional";
    case "cancelled":
      return "Cancelled";
  }
}

function moneyLabel(amountPaise: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(amountPaise / 100);
}

function briefBudget(request: BookingRequestDto): string {
  const minimum = request.budgetMinAmountPaise;
  const maximum = request.budgetMaxAmountPaise;
  if (minimum === null && maximum === null) return "Not specified";
  if (minimum !== null && maximum !== null) {
    return `${moneyLabel(minimum)} – ${moneyLabel(maximum)}`;
  }
  return minimum === null
    ? `Up to ${moneyLabel(maximum!)}`
    : `From ${moneyLabel(minimum)}`;
}

export function BookingRequestForm({
  listingId,
  customer,
  onClose,
}: {
  listingId: string;
  customer: CurrentUser | null;
  onClose: () => void;
}) {
  const [fields, setFields] = useState(initialBriefFields);
  const [idempotencyKey, setIdempotencyKey] = useState(() =>
    storedIdempotencyKey(listingId),
  );
  const [fieldErrors, setFieldErrors] = useState<
    Partial<Record<BriefField, string>>
  >({});
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submittedRequest, setSubmittedRequest] =
    useState<BookingRequestDto | null>(null);

  function updateField(field: BriefField, value: string): void {
    setFields((current) => ({ ...current, [field]: value }));
    setError("");
    setFieldErrors((current) => ({ ...current, [field]: undefined }));
  }

  function inputChange(field: BriefField) {
    return (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      updateField(field, event.currentTarget.value);
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError("");
    setFieldErrors({});
    const input: BookingRequestCreationInput = {
      serviceListingId: listingId,
      idempotencyKey,
      eventType: fields.eventType,
      eventDate: fields.eventDate,
      eventTimezone: fields.eventTimezone,
      eventLocation: {
        city: fields.city,
        ...(fields.region.trim() ? { region: fields.region } : {}),
        ...(fields.venueOrArea.trim()
          ? { venueOrArea: fields.venueOrArea }
          : {}),
      },
      guestCount: Number(fields.guestCount),
      ...(fields.budgetMinimum.trim()
        ? { budgetMinAmountPaise: toPaise(fields.budgetMinimum) }
        : {}),
      ...(fields.budgetMaximum.trim()
        ? { budgetMaxAmountPaise: toPaise(fields.budgetMaximum) }
        : {}),
      ...(fields.notes.trim() ? { additionalNotes: fields.notes } : {}),
    };
    const parsed = bookingRequestCreationInputSchema.safeParse(input);
    if (!parsed.success) {
      const nextErrors: Partial<Record<BriefField, string>> = {};
      for (const issue of parsed.error.issues) {
        const field = fieldForIssue(issue.path);
        if (field && !nextErrors[field]) nextErrors[field] = issue.message;
      }
      setFieldErrors(nextErrors);
      setError("Review the highlighted event brief fields.");
      return;
    }
    setSubmitting(true);
    try {
      const created = await createBookingRequest(parsed.data);
      try {
        window.sessionStorage.removeItem(
          `evently.booking-request.${listingId}`,
        );
      } catch {
        // Storage cleanup must not turn a successful request into a visible failure.
      }
      setSubmittedRequest(created);
    } catch (reason) {
      if (
        reason instanceof BookingApiError &&
        reason.code === "IDEMPOTENCY_KEY_REUSED"
      ) {
        setIdempotencyKey(replaceIdempotencyKey(listingId));
      }
      setError(errorText(reason));
    } finally {
      setSubmitting(false);
    }
  }

  if (submittedRequest) {
    return (
      <section className="booking-panel" aria-label="Booking request submitted">
        <h3>Request sent</h3>
        <p role="status">
          Your request is waiting for the professional to respond. It is not a
          confirmed booking yet.
        </p>
        <div className="booking-actions">
          <a className="button" href="/booking-requests">
            View my requests
          </a>
          <button
            className="button button-secondary"
            onClick={onClose}
            type="button"
          >
            Close
          </button>
        </div>
      </section>
    );
  }

  if (!customer) {
    const returnTo = `${window.location.pathname}?requestBooking=1`;
    return (
      <section
        className="booking-panel"
        aria-label="Sign in to request booking"
      >
        <p className="muted">
          Sign in with a verified customer account to request this service.
        </p>
        <a
          className="button"
          href={`/login?returnTo=${encodeURIComponent(returnTo)}`}
        >
          Sign in to continue
        </a>
      </section>
    );
  }

  if (customer.role !== "customer") {
    return (
      <section className="booking-panel" aria-label="Customer account required">
        <p className="muted">
          Booking requests can be submitted from a customer account.
        </p>
      </section>
    );
  }

  if (!window.crypto?.randomUUID) {
    return (
      <section className="booking-panel" role="alert">
        Secure request keys are unavailable in this browser. Open Evently over
        HTTPS and try again.
      </section>
    );
  }

  function fieldError(field: BriefField) {
    return fieldErrors[field] ? (
      <span className="field-error" id={`booking-${field}-error`}>
        {fieldErrors[field]}
      </span>
    ) : null;
  }

  return (
    <section className="booking-panel" aria-label="Request this service">
      <div>
        <h3>Tell the professional about your event</h3>
        <p className="muted">
          Submitting a request does not confirm a booking.
        </p>
      </div>
      <form
        className="marketplace-form booking-form"
        onSubmit={(event) => void submit(event)}
        aria-busy={submitting}
      >
        <label htmlFor="booking-event-type">Event type</label>
        <input
          id="booking-event-type"
          value={fields.eventType}
          onChange={inputChange("eventType")}
          required
          maxLength={120}
          aria-invalid={Boolean(fieldErrors.eventType)}
          aria-describedby={
            fieldErrors.eventType ? "booking-eventType-error" : undefined
          }
        />
        {fieldError("eventType")}

        <label htmlFor="booking-event-date">Event date</label>
        <input
          id="booking-event-date"
          type="date"
          value={fields.eventDate}
          onChange={inputChange("eventDate")}
          required
          aria-invalid={Boolean(fieldErrors.eventDate)}
          aria-describedby={
            fieldErrors.eventDate ? "booking-eventDate-error" : undefined
          }
        />
        {fieldError("eventDate")}

        <label htmlFor="booking-event-timezone">Event timezone (IANA)</label>
        <input
          id="booking-event-timezone"
          value={fields.eventTimezone}
          onChange={inputChange("eventTimezone")}
          required
          maxLength={64}
          placeholder="Asia/Kolkata"
          aria-invalid={Boolean(fieldErrors.eventTimezone)}
          aria-describedby={
            fieldErrors.eventTimezone
              ? "booking-eventTimezone-error"
              : undefined
          }
        />
        {fieldError("eventTimezone")}

        <div className="booking-form-grid">
          <div>
            <label htmlFor="booking-city">Event city</label>
            <input
              id="booking-city"
              value={fields.city}
              onChange={inputChange("city")}
              required
              maxLength={120}
              aria-invalid={Boolean(fieldErrors.city)}
              aria-describedby={
                fieldErrors.city ? "booking-city-error" : undefined
              }
            />
            {fieldError("city")}
          </div>
          <div>
            <label htmlFor="booking-region">Region or state (optional)</label>
            <input
              id="booking-region"
              value={fields.region}
              onChange={inputChange("region")}
              maxLength={120}
              aria-invalid={Boolean(fieldErrors.region)}
              aria-describedby={
                fieldErrors.region ? "booking-region-error" : undefined
              }
            />
            {fieldError("region")}
          </div>
        </div>

        <label htmlFor="booking-venue">Venue or area (optional)</label>
        <input
          id="booking-venue"
          value={fields.venueOrArea}
          onChange={inputChange("venueOrArea")}
          maxLength={200}
          aria-invalid={Boolean(fieldErrors.venueOrArea)}
          aria-describedby={
            fieldErrors.venueOrArea ? "booking-venueOrArea-error" : undefined
          }
        />
        {fieldError("venueOrArea")}

        <label htmlFor="booking-guest-count">Estimated guest count</label>
        <input
          id="booking-guest-count"
          type="number"
          min="1"
          max="100000"
          step="1"
          value={fields.guestCount}
          onChange={inputChange("guestCount")}
          required
          aria-invalid={Boolean(fieldErrors.guestCount)}
          aria-describedby={
            fieldErrors.guestCount ? "booking-guestCount-error" : undefined
          }
        />
        {fieldError("guestCount")}

        <fieldset className="booking-budget">
          <legend>Budget range in INR (optional)</legend>
          <div className="booking-form-grid">
            <div>
              <label htmlFor="booking-budget-min">Minimum</label>
              <input
                id="booking-budget-min"
                type="number"
                min="0"
                step="0.01"
                value={fields.budgetMinimum}
                onChange={inputChange("budgetMinimum")}
                aria-invalid={Boolean(fieldErrors.budgetMinimum)}
                aria-describedby={
                  fieldErrors.budgetMinimum
                    ? "booking-budgetMinimum-error"
                    : undefined
                }
              />
              {fieldError("budgetMinimum")}
            </div>
            <div>
              <label htmlFor="booking-budget-max">Maximum</label>
              <input
                id="booking-budget-max"
                type="number"
                min="0"
                step="0.01"
                value={fields.budgetMaximum}
                onChange={inputChange("budgetMaximum")}
                aria-invalid={Boolean(fieldErrors.budgetMaximum)}
                aria-describedby={
                  fieldErrors.budgetMaximum
                    ? "booking-budgetMaximum-error"
                    : undefined
                }
              />
              {fieldError("budgetMaximum")}
            </div>
          </div>
        </fieldset>

        <label htmlFor="booking-notes">Additional notes (optional)</label>
        <textarea
          id="booking-notes"
          value={fields.notes}
          onChange={inputChange("notes")}
          maxLength={1200}
          rows={4}
          aria-invalid={Boolean(fieldErrors.notes)}
          aria-describedby={
            fieldErrors.notes ? "booking-notes-error" : undefined
          }
        />
        {fieldError("notes")}

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {error.includes("Verify your email") && (
          <a className="text-link" href="/verify-email">
            Request an email verification link
          </a>
        )}
        {error.includes("session has expired") && (
          <a
            className="text-link"
            href={`/login?returnTo=${encodeURIComponent(`${window.location.pathname}?requestBooking=1`)}`}
          >
            Sign in again
          </a>
        )}
        <div className="booking-actions">
          <button className="button" disabled={submitting} type="submit">
            {submitting ? "Sending request…" : "Send booking request"}
          </button>
          <button
            className="button button-secondary"
            disabled={submitting}
            onClick={onClose}
            type="button"
          >
            Cancel
          </button>
        </div>
        <p className="field-hint">
          A retry with unchanged details uses the same secure request key.
        </p>
      </form>
    </section>
  );
}

type RequestListResult = {
  key: string;
  status: "loading" | "error" | "success";
  requests?: BookingRequestDto[];
  total?: number;
  error?: string;
};

function useRequestList(
  role: "customer" | "professional",
  page: number,
  revision: number,
  userId: string | undefined,
  enabled: boolean,
): { state: RequestListResult } {
  const key = `${role}:${userId ?? "anonymous"}:${page}:${revision}:${enabled}`;
  const [result, setResult] = useState<RequestListResult>(() => ({
    key,
    status: "loading",
  }));
  const state =
    result.key === key ? result : { key, status: "loading" as const };
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const load =
      role === "customer"
        ? fetchCustomerBookingRequests
        : fetchProfessionalBookingRequests;
    void load(page, controller.signal)
      .then(({ bookingRequests, total }) => {
        if (!controller.signal.aborted) {
          setResult({
            key,
            status: "success",
            requests: bookingRequests,
            total,
          });
        }
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          setResult({
            key,
            status: "error",
            error:
              reason instanceof Error
                ? reason.message
                : "Requests could not be loaded.",
          });
        }
      });
    return () => controller.abort();
  }, [enabled, key, page, role]);
  return { state };
}

function RequestAccess({
  user,
  role,
  loading,
}: {
  user: CurrentUser | null;
  role: "customer" | "professional";
  loading: boolean;
}) {
  if (loading)
    return (
      <p className="muted" role="status">
        Checking your session…
      </p>
    );
  if (!user) {
    const destination =
      role === "customer"
        ? "/booking-requests"
        : "/professional/booking-requests";
    return (
      <p className="muted">
        Sign in to continue.{" "}
        <a href={`/login?returnTo=${encodeURIComponent(destination)}`}>
          Sign in
        </a>
      </p>
    );
  }
  if (user.role !== role) {
    return (
      <p className="form-error" role="alert">
        This page requires a {role} account.
      </p>
    );
  }
  return null;
}

function BookingRequestCard({ request: item }: { request: BookingRequestDto }) {
  return (
    <article className="booking-request-card">
      <div className="booking-request-heading">
        <div>
          <p className="eyebrow">{item.service.category.name}</p>
          <h3>{item.service.title}</h3>
        </div>
        <p className={`booking-status booking-status-${item.status}`}>
          {statusLabel(item.status)}
        </p>
      </div>
      <p className="public-service-location">
        {item.service.city}
        {item.service.region ? `, ${item.service.region}` : ""}
      </p>
      <dl className="booking-facts">
        <div>
          <dt>Professional</dt>
          <dd>{item.providerDisplayName}</dd>
        </div>
        <div>
          <dt>Event</dt>
          <dd>{item.eventType}</dd>
        </div>
        <div>
          <dt>Date</dt>
          <dd>
            {dateLabel(item.eventDate)} ({item.eventTimezone})
          </dd>
        </div>
        <div>
          <dt>Event location</dt>
          <dd>
            {item.eventLocation.city}
            {item.eventLocation.region ? `, ${item.eventLocation.region}` : ""}
            {item.eventLocation.venueOrArea
              ? ` · ${item.eventLocation.venueOrArea}`
              : ""}
          </dd>
        </div>
        <div>
          <dt>Guests</dt>
          <dd>{item.guestCount.toLocaleString()}</dd>
        </div>
        <div>
          <dt>Budget</dt>
          <dd>{briefBudget(item)}</dd>
        </div>
      </dl>
      {item.additionalNotes && (
        <p className="booking-notes">{item.additionalNotes}</p>
      )}
      {item.cancellation && (
        <p className="muted">
          Cancelled by {item.cancellation.cancelledByRole} on{" "}
          {new Date(item.cancellation.cancelledAt).toLocaleString()}.
          {item.cancellation.reason
            ? ` Reason: ${item.cancellation.reason}`
            : ""}
        </p>
      )}
      {item.statusHistory.length > 1 && (
        <p className="muted">
          {item.status === "cancelled"
            ? "Cancellation recorded "
            : "Professional response recorded "}
          {new Date(
            item.statusHistory[item.statusHistory.length - 1]!.createdAt,
          ).toLocaleString()}
          .
        </p>
      )}
    </article>
  );
}

function BookingConversation({
  requestId,
  currentRole,
}: {
  requestId: string;
  currentRole: "customer" | "professional";
}) {
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [pages, setPages] = useState<
    Record<string, { messages: BookingMessageDto[]; total: number }>
  >({});
  const [loadResult, setLoadResult] = useState<{
    key: string;
    status: "loading" | "error" | "success";
    error?: string;
    total?: number;
  }>({ key: "", status: "loading" });
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");
  const [sendMessageStatus, setSendMessageStatus] = useState("");
  const sendingRef = useRef(false);
  const pageKey = `${requestId}:${page}`;
  const loadKey = `${pageKey}:${revision}`;

  useEffect(() => {
    const controller = new AbortController();
    void fetchBookingMessages(requestId, page, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) {
          setPages((current) => ({ ...current, [pageKey]: result }));
          setLoadResult({
            key: loadKey,
            status: "success",
            total: result.total,
          });
        }
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          setLoadResult({
            key: loadKey,
            status: "error",
            error:
              reason instanceof Error
                ? reason.message
                : "Messages could not be loaded.",
          });
        }
      });
    return () => controller.abort();
  }, [loadKey, page, pageKey, requestId]);

  const loadedPages = Object.entries(pages)
    .filter(([key]) => key.startsWith(`${requestId}:`))
    .sort(([left], [right]) => {
      const leftPage = Number(left.slice(requestId.length + 1));
      const rightPage = Number(right.slice(requestId.length + 1));
      return rightPage - leftPage;
    });
  const visibleMessages = loadedPages.flatMap(([, result]) => result.messages);
  const total =
    loadResult.key === loadKey
      ? (loadResult.total ?? pages[pageKey]?.total ?? 0)
      : (pages[pageKey]?.total ?? pages[`${requestId}:1`]?.total ?? 0);
  const pageCount = Math.max(1, Math.ceil(total / 25));

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sendingRef.current || !body.trim()) return;
    sendingRef.current = true;
    setSending(true);
    setSendError("");
    setSendMessageStatus("");
    try {
      const created = await sendBookingMessage(requestId, { body });
      setPages((current) => {
        const firstPage = current[`${requestId}:1`];
        const existing = firstPage?.messages ?? [];
        return {
          ...current,
          [`${requestId}:1`]: {
            messages: [...existing, created].sort(
              (left, right) =>
                Date.parse(left.createdAt) - Date.parse(right.createdAt) ||
                left.id.localeCompare(right.id),
            ),
            total: (firstPage?.total ?? total) + 1,
          },
        };
      });
      setBody("");
      setSendMessageStatus("Message sent.");
      if (page !== 1) setPage(1);
    } catch (reason) {
      setSendError(errorText(reason));
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }

  return (
    <section className="booking-conversation" aria-label="Booking conversation">
      <div className="booking-list-heading">
        <h4>Messages</h4>
        <button
          className="button button-secondary button-small"
          disabled={
            loadResult.key === loadKey && loadResult.status === "loading"
          }
          onClick={() => setRevision((value) => value + 1)}
          type="button"
        >
          Refresh messages
        </button>
      </div>
      {loadResult.key !== loadKey || loadResult.status === "loading" ? (
        <p className="muted" role="status">
          Loading messages…
        </p>
      ) : loadResult.status === "error" ? (
        <>
          <p className="form-error" role="alert">
            {loadResult.error}
          </p>
          <button
            className="button button-secondary"
            onClick={() => setRevision((value) => value + 1)}
            type="button"
          >
            Retry messages
          </button>
        </>
      ) : null}
      {loadResult.status !== "error" &&
        visibleMessages.length === 0 &&
        loadResult.key === loadKey &&
        loadResult.status === "success" && (
          <p className="muted">
            No messages yet. Send a message to continue the conversation.
          </p>
        )}
      {visibleMessages.length > 0 && (
        <ol
          className="booking-message-list"
          aria-label="Conversation messages"
          aria-live="polite"
        >
          {visibleMessages.map((message) => (
            <li className="booking-message" key={message.id}>
              <div className="booking-message-heading">
                <strong>
                  {message.senderRole === currentRole
                    ? "You"
                    : message.senderRole === "customer"
                      ? "Customer"
                      : "Professional"}
                </strong>
                <time dateTime={message.createdAt}>
                  {new Date(message.createdAt).toLocaleString()}
                </time>
              </div>
              <p>{message.body}</p>
            </li>
          ))}
        </ol>
      )}
      {page < pageCount && (
        <button
          className="button button-secondary"
          disabled={loadResult.status === "loading"}
          onClick={() => setPage((value) => value + 1)}
          type="button"
        >
          Load earlier messages
        </button>
      )}
      <form
        className="booking-message-form"
        onSubmit={(event) => void send(event)}
      >
        <label htmlFor={`booking-message-${requestId}`}>Write a message</label>
        <textarea
          id={`booking-message-${requestId}`}
          maxLength={2000}
          onChange={(event) => setBody(event.currentTarget.value)}
          required
          rows={3}
          value={body}
        />
        {sendError && (
          <p className="form-error" role="alert">
            {sendError}
          </p>
        )}
        {sendMessageStatus && (
          <p className="form-success" role="status">
            {sendMessageStatus}
          </p>
        )}
        <button
          className="button"
          disabled={sending || !body.trim()}
          type="submit"
        >
          {sending ? "Sending…" : "Send message"}
        </button>
      </form>
    </section>
  );
}

function BookingRequestList({
  user,
  userLoading,
  role,
}: {
  user: CurrentUser | null;
  userLoading: boolean;
  role: "customer" | "professional";
}) {
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [pendingId, setPendingId] = useState("");
  const [cancelConfirmationId, setCancelConfirmationId] = useState("");
  const [actionError, setActionError] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const authorized = !userLoading && user?.role === role;
  const { state } = useRequestList(role, page, revision, user?.id, authorized);
  const canAccess = !userLoading && user?.role === role;

  async function decide(requestId: string, decision: "accept" | "decline") {
    setPendingId(requestId);
    setActionError("");
    setActionMessage("");
    try {
      await decideBookingRequest(requestId, decision);
      setActionMessage(
        decision === "accept"
          ? "Booking request accepted."
          : "Booking request declined.",
      );
      setRevision((value) => value + 1);
    } catch (reason) {
      setActionError(errorText(reason));
    } finally {
      setPendingId("");
    }
  }

  async function cancel(requestId: string) {
    setPendingId(requestId);
    setActionError("");
    setActionMessage("");
    try {
      await cancelBookingRequest(requestId);
      setCancelConfirmationId("");
      setActionMessage(
        "Booking cancelled. The other participant has been notified.",
      );
      setRevision((value) => value + 1);
    } catch (reason) {
      setActionError(errorText(reason));
      if (reason instanceof BookingApiError && reason.status === 409) {
        setCancelConfirmationId("");
        setRevision((value) => value + 1);
      }
    } finally {
      setPendingId("");
    }
  }

  if (!canAccess) {
    return (
      <section className="auth-card marketplace-card">
        <h2>
          {role === "customer"
            ? "My booking requests"
            : "Incoming booking requests"}
        </h2>
        <RequestAccess user={user} role={role} loading={userLoading} />
      </section>
    );
  }
  if (state.status === "loading") {
    return (
      <section className="auth-card marketplace-card" aria-busy="true">
        <h2>
          {role === "customer"
            ? "My booking requests"
            : "Incoming booking requests"}
        </h2>
        <p className="muted" role="status">
          Loading booking requests…
        </p>
      </section>
    );
  }
  if (state.status === "error") {
    return (
      <section className="auth-card marketplace-card">
        <h2>
          {role === "customer"
            ? "My booking requests"
            : "Incoming booking requests"}
        </h2>
        <p className="form-error" role="alert">
          {state.error}
        </p>
        <button
          className="button button-secondary"
          onClick={() => setRevision((value) => value + 1)}
          type="button"
        >
          Retry
        </button>
      </section>
    );
  }
  const requests = state.requests ?? [];
  const total = state.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / 25));
  return (
    <section
      className="booking-request-list"
      aria-label={
        role === "customer"
          ? "My booking requests"
          : "Incoming booking requests"
      }
    >
      <div className="booking-list-heading">
        <div>
          <p className="eyebrow">Your event briefs</p>
          <h2>
            {role === "customer"
              ? "My booking requests"
              : "Incoming booking requests"}
          </h2>
        </div>
        <button
          className="button button-secondary"
          disabled={pendingId !== ""}
          onClick={() => setRevision((value) => value + 1)}
          type="button"
        >
          Refresh
        </button>
      </div>
      {actionError && (
        <p className="form-error" role="alert">
          {actionError}
        </p>
      )}
      {actionMessage && (
        <p className="form-success" role="status">
          {actionMessage}
        </p>
      )}
      {requests.length === 0 ? (
        <div className="service-empty-state">
          <h3>
            {role === "customer"
              ? "No booking requests yet"
              : "No incoming requests"}
          </h3>
          <p className="muted">
            {role === "customer"
              ? "Start with a service listing and send the professional an event brief."
              : "New customer requests will appear here."}
          </p>
          {role === "customer" && (
            <a className="button" href="/services">
              Discover services
            </a>
          )}
        </div>
      ) : (
        <div className="booking-request-cards">
          {requests.map((item) => (
            <div className="booking-request-item" key={item.id}>
              <BookingRequestCard request={item} />
              {role === "professional" && item.status === "requested" && (
                <div className="booking-actions">
                  <button
                    className="button"
                    disabled={pendingId !== ""}
                    onClick={() => void decide(item.id, "accept")}
                    type="button"
                  >
                    {pendingId === item.id ? "Saving…" : "Accept request"}
                  </button>
                  <button
                    className="button button-secondary"
                    disabled={pendingId !== ""}
                    onClick={() => void decide(item.id, "decline")}
                    type="button"
                  >
                    Decline request
                  </button>
                </div>
              )}
              {((role === "customer" &&
                (item.status === "requested" || item.status === "accepted")) ||
                (role === "professional" && item.status === "accepted")) && (
                <div className="booking-cancellation">
                  {cancelConfirmationId === item.id ? (
                    <div
                      className="booking-cancel-confirmation"
                      role="group"
                      aria-label="Confirm booking cancellation"
                    >
                      <p>
                        This will mark the request as cancelled and notify the
                        other participant. They will no longer be able to accept
                        or decline it. The event brief and conversation will
                        remain available.
                      </p>
                      <div className="booking-actions">
                        <button
                          className="button button-danger"
                          disabled={pendingId !== ""}
                          onClick={() => void cancel(item.id)}
                          type="button"
                        >
                          {pendingId === item.id
                            ? "Cancelling…"
                            : "Confirm cancellation"}
                        </button>
                        <button
                          className="button button-secondary"
                          disabled={pendingId !== ""}
                          onClick={() => setCancelConfirmationId("")}
                          type="button"
                        >
                          Keep request
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      className="button button-secondary"
                      disabled={pendingId !== ""}
                      onClick={() => setCancelConfirmationId(item.id)}
                      type="button"
                    >
                      Cancel booking
                    </button>
                  )}
                </div>
              )}
              {user && (
                <BookingConversation requestId={item.id} currentRole={role} />
              )}
            </div>
          ))}
        </div>
      )}
      {pageCount > 1 && (
        <nav className="booking-pagination" aria-label="Booking request pages">
          <button
            className="button button-secondary"
            disabled={page <= 1}
            onClick={() => setPage((value) => value - 1)}
            type="button"
          >
            Previous
          </button>
          <span>
            Page {page} of {pageCount}
          </span>
          <button
            className="button button-secondary"
            disabled={page >= pageCount}
            onClick={() => setPage((value) => value + 1)}
            type="button"
          >
            Next
          </button>
        </nav>
      )}
    </section>
  );
}

export function CustomerBookingRequestsScreen(props: {
  user: CurrentUser | null;
  userLoading: boolean;
}) {
  return <BookingRequestList {...props} role="customer" />;
}

export function ProfessionalBookingRequestsScreen(props: {
  user: CurrentUser | null;
  userLoading: boolean;
}) {
  return <BookingRequestList {...props} role="professional" />;
}
