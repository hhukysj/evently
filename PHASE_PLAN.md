# Evently — From-Zero Build Plan

**Purpose:** Build Evently from an empty repository into a secure, usable, production-minded marketplace in small verified phases.

## Product rule

The first launch is a focused marketplace, not an everything-platform. The first complete customer journey is: discover a professional → view real profile/services → submit an event brief/booking request → professional accepts or declines → both can communicate → booking is completed → eligible review can be submitted.

Do not add payment processing until this loop works reliably.

## Fixed constraints

- Build from scratch; do not assume an existing codebase.
- Use a modular monolith, not microservices.
- TypeScript end-to-end where practical.
- Keep monthly costs near zero during development; verify current provider limits before production.
- No fake data in real product flows, fake success messages, dead buttons, or unverified claims.
- Use ReactBits selectively for a small number of visual components. Do not install the whole library or make animated effects the core design.
- Preserve the Evently design direction: cream/off-white surfaces, navy foundation, coral/terracotta and teal accents, editorial serif headings paired with readable sans-serif body type. Test contrast and do not use color alone for status.
- Work phase by phase. Do not start the next phase if the current exit gate fails unless the owner explicitly accepts the gap.

## Phase 0 — Product and repository setup

Tasks:
1. Create a Git repository named `evently`; add a README, `.gitignore`, and this plan/spec set.
2. Create a package-manager lockfile and pin supported Node.js version in project docs.
3. Choose one monorepo layout and stick to it:
   - `apps/web` — React + Vite + TypeScript
   - `apps/api` — Express + TypeScript
   - `packages/shared` — shared validation schemas/types only where safe
   - `docs` — product/architecture decisions
4. Add `AGENTS.md`, `PRD.md`, `architecture.md`, `design.md`, and `PHASE_PLAN.md` to the repository root.
5. Add a short decision log for provider choices, environment variables, and any change to the specified stack.
6. Do not implement product features yet.

Exit gate:
- Repository has a clean initial commit.
- README explains setup and the product scope.
- No credentials or `.env` files are committed.

## Phase 1 — Local development foundation

Tasks:
1. Scaffold React + Vite + TypeScript frontend.
2. Scaffold Express + TypeScript API.
3. Configure strict TypeScript, formatting/linting, environment validation, and consistent error handling.
4. Add `/health` and readiness checks.
5. Add PostgreSQL connection and Drizzle migrations; use a local PostgreSQL installation or a managed development database with a free tier.
6. Create `.env.example` with names only and explain how to configure secrets locally.
7. Add CI for typecheck, lint, tests, build, and migration checks.
8. Add a small `/api/v1` convention and versioned response/error contract.

Exit gate:
- A new developer can follow the README and run web, API, and database locally.
- A clean database can be migrated from zero.
- Build and checks pass.
- No real secrets are in the repository.

## Phase 2 — Authentication and authorization

Tasks:
1. Implement registration, login, logout, current-user endpoint, email verification, forgot/reset password, and session revocation.
2. Use a mature server-side session library and PostgreSQL-backed session store for the browser app; use secure cookies, session rotation, CSRF protection, exact CORS origins, and rate limits.
3. Hash passwords with Argon2id or a vetted supported implementation. Never invent cryptography.
4. Add roles: customer, professional, admin. A professional may list multiple service categories.
5. Implement authorization in server/domain services; the frontend only hides unavailable actions for usability.
6. Add tests for IDOR, cross-user access, role escalation, CSRF, and session revocation.

Exit gate:
- Private API endpoints reject unauthenticated users.
- Changing record IDs never grants access to another user's private data.
- Admin routes are server-protected and audited.
- Reset and verification tokens are short-lived, single-use, and stored safely.

## Phase 3 — Design system and ReactBits selection

Tasks:
1. Establish design tokens, typography, spacing, buttons, fields, cards, status labels, dialogs, toast/alert patterns, and responsive breakpoints.
2. Browse https://reactbits.dev/ and select no more than a few components for the first version, such as a subtle landing hero effect or restrained background.
3. For each selected ReactBits component, document source/license, dependencies, bundle impact, accessibility, reduced-motion behavior, and intended page.
4. Prefer simple CSS for ordinary product interactions. Avoid heavy animated backgrounds on mobile and task-focused dashboards.
5. Build reusable marketplace-specific components yourself: professional card, service package, booking status, filter bar, form sections, and empty/error/loading states.
6. Keep the established Evently visual direction: cream/off-white, navy, coral/terracotta, teal, editorial serif heading, readable sans-serif body.

Exit gate:
- Mobile and desktop layouts are consistent.
- Keyboard focus, reduced motion, contrast, and semantic controls work.
- No visual dependency adds unnecessary cost or critical performance problems.

## Phase 4 — Professional profiles and discovery

Tasks:
1. Build professional profile, service categories, services/packages, indicative pricing or quote-only setting, service area, portfolio metadata, and public/private field rules.
2. Add safe image upload using object storage; enforce content type, file size, dimensions, ownership, and deletion behavior.
3. Build public profile pages with real database data.
4. Implement backend search, category filters, price range, service area, sort, and bounded pagination only for fields actually supported.
5. Start with PostgreSQL queries/full-text search. Avoid paid search APIs and external map APIs until validated need.
6. Add favorites if it fits the first release.

Exit gate:
- Search/filter tests verify actual backend behavior.
- Public APIs omit private fields.
- No fake rating, review count, availability, or verification data.
- No production upload stored on ephemeral server disk.

## Phase 5 — Event briefs and booking workflow

Tasks:
1. Build customer event brief with event type, date/time/timezone, location, estimated guest count, budget range, requested services, and notes.
2. Customer can request a booking from a professional.
3. Professional can accept, decline, or propose a change using explicit actions.
4. Define cancellation and completion rules before enabling them.
5. Store booking status history and durable in-app notifications.
6. Enforce transitions in a domain service and database transaction; use conditional updates or row locks for concurrent requests.
7. Make retry-sensitive creation idempotent or safely deduplicated.
8. Ensure all screens use real API/database state.

Exit gate:
- Invalid transitions are rejected server-side.
- Concurrent accept/cancel attempts cannot corrupt state.
- Duplicate submissions are handled safely.
- E2E tests cover customer request and professional response.
- No payment-success UI or payment claim exists.

## Phase 6 — Messaging, notifications, reviews, and reports

Tasks:
1. Implement persistent paginated messages and conversations.
2. Check conversation membership on every read/write.
3. Start with refresh/polling. Add WebSockets only when actual usage needs them.
4. Add in-app notifications for booking events and messages.
5. Add email for verification/reset and important events through a provider free tier if available.
6. Allow one review per eligible completed booking; enforce with a database constraint.
7. Add report submission and a basic moderation queue.
8. Do not implement attachments until secure upload and abuse handling exist.

Exit gate:
- Unauthorized conversation access is blocked.
- Ineligible/duplicate reviews are rejected.
- Email failure cannot undo a booking.
- Reports are persisted and reviewable.

## Phase 7 — Admin and trust operations

Tasks:
1. Build admin-only report queue, profile moderation, user suspension, and audited actions.
2. Define whether professionals need approval before public listing.
3. Add account deactivation/deletion and data retention workflow.
4. Add terms, privacy notice, community guidelines, and support contact before public launch.
5. Ensure administrative actions are attributable and never silently impersonate users.

Exit gate:
- Non-admin API calls fail even if sent manually.
- Admin actions create audit entries.
- Suspended/deactivated accounts behave consistently across UI and API.

## Phase 8 — Production hardening and launch

Tasks:
1. Choose hosting/database/storage based on actual current pricing, region, backup, idle, and usage limits.
2. Separate development, staging, and production credentials and data.
3. Configure HTTPS, secure headers, exact CORS, CSRF, rate limits, upload limits, and safe errors.
4. Add structured redacted logs, error monitoring, health checks, and alerting.
5. Run dependency/secret scans and security tests.
6. Load-test search, profile, booking, and message endpoints; tune from evidence.
7. Test database backup restoration.
8. Write deployment, rollback, support, and incident-response steps.

Exit gate:
- Staging deployment is repeatable.
- Restore from backup is verified.
- Critical security and user-journey tests pass.
- No known critical/high security issue remains without an explicitly approved mitigation.
- Actual monthly costs and quotas are documented.

## Phase 9 — Payments and monetization

Deferred until the booking workflow is dependable.

Tasks:
1. Decide commission model, refund/cancellation rules, invoicing/tax handling, and merchant-of-record responsibilities.
2. Verify current Razorpay requirements/fees and alternatives available in India.
3. Use provider-hosted checkout/tokenized payment flow; never store raw card details.
4. Verify signed webhooks and idempotency; browser redirects are not proof of payment.
5. Store payment/refund state separately from booking state and keep a reconciliation ledger.
6. Test failed payment, duplicate webhook, refund, and reconciliation.

Exit gate:
- Server-verified provider events are authoritative.
- Payment and booking states cannot contradict silently.
- Reconciliation is testable and support procedures exist.

## Low-cost defaults

- **Database:** PostgreSQL. Prefer an existing suitable free allowance during development; compare Neon and Supabase terms and region. Plan backups before real production data.
- **Frontend hosting:** Cloudflare Pages or Vercel free tier for a static Vite build, subject to current limits.
- **API hosting:** use an environment that supports a long-running Node/Express server. Do not assume a static host runs a conventional Express process.
- **Uploads:** object storage with quotas; never ephemeral local disk.
- **Email:** provider free tier for transactional messages, with a local development mail sink.
- **Search:** PostgreSQL.
- **Maps:** text-based service areas until distance search is essential.
- **Realtime:** polling initially.
- **Cache/queue:** none until metrics justify them.
- **AI API:** none required for core product workflows.

Free plans can pause, impose quotas, limit backups, or change. Verify current provider terms before production use.

## Definition of done for every task

- Real API/database behavior exists, or the feature is explicitly deferred.
- Server-side validation and authorization exist.
- Loading, empty, error, success, and permission-denied states are handled where applicable.
- Tests cover business rules and important negative cases.
- Typecheck, lint, build, and relevant tests were run; results are reported accurately.
- Every visible control works or is visibly disabled with a reason.
- No secrets or sensitive fields are exposed.
- Agent reports changed files, tests, setup steps, costs, known gaps, and exit-gate status.
