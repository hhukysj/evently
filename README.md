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

## Development baseline

- Node.js **24.11.1** (see `.nvmrc`); npm **11.6.4**.
- npm workspaces: `apps/web`, `apps/api`, and `packages/shared`.
- PostgreSQL **17** for development and production.
- Git is required. Docker Engine with Docker Compose is optional and used
  only to run the local PostgreSQL service.

The workspace package manifests currently contain no application code or
runtime dependencies. The web app, API, schemas, and database migration
commands are introduced in Phase 1.

## Local database

Choose either local PostgreSQL 17 or the optional Compose service. To use
Compose, create a local, untracked `.env` file in the repository root with
`POSTGRES_USER`, `POSTGRES_PASSWORD`, and `POSTGRES_DB` set to development-only
values. Then run:

```powershell
docker compose up -d db
docker compose ps
```

The database port is bound to `127.0.0.1`; Compose persists data in a named
Docker volume. Stop the service with `docker compose down`. To retain the
database, do not remove the volume. Never reuse local credentials in staging
or production.

## Install and start

From the repository root, install the locked workspace dependencies:

```powershell
npm ci
```

At this Phase 0 baseline, there are no app start or migration scripts yet.
Phase 1 will add the Vite web app, Express API, environment validation, and
Drizzle migration scripts. Until then, only the optional database service can
be started locally.

The API will use `DATABASE_URL` for PostgreSQL. Future application
configuration includes `SESSION_SECRET`, `APP_ORIGIN`, `API_ORIGIN`,
`EMAIL_PROVIDER_API_KEY`, `EMAIL_FROM`, object-storage settings, and an
optional geocoding key only if that provider is enabled. Set secrets in an
untracked local `.env` file or the deployment platform's secret manager; do
not commit real values. See [architecture.md](./architecture.md#12-environment-variables)
for details.

## Database changes

Drizzle schema changes will be kept in `apps/api/src/db`; reviewed, versioned
SQL migrations will be kept in `apps/api/drizzle`. The Phase 1 workflow will
generate migrations from schema changes, review and commit the SQL, and apply
them with Drizzle's migration runner. Migrations must work from an empty
database and must be repeatable in CI and deployment. Do not use schema push
as a substitute for production migrations.

## Deployment assumptions

The initial deployment is expected to use a static host for the Vite build, a
long-running Node.js host for the Express API, managed PostgreSQL, and
object-storage/email providers only when those features are implemented.
Choose vendors, regions, quotas, backups, and prices before staging; no
production provider has been selected. Keep development, staging, and
production databases and secrets separate. See the decision log for current
choices and unresolved decisions.

## Phase discipline

Work only on the current phase in [PHASE_PLAN.md](./PHASE_PLAN.md). Do not
implement marketplace features before their phase, and do not begin Phase 1
until the owner approves Phase 0.
