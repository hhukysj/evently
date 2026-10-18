# AGENTS.md — Evently Build Rules

## Mission
Build Evently from scratch into a secure event-services marketplace connecting customers with event organizers, event managers, artists, and vendors. Prioritize functional completeness, security, low operating cost, and maintainability.

## Required reading
Before implementation, read `PRD.md`, `architecture.md`, `design.md`, and `PHASE_PLAN.md`.

## Build protocol
- Work on the current phase only.
- Inspect existing files before changing them.
- Make small, complete vertical slices.
- Run relevant checks and fix regressions before continuing.
- Do not claim tests passed unless you ran them.
- Report changed files, migrations, test results, manual setup, known gaps, cost impact, and exit-gate status.
- Never start the next phase if the current exit gate fails unless the project owner explicitly accepts the gap.

## Architecture constraints
- Use a modular monolith, not microservices.
- Prefer React + Vite + TypeScript, Express + TypeScript, PostgreSQL + Drizzle, React Query, Wouter, Zod, and Tailwind.
- Keep domain logic out of React components and thin HTTP route handlers.
- Use versioned migrations, foreign keys, database constraints, bounded pagination, and transactions for multi-record state changes.
- Do not add Redis, a job queue, WebSockets, Kubernetes, paid AI APIs, or a separate search engine without evidence of need.
- Do not add dependencies without documenting the need, maintenance, license, security, and bundle impact.

## Security rules
- Use a mature server-side session library and PostgreSQL-backed sessions for the browser app.
- Use secure cookies, session rotation, CSRF protection, exact CORS allowlists, and rate limiting.
- Hash passwords with Argon2id or a vetted supported equivalent; do not implement cryptography yourself.
- Verify email and use hashed, short-lived, single-use reset/verification tokens.
- Validate all request bodies, params, queries, file uploads, and content types server-side.
- Enforce ownership and role permissions in the server/domain layer on every private read/write.
- Never trust client-provided owner IDs, roles, booking status, prices, or payment state.
- Use parameterized database access and safe error responses.
- Keep secrets out of source control, client bundles, logs, and generated reports.
- Do not store production uploads on ephemeral application disk.
- Do not expose private contact information by default.
- Add audit logs for sensitive administrative actions.

## Functional integrity
- No mock data in production paths.
- No fake success states, swallowed errors, dead buttons, or placeholder actions presented as complete.
- Every visible control must perform its intended action or be visibly disabled with a reason.
- Do not show ratings, reviews, verification badges, availability, payment status, or popularity claims unless grounded in real data and process.
- Booking transitions must be explicit and validated server-side.
- A browser redirect is not proof of payment.

## ReactBits rules
- Reference https://reactbits.dev/; select only components that materially improve the design.
- Record component name, source/license, dependencies, bundle impact, accessibility behavior, and reduced-motion behavior.
- Adapt source to Evently's design system; remove demo-only code and unnecessary dependencies.
- Keep animation subtle and optional. Respect reduced motion and do not impair mobile performance, forms, keyboard navigation, or screen readers.
- Use simple CSS/native components when they achieve the same result.

## Cost rules
- Prefer free/open-source options during development, but verify current limits and terms.
- No paid API is allowed without stating why it is necessary and estimating the cost/usage driver.
- Start with PostgreSQL search, polling, text-based service areas, and a single API deployment.
- Separate development/staging/production secrets and databases.
- Document usage caps and the expected impact of uploads, email, hosting, and database growth.

## Required verification
Run available typecheck, lint, unit/integration tests, build, and migration checks. Add tests for authorization and negative cases, not only happy paths. If a command cannot run, say why and do not mark it passed.

## Completion report
1. Implemented behavior.
2. Files/migrations changed.
3. Commands and actual test results.
4. Authorization/security cases tested.
5. Environment variables/manual setup required.
6. Known limitations/deferred work.
7. New dependencies/providers and cost implications.
8. Exit-gate status.
