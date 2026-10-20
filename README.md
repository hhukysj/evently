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

Start the API after setting `DATABASE_URL` in `.env` (the API can start without
a live database, but `/ready` will return `503` until the database responds):

```powershell
npm run dev:api
```

The API listens on `http://127.0.0.1:3001` by default. `GET /health` checks
process liveness, `GET /ready` checks database readiness, and
`GET /api/v1/health` uses the versioned API response envelope. `PORT` can
override the default API port. `NODE_ENV` defaults to `development`.

## Database changes

Drizzle schema changes live in `apps/api/src/db`; reviewed, versioned SQL
migrations live in `apps/api/drizzle`. With `DATABASE_URL` set, generate and
inspect migration SQL before applying it:

```powershell
npm run db:generate --workspace @evently/api
npm run db:migrate --workspace @evently/api
```

Commit generated SQL and its Drizzle metadata. Migrations must work from an
empty database and be repeatable in CI and deployment. Do not use schema push
as a substitute for reviewed migrations. The current baseline migration runs
`SELECT 1` only to establish migration history; Phase 1 adds no product tables.
The first schema change should produce the first application-schema migration.

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

Only `DATABASE_URL`, `PORT`, and `NODE_ENV` are currently read by the API.
Authentication, email, storage, and geocoding configuration will be added
when those capabilities enter scope. `.env.example` contains variable names
without credential values; use deployment secret management outside local
development.

## Phase discipline

Work only on the current phase in [PHASE_PLAN.md](./PHASE_PLAN.md). Do not
implement marketplace features before their phase, and do not begin the next
phase until the owner approves the current phase.
