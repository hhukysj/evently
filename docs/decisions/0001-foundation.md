# ADR 0001: Phase 0 repository and local development foundation

- **Status:** Accepted for Phase 0
- **Date:** 2026-10-18

## Context

Evently is being built from the specification pack in the repository. Phase 0
establishes the workspace and documents local data development without
implementing product behavior or selecting production providers.

## Decisions

1. **Use npm workspaces** rooted at `apps/web`, `apps/api`, and
   `packages/shared`. The shared package is for validation schemas and types
   that are safe to use on both client and server. No monorepo orchestrator or
   runtime dependency is needed yet.
2. **Pin the development toolchain** to Node.js 24.11.1 in `.nvmrc` and npm
   11.6.4 in the root package metadata. Keep compatible engine ranges so
   patch-level security updates can be adopted deliberately.
3. **Use PostgreSQL 17 with Drizzle**. Schema definitions will live in
   `apps/api/src/db`; versioned SQL migrations will live in
   `apps/api/drizzle`. Generate and review migration SQL, commit it, and apply
   it with Drizzle's migration runner. Do not use schema push for deployed
   databases.
4. **Keep Docker optional and database-only.** The Compose file runs one
   PostgreSQL service with loopback-only port binding and a named data volume.
   Developers without a running Docker Engine can use a local PostgreSQL 17
   installation. Do not containerize the app or add cache, queue, or other
   services in Phase 0.
5. **Defer production provider choices.** The initial deployment shape is a
   static web host, a long-running Node API, managed PostgreSQL, and optional
   object storage/email when needed. Provider, region, pricing, backup, and
   quota decisions require current review before staging.
6. **Keep secrets local.** `.env` files are ignored. Local Compose credentials
   are development-only; production credentials belong in separate
   deployment secret stores. No real secret belongs in the repository.

## Environment variables

The application configuration planned for Phase 1 includes:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string for the API |
| `SESSION_SECRET` | Server-side session signing/secret material |
| `APP_ORIGIN` | Exact browser origin allowed by the API |
| `API_ORIGIN` | Public API origin used by the application |
| `EMAIL_PROVIDER_API_KEY` | Transactional email provider credential |
| `EMAIL_FROM` | Verified sender address |
| `OBJECT_STORAGE_*` | Provider-specific endpoint, bucket, region, and credentials; define exact names after provider selection |
| `GEOCODING_API_KEY` | Optional; only if geocoding is enabled |
| `POSTGRES_USER` | Local Compose database user |
| `POSTGRES_PASSWORD` | Local Compose development-only password |
| `POSTGRES_DB` | Local Compose database name |

Create the local `.env` file manually and fill only variables needed by the
selected local services. Do not commit it. Phase 1 will add the documented
`.env.example` template with variable names only and startup validation.

## Local workflow

1. Install Node.js 24.11.1 and npm 11.6.4; run `npm ci` at the repository
   root.
2. Install PostgreSQL 17 locally, or configure the three `POSTGRES_*` values
   in an untracked root `.env` and run `docker compose up -d db`.
3. In Phase 1, set `DATABASE_URL`, run the documented Drizzle migration
   command, and start the web and API through workspace scripts. Those app
   commands do not exist in the Phase 0 baseline.

## Verification and constraints

At decision time, Node.js 24.11.1, npm 11.6.4, Git 2.51.1.windows.1, and
Docker CLI 29.7.2 were available. Docker could not connect to its Linux Engine
named pipe, so container startup has not been verified. No application
dependencies, production services, credentials, or migrations are introduced
by this decision.

## Deferred decisions

- Production hosting providers, regions, and cost/usage limits
- PostgreSQL managed provider, connection pooling, backups, and restore testing
- Object-storage and transactional-email providers and exact configuration
- Whether geocoding is needed and its privacy/cost implications
