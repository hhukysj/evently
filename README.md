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
- [docs/dependencies.md](./docs/dependencies.md) — dependency purpose, licenses, and impact

## Development baseline

- Node.js **24.11.1** (see `.nvmrc`); npm **11.6.4**.
- npm workspaces: `apps/web`, `apps/api`, and `packages/shared`.
- PostgreSQL **17** for development and production.
- Git is required. Docker Engine with Docker Compose is optional and used
  only to run the local PostgreSQL service.

The current foundation provides a minimal React/Vite app, Express API, shared
API contracts, and PostgreSQL connection/migration tooling. Marketplace
features are not implemented.

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
a test-only captured provider. Run it against a migrated PostgreSQL database
with:

```powershell
$env:SESSION_SECRET = "test-only-session-secret-at-least-32-characters"
npm run test:integration
```

The integration test reads `DATABASE_URL` from the ignored root `.env` (or
the process environment) and creates uniquely prefixed test accounts that it
cleans up afterward. Do not point it at production data.

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
are not implemented yet; no email provider or fake delivery path has been
added. Use deployment secret management outside local development.

## Phase discipline

Work only on the current phase in [PHASE_PLAN.md](./PHASE_PLAN.md). Do not
implement marketplace features before their phase, and do not begin the next
phase until the owner approves the current phase.
