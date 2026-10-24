# Phase 1-2 dependency record

Dependencies are limited to the web/API foundation and its verification
tooling. Direct license identifiers below were checked from the installed
package metadata on 2026-10-18. The lockfile records exact resolved versions;
review updates through normal dependency maintenance rather than bypassing
peer constraints.

## Runtime dependencies

| Package              | Workspace                     | Need and maintenance/security notes                                                                                                                               | License      | Bundle impact                                                                |
| -------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ---------------------------------------------------------------------------- |
| `react`, `react-dom` | `apps/web`                    | Core UI runtime; maintained upstream. Keep patched and test React upgrades.                                                                                       | MIT          | Shipped to the browser; current app uses only a small static shell.          |
| `express`            | `apps/api`                    | HTTP server for the modular monolith; maintained upstream. Keep patched and validate all future inputs at route boundaries.                                       | MIT          | Server only; not in the browser bundle.                                      |
| `pg`                 | `apps/api`                    | PostgreSQL driver used by Drizzle and readiness probes; maintained upstream. Keep patched and avoid logging connection strings.                                   | MIT          | Server only.                                                                 |
| `drizzle-orm`        | `apps/api`                    | Typed PostgreSQL access and migration integration; maintained upstream. Keep patched and use parameterized ORM operations.                                        | Apache-2.0   | Server only.                                                                 |
| `zod`                | `apps/api`, `packages/shared` | Zod 4 runtime validation and shared API contracts; maintained upstream. Keep schemas free of secrets and server-only fields before exporting them to the browser. | MIT          | Currently used on the server/contracts only; not included in the web bundle. |
| `dotenv`             | `apps/api`                    | Loads ignored local `.env` configuration; maintained upstream. Production should use the host secret manager.                                                     | BSD-2-Clause | Server only.                                                                 |
| `argon2`             | `apps/api`                    | Vetted native Argon2 implementation used for Argon2id password hashing/verification; pin and review updates.                                                      | MIT          | Server only; native runtime dependency.                                      |
| `express-session`    | `apps/api`                    | Maintained server-side browser session middleware; session IDs are rotated on authentication and cookies use secure attributes.                                   | MIT          | Server only.                                                                 |
| `connect-pg-simple`  | `apps/api`                    | PostgreSQL persistence adapter for Express sessions; schema is explicitly versioned and migrations are reviewed.                                                  | MIT          | Server only.                                                                 |
| `express-rate-limit` | `apps/api`                    | Bounds authentication attempts through a custom PostgreSQL store shared by API instances; client identifiers are hashed before storage.                           | MIT          | Server only.                                                                 |

`@evently/shared` is an internal workspace package, not a third-party
dependency. It exports shared response types and validation schemas.

## Development and test dependencies

| Packages                                                                                                                                                   | Need and maintenance/security notes                                                                                                               | License                                        | Bundle impact                             |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | ----------------------------------------- |
| `vite`, `@vitejs/plugin-react`                                                                                                                             | Local web development and production bundling. Dev server binds to loopback. Keep both patched and do not expose the development server publicly. | MIT                                            | Build tools only; not shipped at runtime. |
| `typescript`, `typescript-eslint`, `eslint`, `@eslint/js`, `eslint-plugin-react-hooks`, `eslint-plugin-react-refresh`, `globals`, `prettier`               | Type checking, linting, and formatting. Dev-only; update with compatible plugin peer ranges.                                                      | Apache-2.0 for TypeScript; MIT for the others. | None at runtime.                          |
| `vitest`, `supertest`, `@testing-library/react`, `jsdom`                                                                                                   | API/contract tests and a frontend render smoke test. Keep test-only and update together when their supported Node/Vite ranges change.             | MIT                                            | None at runtime.                          |
| `tsx`                                                                                                                                                      | Runs the TypeScript API in development without emitting files. Dev-only; production uses compiled JavaScript.                                     | MIT                                            | None at runtime.                          |
| `drizzle-kit`                                                                                                                                              | Generates reviewed SQL migrations and applies committed migrations. Dev/CI tool only; never use schema push for deployed changes.                 | MIT                                            | None at runtime.                          |
| `@types/express`, `@types/express-session`, `@types/connect-pg-simple`, `@types/node`, `@types/pg`, `@types/react`, `@types/react-dom`, `@types/supertest` | Compile-time declarations only. Keep aligned with the corresponding runtime package major.                                                        | MIT                                            | None at runtime.                          |

## Security and cost notes

- `npm audit` on 2026-10-18 reported **four moderate advisories** through
  Drizzle Kit's transitive `@esbuild-kit` loader dependency (`esbuild` 0.18.20).
  The reported esbuild issue concerns its development-server request handling;
  this transitive copy is used by the migration CLI, not by the Vite dev
  server, which resolves a patched esbuild release. Drizzle Kit 0.31.11 is
  the current compatible release and still includes the legacy loader. No
  forced override was applied because it would replace a narrowly pinned
  transitive compiler dependency without verified compatibility. Recheck
  `npm audit` during dependency updates and replace or upgrade the loader
  before relying on it in an exposed environment.
- The frontend has no paid services or external assets. PostgreSQL is the
  only local service and is optional for frontend-only work. No separate
  infrastructure or subscription cost is introduced.
- Phase 2 authentication adds no paid provider. Argon2id adds CPU and memory
  work per password hash/verification; current parameters use 19 MiB memory,
  time cost 2, and parallelism 1. PostgreSQL-backed rate-limit counters share
  limits across API instances and add small bounded writes to the existing
  database. No Redis dependency or separate service is introduced.
- Email delivery remains unconfigured. The provider interface adds no
  dependency or provider cost; actual verification and reset delivery require
  selecting and documenting a provider before Phase 2 can be approved.
- CI uses an ephemeral PostgreSQL 17 service and test-only credentials. They
  are not production secrets and are not used outside that isolated job.
