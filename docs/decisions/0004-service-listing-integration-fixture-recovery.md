# Service-listing integration fixture cleanup and recovery

## Current-run cleanup

Service-listing integration cleanup uses IDs generated for or returned by
inserts in that test process. User IDs are paired with the exact generated
fixture email; profile and application IDs are paired with their fixture
owner. Listing requests add a unique test marker to the fixture description.
The test-only repository adapter records the generated listing ID after the
creation transaction resolves, before the HTTP response is sent. Cleanup also
recovers a committed listing by matching that exact description and owner
profile if a response was lost. Ambiguous matches are retained and reported.
The cleanup scope rejects records whose owner is outside the current run's
tracked identities.

The moderation endpoint returns listing data, not audit IDs. The repository
accepts an optional internal audit-insert callback; the integration test supplies
it, and the repository passes the exact ID returned by the moderation audit
`INSERT ... RETURNING` within that transaction. Production construction supplies
no callback and API responses remain unchanged. The test does not infer
ownership using before/after snapshots, so concurrent audit inserts cannot be
mistaken for this run's row. Cleanup deletes only those exact tracked IDs after
rechecking their listing association. Each untracked audit row is reported by
its ID and reason, and its listing is retained; profile and user dependencies
are retained as needed to preserve the restrictive audit and moderator
foreign keys.

Related row deletion runs in one database transaction. Applications are
deleted only when their inserted ID and applicant belong to the run and no
audit or untracked type row references the application. Profiles are deleted
only when the run owns them and no untracked listing or profile-type row
remains. Fixture users are retained if deleting them could cascade to an
untracked profile, application, or account token, or alter a retained audit,
moderation, or application-review reference. Retained IDs and non-sensitive
reasons are included in an explicit incomplete-cleanup error.

If any transactional cleanup statement fails, the transaction rolls back and
the test runner receives the error. Database cleanup and rate-limit counter
clearing occur only after database identity verification. The service-listing
integration suite disables the rate-limit store's broad expired-counter
pruning and the session store's broad expired-session pruning. Rate-limit timer
shutdown, session-store close, and pool end are attempted regardless of
verification or other teardown failures; failures are collected and surfaced.
A process termination can leave fixture rows behind; the transaction protects
against partial committed cleanup, not against fixtures created before
termination.

The installed Vitest version is 5.0.5. In
`node_modules/vitest/dist/chunks/run.BPv-BBRv.js`, `runSuite` wraps the
`beforeAll` and suite-child execution in `try/finally`; its `finally` invokes
`afterAll` even when `beforeAll` fails (around lines 4054-4094 in that installed
distribution). The suite creates its stores before the hook and registers
`afterAll`; cleanup remains gated by the identity flag set only after
verification succeeds. This lifecycle claim is based on the installed runner
source, not on a PostgreSQL test run.

## Historical `listing-it-*` recovery plan

This plan is documentation only. It has not been executed. It requires separate
human approval and a fresh identity verification against the designated
verification database. Never run it against `evently`.

### Candidate identity and scope

The service-listing suite formats fixture addresses as
`listing-it-<UUID>-<fixture-name>@example.test`. The candidate predicate is:

```sql
SELECT id
FROM users
WHERE email LIKE 'listing-it-%@example.test'
  AND created_at < $1::timestamptz
```

Treat that predicate as a candidate selector, not deletion authority. First
bind `$1` to an explicitly approved historical cutoff; do not guess the value.
Capture the resulting IDs with a read-only inspection and have the operator
explicitly approve that exact ID set as the historical fixtures. All
subsequent record sets must be derived from those approved user IDs, then
reviewed before any separately approved deletion. Do not select by reviewer or
audit-actor identity.

The previously observed counts (19 users, 10 profiles, 9 listings, and zero
listing audits, attributable admin audits, related applications, sessions,
tokens, and non-fixture moderated listings) are historical indicators only;
they must be rechecked immediately before any recovery.

### Dependent records and deletion order

Recompute and review these relationships using only the approved user IDs:

1. `professional_profiles.user_id` identifies fixture profiles.
   `professional_profile_types.profile_id` references profiles with cascade.
2. `service_listings.professional_profile_id` identifies fixture-owned
   listings. Do not include listings outside these exact profiles.
   `service_listings.moderation_hidden_by_user_id` references a user with
   `RESTRICT`.
3. `admin_audit_logs.service_listing_id` references a listing with `RESTRICT`.
   Only audit rows referencing the exact reviewed fixture listing IDs may be
   considered listing dependents. Preserve other admin audit rows, including
   records that merely name a fixture user as actor or target.
4. `provider_applications.user_id` references users with cascade;
   `provider_applications.reviewer_user_id` references users with `RESTRICT`.
   `provider_application_types.application_id` cascades from applications.
   Consider only applications whose applicant is an approved fixture user.
   If a fixture user reviewed an application for another applicant, stop and
   retain that user; do not delete the unrelated application.
5. `account_tokens.user_id` cascades from users. `sessions` has no user foreign
   key; its JSON `sess.userId` value is the relationship. Recheck both and
   include only rows belonging to approved fixture user IDs.
6. `admin_audit_logs.actor_user_id`, `target_user_id`, and
   `provider_application_id` use `SET NULL`. Preserve any such audit row not
   associated with a reviewed fixture listing; if it would be changed by
   deleting a fixture user/application, stop and retain the referenced fixture
   identity or application.

If deletion is separately approved after the checks, the order is: exact
listing audit rows; exact fixture-owned listings; exact applicant-owned
provider applications and their application-type rows; exact fixture profiles
and their profile-type rows; fixture-owned sessions and account tokens; then
only fixture users with no remaining external/restrictive references. Respect
the schema's cascades where applicable. Execute the complete sequence in one
transaction and abort on any mismatch or nonzero unexpected relationship
count. Do not delete reviewer-linked applications or actor-linked audits.

`rate_limit_counters` stores hashes of per-run keys and has no user foreign key.
It cannot be safely associated with the historical user IDs from this
predicate alone; leave those counters untouched unless their exact historical
scope can be independently established.

### Required aggregate checks

Before any separately approved deletion, capture counts only (no emails,
tokens, sessions, or full rows) for: approved fixture users; their profiles
and profile types; listings on those exact profiles; audit rows on those exact
listings; applications where the fixture IDs are applicants; application
types for those applications; applications where fixture IDs are reviewers;
admin audit rows where fixture IDs are actor/target or referenced by those
applications; sessions whose JSON user ID matches; account tokens for those
users; and non-fixture listings whose moderator is a fixture user.

Run the same parameterized aggregate query before and after the approved
operation, passing only the reviewed user ID array as `$1`:

```sql
WITH fixture_users AS (
  SELECT unnest($1::uuid[]) AS id
),
fixture_profiles AS (
  SELECT id FROM professional_profiles
  WHERE user_id IN (SELECT id FROM fixture_users)
),
fixture_applications AS (
  SELECT id FROM provider_applications
  WHERE user_id IN (SELECT id FROM fixture_users)
),
fixture_listings AS (
  SELECT sl.id
  FROM service_listings sl
  JOIN professional_profiles pp ON pp.id = sl.professional_profile_id
  WHERE pp.id IN (SELECT id FROM fixture_profiles)
),
counts AS (
  SELECT 'users' AS relation, count(*)::bigint AS row_count
  FROM users WHERE id IN (SELECT id FROM fixture_users)
  UNION ALL
  SELECT 'professional_profiles', count(*)::bigint
  FROM professional_profiles WHERE id IN (SELECT id FROM fixture_profiles)
  UNION ALL
  SELECT 'professional_profile_types', count(*)::bigint
  FROM professional_profile_types WHERE profile_id IN (SELECT id FROM fixture_profiles)
  UNION ALL
  SELECT 'service_listings', count(*)::bigint
  FROM service_listings WHERE id IN (SELECT id FROM fixture_listings)
  UNION ALL
  SELECT 'listing_audit_logs', count(*)::bigint
  FROM admin_audit_logs WHERE service_listing_id IN (SELECT id FROM fixture_listings)
  UNION ALL
  SELECT 'applicant_provider_applications', count(*)::bigint
  FROM provider_applications WHERE user_id IN (SELECT id FROM fixture_users)
  UNION ALL
  SELECT 'application_types', count(*)::bigint
  FROM provider_application_types
  WHERE application_id IN (SELECT id FROM fixture_applications)
  UNION ALL
  SELECT 'applications_reviewed_by_fixture_users', count(*)::bigint
  FROM provider_applications WHERE reviewer_user_id IN (SELECT id FROM fixture_users)
  UNION ALL
  SELECT 'admin_audits_attributed_to_fixture_users', count(*)::bigint
  FROM admin_audit_logs
  WHERE actor_user_id IN (SELECT id FROM fixture_users)
     OR target_user_id IN (SELECT id FROM fixture_users)
     OR actor_user_id_snapshot IN (SELECT id FROM fixture_users)
     OR provider_application_id IN (SELECT id FROM fixture_applications)
     OR service_listing_id IN (SELECT id FROM fixture_listings)
  UNION ALL
  SELECT 'sessions', count(*)::bigint
  FROM sessions WHERE sess->>'userId' IN (
    SELECT id::text FROM fixture_users
  )
  UNION ALL
  SELECT 'account_tokens', count(*)::bigint
  FROM account_tokens WHERE user_id IN (SELECT id FROM fixture_users)
  UNION ALL
  SELECT 'nonfixture_listings_using_fixture_moderators', count(*)::bigint
  FROM service_listings sl
  JOIN professional_profiles pp ON pp.id = sl.professional_profile_id
  WHERE sl.moderation_hidden_by_user_id IN (SELECT id FROM fixture_users)
    AND pp.user_id NOT IN (SELECT id FROM fixture_users)
)
SELECT relation, row_count FROM counts ORDER BY relation;
```

Stop if any reviewer-linked application belongs to a non-fixture applicant,
any non-fixture listing names a fixture moderator, or any unrelated audit row
would be altered by the deletion. After a separately approved transaction,
repeat the same aggregate checks against the same approved ID set. Expected
remaining counts are zero for records explicitly approved for removal; any
retained user must be explained by its remaining protected reference. Do not
use a table-wide delete or rerun integration tests as a cleanup mechanism.
