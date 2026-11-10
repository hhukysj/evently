# Service listing state and audit

**Status:** Implemented scope includes the listing foundation, provider management API and UI, admin listing queue and moderation UI, public listing APIs, and owner-visible moderation reasons. Customer-facing discovery/detail UI and broader Phase 5 profile, portfolio, and upload work remain pending.
**Migrations:** `apps/api/drizzle/0007_dusty_falcon.sql`, `apps/api/drizzle/0008_heavy_the_spike.sql`

## Implementation scope and limitations

- The provider-facing workflow supports listing creation, owner listing reads with bounded pagination, edits, and publish/unpublish controls. Mutations use ETags and version checks; editing a published listing requires explicit confirmation.
- Administrators can browse a bounded, paginated listing queue filtered by publication status, moderation status, category, and city; open listing details; and hide or restore listings. Queue/detail routes require admin authorization. Hide/restore retain the existing row lock, optimistic version check, audit insert, and single-transaction behavior.
- Providers can read the moderation reason only for listings they own. The provider dashboard displays it for hidden listings. The public listing search/detail DTOs continue to omit moderation state and reason.
- Public listing search and detail are API capabilities. A customer-facing discovery or listing-detail UI is not implemented.
- The admin listing queue is not a full audit-history screen, and profile/portfolio moderation workflows are not implemented.
- Search currently supports the filters defined by the shared contract. Keyword, price-range, availability, ratings, and sorting workflows are not established by this implementation.
- This work does not complete public professional profiles, portfolio or image uploads, bookings, payments, or production readiness.
- The provider service-listing implementation was delivered ahead of its original Phase 5 placement. Phase 5 retains the remaining profile, discovery UI, and upload work.

## Decisions

- Provider publication intent and admin moderation are separate state dimensions. Providers move a listing between `draft` and `published`; administrators move moderation between `visible` and `hidden`.
- New listings default to `draft` and `visible`. A listing is eligible for public discovery only when it is `published` and `visible`; public queries must also require an active user with the professional role. Suspended and deactivated providers retain their listing data, but their listings are excluded from public results. Reactivation may make previously published, visible listings eligible again.
- Admin restore changes only moderation state and clears the current hidden-by, hidden-at, and reason metadata. It must not publish a draft. Provider publish/unpublish changes only publication state and cannot clear moderation state.
- Hiding requires a nonblank reason, reviewer identity, and timestamp. Each hide/restore audit event records its action, actor ID snapshot, timestamp, listing ID, and optional reason. Listing references in the audit table use `ON DELETE RESTRICT`; audited listings must be retained or deactivated rather than hard-deleted. The actor snapshot preserves identity if the account is later removed under the existing audit foreign-key behavior.
- Optional region input is normalized: omitted or null remains null, and blank or whitespace-only strings become null. Nonblank values are trimmed and bounded, matching the database constraint.
- Listing categories remain the eight fixed seeded categories. They are separate from provider types. Pricing remains integer INR paise; quote-only uses a null amount, while fixed and starting-at require a nonnegative amount, including zero.

## API concurrency and transitions

- Every listing has a positive, monotonically increasing version. Provider and admin reads return a strong ETag in the form `"service-listing:<listing-id>:v<version>"`. All listing edits and publication/moderation transitions require the exact current `If-Match` value and increment the version atomically. Missing preconditions return `428`; stale or malformed preconditions return `412`.
- Publishing is a state transition: draft to published is allowed only for an eligible provider and a visible listing. Publishing an already-published listing is a `409` conflict. A hidden listing cannot be published. Unpublishing a published listing returns it to draft without changing moderation; an owner may unpublish a hidden published listing. After admin restore, a draft remains a draft and must be explicitly published.
- Editing a published listing requires `X-Confirm-Published-Edit: true` and a current `If-Match`. This is an explicit confirmation signal, not a separate state transition. Provider payloads cannot change owner, publication, moderation, or audit fields.
- Listing management requires an active professional user with an approved provider application and an existing profile. Public queries enforce, in PostgreSQL, published and visible listing states plus active professional status and an approved application. Public responses are explicit projections and do not include account IDs, contact/authentication fields, moderation metadata, or audit data.
- Admin reads expose an ETag and only listing/moderation fields needed for moderation. Hide/restore lock the listing, compare its version, change moderation state, increment the version, and insert the corresponding audit row in the same database transaction. A restore only changes moderation state.
