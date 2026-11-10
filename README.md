# Evently

Evently is a marketplace for customers planning events and the organizers,
managers, artists, and vendors who provide event services. The MVP is focused
on professional discovery, event briefs, booking requests, communication, and
reviews after completed work. It is not a ticketing platform. Payments and
other out-of-scope work are described in [PRD.md](./PRD.md).

## Project specifications

- [AGENTS.md](./AGENTS.md) — build, security, and verification rules
- [PRD.md](./PRD.md) — product scope and acceptance criteria
- [architecture.md](./architecture.md) — architecture and security contract
- [design.md](./design.md) — UX, accessibility, and visual direction
- [PHASE_PLAN.md](./PHASE_PLAN.md) — implementation phases and exit gates
- [docs/decisions/0001-foundation.md](./docs/decisions/0001-foundation.md) — Phase 0 decisions
- [docs/decisions/0002-provider-onboarding.md](./docs/decisions/0002-provider-onboarding.md) — provider onboarding and approval decisions
- [docs/dependencies.md](./docs/dependencies.md) — dependency purpose, licenses, and impact

- [docs/decisions/0003-service-listing-state-and-audit.md](./docs/decisions/0003-service-listing-state-and-audit.md) - service listing state and moderation audit
- [docs/decisions/0004-service-listing-integration-fixture-recovery.md](./docs/decisions/0004-service-listing-integration-fixture-recovery.md) - integration fixture cleanup and recovery safeguards

## Development baseline

- Node.js **24.11.1** (see `.nvmrc`); npm **11.6.4**.
- npm workspaces: `apps/web`, `apps/api`, and `packages/shared`.
- PostgreSQL **17** for development and production.
- Git is required. Docker Engine with Docker Compose is optional and used
  only to run the local PostgreSQL service.

The current foundation provides a React/Vite app, Express API, shared API
contracts, and PostgreSQL migration tooling. Provider onboarding and
professional-owned listing management are implemented, including publication
controls and public listing search/detail APIs. The customer-facing public
discovery and listing-detail UI, bookings, and payments are not implemented.

## Local database

Choose either local PostgreSQL 17 or the optional Compose service. To use
Compose, copy `.env.example` to `.env` and fill the blank names with
development-only values. Set `POSTGRES_USER`, `POSTGRES_PASSWORD`, and
`POSTGRES_DB` for Compose, plus `DATABASE_URL` for the API. Never commit `.env`.
Then run:

```powershell
Copy-Item .env.example .env
# Edit .env with local-only values before starting the database.
docker compose up -d db
docker compose ps
```

To develop the frontend without Docker or a database, only install
dependencies and start the web workspace as described below.

The database port is bound to `127.0.0.1`; Compose persists data in a named
Docker volume. Stop the service with `docker compose down`. To retain the
database, do not remove the volume. Never reuse local credentials in staging
or production.

## Install and start

From the repository root, install the locked workspace dependencies:

```powershell
npm ci
```

Start the frontend (no database required):

```powershell
npm run dev:web
```

Start the API after setting `DATABASE_URL` and a random `SESSION_SECRET` in
`.env`, and applying the committed migrations:

```powershell
npm run db:migrate --workspace @evently/api
npm run dev:api
```

Generate a session secret locally with:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

Keep the output only in your ignored `.env` or deployment secret manager. Never
paste a real secret into source control, logs, or support messages. The API
listens on `http://127.0.0.1:3001` by default. `GET /health` checks process
liveness, `GET /ready` checks database readiness, and `GET /api/v1/health`
uses the versioned API response envelope. `PORT` can override the default API
port. `NODE_ENV` defaults to `development`.
The Vite development proxy reads the same `PORT` from the root `.env` (or
uses `3001` when it is unset), so browser API calls follow the API's local
port configuration.

The authentication frontend provides screens at `/register`, `/login`,
`/verify-email`, `/forgot-password`, and `/reset-password`. All form mutations
fetch the session's CSRF token first and send it with same-origin credentials.
The API independently validates every request and session.

The authentication API provides:

- `GET /api/v1/auth/csrf` — create/read the session's CSRF token.
- `POST /api/v1/auth/register` — request customer registration.
- `POST /api/v1/auth/verification-request` and
  `POST /api/v1/auth/verify-email` — request verification and consume a
  one-time verification token.
- `POST /api/v1/auth/forgot-password` and
  `POST /api/v1/auth/reset-password` — request and consume a one-time reset
  token.
- `POST /api/v1/auth/login` — authenticate and rotate the session.
- `GET /api/v1/auth/me` — retrieve the authenticated public user.
- `POST /api/v1/auth/logout` — revoke the server-side session.
- `POST /api/v1/admin/users/:userId/suspend` — admin-only user suspension,
  with an audit record.

Provider onboarding endpoints:

- `POST /api/v1/provider-applications` — submit an application as the
  authenticated, active, email-verified customer. The user ID, role, provider
  approval, and reviewer are never accepted from the client.
- `GET /api/v1/provider-applications/me` — retrieve only the signed-in user's
  latest application status. Rejection notes are not returned to applicants.
- `GET /api/v1/admin/provider-applications` and
  `GET /api/v1/admin/provider-applications/:applicationId` — bounded,
  admin-only review queue and application details.
- `POST /api/v1/admin/provider-applications/:applicationId/approve` and
  `/reject` — admin-only, CSRF-protected, audited review actions. Rejection
  requires a bounded reason.
- `GET /api/v1/professional/me` and
  `PATCH /api/v1/professional/me/profile` — owner-only draft profile read/edit.
  Profile slugs are generated by the server and cannot be edited.

These professional profile endpoints manage private drafts; they do not
provide public professional profile pages, profile publication, or uploads.
Separate service-listing APIs are implemented for provider management,
administrator moderation, and public search/detail. The customer-facing
discovery and listing-detail UI is not implemented yet. Approval promotes the
existing account role and invalidates its existing sessions. Administrators
must be provisioned through a trusted operator-controlled process; there is
no client-facing role-promotion mechanism.

Provider service-listing endpoints:

- `GET` and `POST /api/v1/professional/service-listings` provide bounded owner
  listing reads and draft creation for approved, active professionals.
- `GET` and `PATCH /api/v1/professional/service-listings/:listingId`, plus
  `POST /api/v1/professional/service-listings/:listingId/publish` and
  `/unpublish`, provide owner-only detail, edits, and publication transitions.
  Mutations use ETags; editing a published listing requires confirmation.
- `GET /api/v1/service-listings` and
  `GET /api/v1/service-listings/:listingId` provide public search and detail
  APIs with visibility and privacy filtering. There is no customer-facing
  discovery screen yet.
- `GET /api/v1/admin/service-listings` and
  `GET /api/v1/admin/service-listings/:listingId` provide the bounded admin
  moderation queue and detail.
- `POST /api/v1/admin/service-listings/:listingId/hide` and
  `/restore` provide audited, version-checked moderation actions.

Browser state-changing requests must send the exact `APP_ORIGIN` in the
`Origin` header and the CSRF token in `X-CSRF-Token`. The development web
server proxies `/api` to the local API. Sessions have an eight-hour rolling
idle expiry, are stored
in PostgreSQL, and use `HttpOnly`/`SameSite=Lax` cookies. Production also
requires HTTPS for the `Secure` `__Host-` cookie. Set `TRUST_PROXY_HOPS` only
to the exact number of trusted reverse-proxy hops in front of the API; leave
it at `0` when no trusted proxy is used. Do not trust client-controlled
forwarding headers.

In `NODE_ENV=development`, the API uses an in-memory local email sink. The
frontend's Development-only Local account inbox displays verification/reset
links; these messages are **not sent** to email addresses. The inbox holds at
most 20 messages in process memory, is not logged, and is mounted only in
development. Its raw-token endpoint, `GET /api/v1/dev/email-inbox`, is not
mounted in production. In production the email adapter remains unconfigured,
and registration/verification/reset-email requests return an explicit
`503 EMAIL_DELIVERY_UNAVAILABLE`; production account email is not simulated.
No email provider or dependency is configured.

Auth route and frontend tests use local/in-memory test fixtures. The
PostgreSQL integration suite exercises the database-backed auth journey using
a test-only captured provider. Integration tests require an explicitly
provisioned, disposable PostgreSQL 17 database on loopback. The local target
must be named `evently_verify_fresh`, `evently_verify_upgrade`, or
`evently_verify_clean`, and use `evently_verifier` as both role and owner.
Configure authentication outside the URL (for example with the PostgreSQL
password file); do not use the development `evently` database. The test runner
checks the configured target and live database identity before any suite can
write fixtures. The database must already have the reviewed migrations applied;
the integration command does not migrate it. You can perform the read-only
identity check first with `npm run db:verify-test-target --workspace @evently/api`.
Fixture records use per-run unique prefixes and scoped cleanup; an interrupted
process can leave its own fixtures behind. The test command requires
`EVENTLY_INTEGRATION_DATABASE_URL` and never falls back to root `.env` for its
target.

```powershell
$env:SESSION_SECRET = "test-only-session-secret-at-least-32-characters"
$env:EVENTLY_INTEGRATION_DATABASE_URL = "postgresql://evently_verifier@127.0.0.1:5432/evently_verify_upgrade"
npm run test:integration
```

CI uses its dedicated PostgreSQL 17 service database, `evently_test`, with the
`evently` role as owner. CI validates the live service identity before applying
migrations and running integration or browser tests. Local target policy does
not accept the CI target, and CI mode does not accept local verifier targets.

## Browser tests

The Playwright browser suite starts the API and Vite locally and uses the
development-only local account inbox; it does not send email. Before running,
install the Chromium browser once with `npx playwright install chromium`.
Set `EVENTLY_E2E_DATABASE_URL` to a loopback connection for an approved,
disposable verifier database (`evently_verify_fresh`,
`evently_verify_upgrade`, or `evently_verify_clean`) using
`evently_verifier`, without embedding a password. The configured PostgreSQL
password file is used for authentication. The test runner verifies database
identity before creating uniquely prefixed fixtures and removes only those
fixtures. Test-namespaced rate-limit counters are left to expire through the
rate-limit store's normal cleanup.

```powershell
$env:EVENTLY_E2E_DATABASE_URL = "postgresql://evently_verifier@127.0.0.1:5432/evently_verify_upgrade"
npm run test:e2e
```

The runner refuses to start without an explicitly approved target. Browser
screenshots and HTML reports are written under ignored `test-results/` and
`playwright-report/` directories. Traces are disabled because the local
verification inbox contains short-lived account tokens. Each run uses a
random, development-only rate-limit namespace; its counters expire through
normal cleanup and production rate limits are unchanged.

## Database changes

Drizzle schema changes live in `apps/api/src/db`; reviewed, versioned SQL
migrations live in `apps/api/drizzle`. With `DATABASE_URL` and
`SESSION_SECRET` set (as required by API environment validation), generate and
inspect migration SQL before applying it:

```powershell
npm run db:generate --workspace @evently/api
npm run db:migrate --workspace @evently/api
```

Commit generated SQL and its Drizzle metadata. Migrations must work from an
empty database and be repeatable in CI and deployment. Do not use schema push
as a substitute for reviewed migrations. The Phase 1 baseline migration runs
`SELECT 1` only to establish migration history. Phase 2 adds `users`, role and
account-status enums, and the PostgreSQL-compatible `sessions` table required
by `connect-pg-simple`; its schema must stay aligned with that library's
expected `sid`, `sess`, `expire`, and `IDX_sessions_expire` names.

## Checks

```powershell
npm run typecheck
npm run lint
npm run format:check
npm test
npm run build
```

`npm run check` runs all of these checks in sequence. CI additionally applies
the migration set twice to PostgreSQL 17 to verify clean-database setup and
repeatable migration tracking.

## Deployment assumptions

The initial deployment is expected to use a static host for the Vite build, a
long-running Node.js host for the Express API, managed PostgreSQL, and
object-storage/email providers only when those features are implemented.
Choose vendors, regions, quotas, backups, and prices before staging; no
production provider has been selected. Keep development, staging, and
production databases and secrets separate. See the decision log for current
choices and unresolved decisions.

The API reads `DATABASE_URL`, `PORT`, `NODE_ENV`, `SESSION_SECRET`,
`APP_ORIGIN`, and `TRUST_PROXY_HOPS`. `.env.example` contains variable names
and non-secret local defaults only. Email verification and password recovery
routes are implemented. Development uses the local in-memory email inbox
described above; production email delivery is unconfigured, so email-dependent
registration, verification-request, and password-reset-request operations
return `503 EMAIL_DELIVERY_UNAVAILABLE` until a provider is selected and
configured. Use deployment secret management outside local development.

## Phase discipline

Work only on the current phase in [PHASE_PLAN.md](./PHASE_PLAN.md). Do not
implement marketplace features before their phase, and do not begin the next
phase until the owner approves the current phase.
