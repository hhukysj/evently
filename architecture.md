# Evently --- Architecture Outline

**Purpose:** concise implementation contract for coding agents. Prefer
this file over speculative infrastructure. Build a secure modular
monolith first; split services only when measured bottlenecks or team
boundaries justify it.

## 1. Architecture decisions

-   **Application:** TypeScript monorepo with React + Vite frontend and
    Express API.
-   **Database:** PostgreSQL; Drizzle ORM and versioned SQL migrations.
-   **Client data:** TanStack Query for server state; Wouter for
    routing; Zod schemas shared where practical.
-   **UI:** Tailwind CSS with accessible, reusable components.
-   **Validation:** Zod at API boundaries; PostgreSQL constraints for
    invariants.
-   **Initial deployment:** stateless web/API instances, managed
    PostgreSQL, object storage, and a transactional email provider.
-   **Architecture style:** modular monolith, not microservices. One
    deployable API with clear domain modules and dependency boundaries.
-   **Repository constraint:** if extending the existing Evently
    codebase, preserve its React/Vite/TypeScript + Express +
    PostgreSQL + Drizzle + React Query + Wouter + Zod + Tailwind
    structure unless an audit identifies a concrete blocker. Do not
    rewrite merely for preference.

## 2. System boundary

``` text
Browser
  └── React app (Vite, TypeScript)
       └── HTTPS /api
            └── Express API
                 ├── Authentication & authorization
                 ├── Domain modules
                 ├── Drizzle ORM
                 ├── PostgreSQL
                 ├── Object storage (signed uploads)
                 └── Email provider (async/best-effort)
```

The browser is untrusted. It never connects directly to PostgreSQL,
stores secrets, decides permissions, or authoritatively determines
booking state.

## 3. Suggested repository layout

``` text
client/
  src/
    app/                 # routing, providers, app shell
    components/          # shared UI
    features/
      auth/
      discovery/
      events/
      professionals/
      bookings/
      messaging/
      reviews/
      notifications/
    lib/                 # API client, query client, utilities
server/
  src/
    app.ts               # Express configuration
    routes/              # HTTP route registration only
    middleware/          # auth, validation, rate limits, errors
    modules/
      auth/
      users/
      professionals/
      discovery/
      events/
      bookings/
      conversations/
      reviews/
      notifications/
      moderation/
    db/                  # schema, migrations, connection
    services/            # email, storage, geocoding adapters
    config/              # validated environment config
shared/
  schemas/               # shared request/response types where safe
tests/
  integration/
  e2e/
```

Adapt to the existing repository rather than moving files wholesale.
Keep controllers thin: route → validation → domain service →
repository/database → response. Do not put business logic in React
components or route handlers.

## 4. Domain modules and ownership

-   **Auth:** registration, login/logout, email verification, password
    reset, sessions.
-   **Users:** customer account, profile, preferences, deactivation.
-   **Professionals:** public profile, categories, service areas,
    packages, portfolio, availability.
-   **Discovery:** query composition, filters, sort, pagination,
    location search.
-   **Events:** customer-owned event briefs.
-   **Bookings:** request, accept, decline, cancellation, proposed
    changes, completion.
-   **Conversations:** participant membership and persistent messages.
-   **Reviews:** eligibility and uniqueness for completed bookings.
-   **Notifications:** durable in-app notifications; optional email
    delivery.
-   **Moderation:** reports, suspensions, admin actions, audit trail.
-   **Infrastructure adapters:** object storage, email, and optional
    geocoding behind interfaces.

Avoid circular module dependencies. Cross-module changes go through
domain services and database transactions.

## 5. Core data model

Use UUID primary keys (or a consistent database-generated ID strategy),
`created_at`/`updated_at` timestamps, foreign keys, and explicit
deletion/retention semantics.

Minimum tables: - `users`: email (normalized and unique), password hash
if using passwords, role/account state, verification timestamps. -
`sessions`: hashed session token or framework-managed secure session
record, user ID, expiry, revocation metadata. - `professional_profiles`:
user ID, public business/profile fields, approval state. -
`service_categories`; `professional_services`; `packages`. -
`portfolio_items`: professional ID, storage object key, moderation
state, sort order. - `service_areas` or `professional_locations`:
address/display label and optional validated latitude/longitude. -
`availability_rules` and `availability_exceptions` if availability
filtering is in MVP. - `events`: customer ID, event type, local
date/time and timezone, guest count, budget range, location fields,
notes. - `event_service_requests`: event ID, category/service
requested. - `bookings`: event ID, professional ID, status, quoted
amount/currency if quote workflow is supported, agreed terms snapshot,
cancellation/completion timestamps. - `booking_status_history`: booking
ID, actor ID, previous/new status, timestamp, reason. - `conversations`;
`conversation_participants`; `messages`. - `favorites`: customer ID +
professional ID unique pair. - `reviews`: booking ID unique, reviewer
ID, professional ID, rating, text, moderation state. - `notifications`:
recipient ID, type, payload with a strict schema, read timestamp. -
`reports`; `admin_audit_logs`. - Optional `outbox_events` if reliable
asynchronous delivery is needed.

Do not add every possible table blindly. Implement only the MVP entities
actually used, with migrations and tests. Add indexes for measured
access patterns, typically normalized unique email, foreign keys used in
lists, booking status/date, conversation message chronology,
recipient/unread notifications, review lookup, and discovery filters.
Use `EXPLAIN ANALYZE` before adding expensive indexes.

## 6. Authentication and security contract

-   Prefer server-side sessions with a mature session library and
    PostgreSQL-backed session store for this browser-first web app. Do
    not implement custom cryptography or homemade JWT/session schemes.
-   Cookies: `HttpOnly`, `Secure` in production, appropriate `SameSite`,
    narrow path/domain, and bounded lifetime. Rotate session ID on login
    and privilege changes; revoke sessions on logout and account
    security events.
-   Use CSRF protection for cookie-authenticated state-changing
    requests. Configure exact allowed origins; never use permissive
    credentialed CORS.
-   Hash passwords with Argon2id (or a vetted framework-supported
    equivalent); never encrypt or store plaintext passwords.
-   Verify email; use random, hashed, expiring, single-use
    reset/verification tokens.
-   Enforce authorization in domain services for every resource
    read/write. Never rely on hidden UI controls or role fields sent by
    the browser.
-   Check ownership and conversation membership on every request. Admin
    checks must be explicit and audited.
-   Validate body, query, params, content types, size limits, and file
    uploads. Use parameterized ORM queries; no SQL string interpolation
    from user input.
-   Rate-limit login, reset, messaging, and report endpoints; add
    progressive abuse controls without leaking whether an email exists.
-   Set secure headers, redact sensitive logs, use generic production
    errors, and keep secrets in environment/secret management.
-   Do not fetch arbitrary user-supplied URLs from the server. Protect
    against XSS by safe rendering and sanitization of any permitted rich
    text.
-   Keep dependencies patched and run secret/dependency scans in CI.
-   Define data export/deletion, retention, privacy notice, and incident
    response before public launch.

## 7. API conventions

-   Prefix routes with `/api/v1`; use JSON and consistent error
    envelopes.
-   Validate every request at the boundary. Return appropriate
    2xx/4xx/5xx status codes; do not return success for swallowed
    failures.
-   Use cursor pagination for large lists/messages; bounded page size
    and deterministic ordering.
-   Keep response DTOs explicit. Never serialize ORM records wholesale
    if they include private fields.
-   Use idempotency keys or safe deduplication for booking creation and
    other retry-sensitive mutations.
-   Suggested endpoint families:
    -   `/auth/register`, `/auth/login`, `/auth/logout`, `/auth/me`,
        `/auth/verify-email`, `/auth/forgot-password`,
        `/auth/reset-password`
    -   `/professionals`, `/professionals/:id`,
        `/professionals/:id/services`, `/professionals/:id/portfolio`
    -   `/events`, `/events/:id`
    -   `/bookings`, `/bookings/:id/accept`, `/bookings/:id/decline`,
        `/bookings/:id/cancel`, `/bookings/:id/complete`
    -   `/conversations`, `/conversations/:id/messages`
    -   `/reviews`, `/favorites`, `/notifications`, `/reports`
-   Keep state-transition endpoints explicit. A generic unrestricted
    `PATCH /bookings/:id` is not acceptable.

## 8. Booking transaction rules

Within a database transaction: 1. Load the booking with required rows
and verify actor permission. 2. Verify current status and allowed
transition. 3. Check any relevant uniqueness/concurrency invariant. 4.
Apply status and timestamp changes. 5. Insert status history and durable
notification/outbox record. 6. Commit; send email outside the
transaction or through an outbox worker.

Use conditional updates or row locking where concurrent accept/cancel
requests could conflict. The database, not client state, is
authoritative. Define one transition map and test every allowed and
forbidden transition.

## 9. Files, search, and location

-   Upload through signed object-storage URLs or a server-mediated
    upload service with strict limits; store object keys and metadata,
    not local filesystem paths.
-   Public media should use controlled public derivatives or signed URLs
    according to moderation/privacy needs.
-   Start with PostgreSQL full-text search and indexed filters. Add
    PostGIS if radius/distance search is a real MVP requirement and
    coordinates are consistently geocoded with consent.
-   Do not claim distance/availability accuracy without valid
    coordinates and a real availability model.
-   External geocoding must be behind an adapter with quotas, caching,
    privacy review, and graceful failure.

## 10. Scale and reliability path

**MVP:** one modular API, PostgreSQL, object storage, email provider,
basic monitoring. Keep API instances stateless.

**When evidence supports it:** add a job queue/outbox worker for email
and notifications; cache stable public discovery results; add PostgreSQL
read replicas or search infrastructure only after profiling; add
WebSockets for real-time messaging only when polling is inadequate.

Scale through connection pooling, query/index tuning, bounded
pagination, rate limits, load tests, autoscaling stateless app
instances, and tested database backups/restore. Do not promise "millions
of users" from a tech stack alone; scale depends on query shape,
traffic, workload, and operational design.

## 11. Testing and delivery gates

-   Unit tests: domain rules, validation, transition map, permission
    predicates.
-   Integration tests against PostgreSQL: migrations, constraints,
    transactions, duplicate requests, concurrent booking actions.
-   API security tests: IDOR/ownership, role escalation, session
    revocation, CSRF, rate limits.
-   E2E tests: sign up/login, create event, discover professional,
    request, accept/decline, message, complete, review.
-   CI: typecheck, lint, tests, migration validation, build,
    dependency/secret scan.
-   Staging uses separate database, storage bucket, and secrets from
    production.
-   Before release: verify backups and restore, error monitoring, rate
    limits, privacy/legal pages, and no dead buttons/mock success paths.

## 12. Environment variables

Document names in `.env.example` without real values. Validate required
configuration at startup and fail fast: `DATABASE_URL`,
`SESSION_SECRET`, `APP_ORIGIN`, `API_ORIGIN`, `EMAIL_PROVIDER_API_KEY`,
`EMAIL_FROM`, `OBJECT_STORAGE_*`, and geocoding keys only if enabled.

Never commit `.env`, real credentials, production dumps, or session
secrets. Rotate any secret exposed in logs or source control.
