# Provider onboarding and approval

**Status:** implemented for Phase 3 Milestone 1; pending owner review
**Migrations:** `apps/api/drizzle/0004_giant_next_avengers.sql`,
`apps/api/drizzle/0005_icy_stone_men.sql`, and
`apps/api/drizzle/0006_known_eternity.sql`

## Decisions

- Marketplace foundation is Phase 3. The former design-system phase is Phase 4; later phases are renumbered in `PHASE_PLAN.md`.
- Provider types are controlled PostgreSQL enum values: event organizer, event manager, artist/performer, and vendor/service provider. Application and profile associations use separate join tables with composite primary keys. This supports multiple types and prevents duplicates without treating provider types as service categories.
- Only active, email-verified customer accounts may apply. The applicant identity comes from the session. One pending application per user is enforced by a partial unique index. Rejected users may submit another application; prior records remain.
- Admin approval/rejection is a row-locked transaction. Approval promotes the user, increments `auth_version`, deletes stored sessions, creates a draft profile and its provider-type associations, and writes an audit record. The authorization-version check rejects a session created concurrently using a stale version.
- Slugs are generated from a normalized display name plus the applicant's immutable UUID. The database unique index remains authoritative. Slugs are not editable.
- Applicants can see their latest status but not reviewer identity or rejection notes. Reviewers receive explicit application DTOs; no user, password, session, or authentication record is serialized.
- The draft profile copies the submitted display name, service description, and text location. Profile edits are allowlisted. There is no public profile or discovery route in this milestone.
- Application details are limited to business/display name, a short service description, selected provider types, city, region/state, and country. No personal contact data is collected because the account already has a verified email.
- Location remains text-only. Uploads, service listings, public publishing, bookings, and payments are deferred.
- No dependencies or external providers were added; operating cost is unchanged.

## Migration and compatibility

Migration `0004` is additive and does not alter historical migrations. It adds controlled provider/application/profile enums, application/profile tables and constraints, audit linkage, and the user authorization version. Migration `0005` corrected the review-state check while allowing reviewer deletion. Migration `0006` restores the reviewer identity invariant, requires a nonblank bounded rejection reason, and restricts reviewer deletion while reviewed applications reference that account. The migrations create no sample data.

Local PostgreSQL inspection before migration found no user rows, so there were no existing professional accounts or profiles to backfill.

Before applying this migration to any non-local deployment, operators must inspect existing `users.role='professional'` rows. No automatic profiles are fabricated: if such accounts exist, stop deployment and plan a reviewed, user-informed compatibility/backfill process before enabling the new professional routes.

## Security notes

- Application/review endpoints reuse PostgreSQL-backed sessions, active-user authorization, exact-origin and CSRF checks, strict Zod input validation, and shared PostgreSQL rate limiting.
- Approval/rejection audit rows identify the actor, target user, application, and action. Rejection reason is stored only on the private application record.
- A unique profile-owner constraint and unique slug constraint are enforced by PostgreSQL. Approval failures roll back role changes, session deletion, profile creation, application status, and audit insertion together.
- Existing admin provisioning remains outside this flow. Admin privileges must be assigned by a trusted operator and are never accepted from client input.
