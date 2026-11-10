export interface OwnedFixtureRecord {
  id: string;
  ownerId: string;
}

export interface ServiceListingFixtureCleanupInput {
  userIds: readonly string[];
  profileIds: readonly OwnedFixtureRecord[];
  applicationIds: readonly OwnedFixtureRecord[];
  listingIds: readonly OwnedFixtureRecord[];
  auditIds: readonly OwnedFixtureRecord[];
}

export interface ServiceListingFixtureCleanupScope {
  userIds: string[];
  profiles: OwnedFixtureRecord[];
  applications: OwnedFixtureRecord[];
  listings: OwnedFixtureRecord[];
  audits: OwnedFixtureRecord[];
}

export interface ListingAuditCleanupPlan {
  auditIds: string[];
  listingIds: string[];
  retainedAudits: RetainedFixture[];
  retainedListings: RetainedFixture[];
}

export interface RetainedFixture {
  type: "user" | "profile" | "application" | "listing" | "audit";
  id: string;
  reason: string;
}

function uniqueOwnedRecords(
  records: readonly OwnedFixtureRecord[],
  allowedOwners: ReadonlySet<string>,
): OwnedFixtureRecord[] {
  const seen = new Set<string>();
  return records.filter(({ id, ownerId }) => {
    if (!allowedOwners.has(ownerId) || seen.has(id)) {
      return false;
    }
    seen.add(id);
    return true;
  });
}

export function createServiceListingFixtureCleanupScope(
  input: ServiceListingFixtureCleanupInput,
): ServiceListingFixtureCleanupScope {
  const userIds = [...new Set(input.userIds)];
  const userIdSet = new Set(userIds);
  const profiles = uniqueOwnedRecords(input.profileIds, userIdSet);
  const profileIdSet = new Set(profiles.map(({ id }) => id));

  return {
    userIds,
    profiles,
    applications: uniqueOwnedRecords(input.applicationIds, userIdSet),
    listings: uniqueOwnedRecords(input.listingIds, profileIdSet),
    audits: uniqueOwnedRecords(
      input.auditIds,
      new Set(input.listingIds.map(({ id }) => id)),
    ),
  };
}

export function planListingAuditCleanup(
  listings: readonly OwnedFixtureRecord[],
  existingAuditRows: readonly OwnedFixtureRecord[],
  trackedAuditIds: readonly OwnedFixtureRecord[],
): ListingAuditCleanupPlan {
  const listingIds = new Set(listings.map(({ id }) => id));
  const trackedAuditIdSet = new Set(
    trackedAuditIds
      .filter(({ ownerId }) => listingIds.has(ownerId))
      .map(({ id }) => id),
  );
  const trackedAuditsByListing = new Map<string, Set<string>>();
  for (const { id, ownerId } of trackedAuditIds) {
    if (!listingIds.has(ownerId)) {
      continue;
    }
    const auditIds = trackedAuditsByListing.get(ownerId) ?? new Set<string>();
    auditIds.add(id);
    trackedAuditsByListing.set(ownerId, auditIds);
  }

  const auditsByListing = new Map<string, Set<string>>();
  for (const { id, ownerId } of existingAuditRows) {
    if (!listingIds.has(ownerId)) {
      continue;
    }
    const auditIds = auditsByListing.get(ownerId) ?? new Set<string>();
    auditIds.add(id);
    auditsByListing.set(ownerId, auditIds);
  }

  const retainedListings: RetainedFixture[] = [];
  const retainedAudits: RetainedFixture[] = [];
  const deletableListingIds: string[] = [];
  for (const { id } of listings) {
    const auditIds = auditsByListing.get(id) ?? new Set<string>();
    const ownedAuditIds = trackedAuditsByListing.get(id) ?? new Set<string>();
    const untrackedAuditIds = [...auditIds].filter(
      (auditId) =>
        !trackedAuditIdSet.has(auditId) || !ownedAuditIds.has(auditId),
    );
    if (untrackedAuditIds.length > 0) {
      retainedListings.push({
        type: "listing",
        id,
        reason: `has ${untrackedAuditIds.length} audit record(s) without proven test-run ownership`,
      });
      for (const auditId of untrackedAuditIds) {
        retainedAudits.push({
          type: "audit",
          id: auditId,
          reason: `references retained listing ${id}; test-run ownership was not established`,
        });
      }
      continue;
    }
    deletableListingIds.push(id);
  }

  return {
    auditIds: [...trackedAuditIdSet].filter((id) =>
      [...auditsByListing.values()].some((ids) => ids.has(id)),
    ),
    listingIds: deletableListingIds,
    retainedAudits,
    retainedListings,
  };
}

export function trackCommittedListing(
  trackedListings: OwnedFixtureRecord[],
  result: { id: string } | "ineligible",
  ownerId: string,
): void {
  if (result !== "ineligible") {
    trackedListings.push({ id: result.id, ownerId });
  }
}

export function trackInsertedModerationAudit(
  trackedAuditIds: OwnedFixtureRecord[],
  auditId: string,
  listingId: string,
): void {
  trackedAuditIds.push({ id: auditId, ownerId: listingId });
}

export function formatRetainedFixtureReport(
  retainedFixtures: readonly RetainedFixture[],
): string {
  if (retainedFixtures.length === 0) {
    return "Fixture cleanup completed.";
  }
  const details = retainedFixtures
    .map(({ type, id, reason }) => `${type} ${id}: ${reason}`)
    .join("; ");
  return `Fixture cleanup incomplete; retained ${retainedFixtures.length} fixture record(s): ${details}`;
}

export interface IntegrationResourceStore {
  clear(): Promise<void>;
  shutdown(): Promise<void>;
}

export interface IntegrationTeardownResources {
  databaseVerified: boolean;
  cleanupDatabase(): Promise<void>;
  rateLimitStores: readonly IntegrationResourceStore[];
  closeSessionStore(): void | Promise<void>;
  closePool(): Promise<void>;
}

export interface ListingAttemptMatch {
  id: string;
  profileId: string;
}

export function reportAmbiguousListingRetention(
  listings: readonly ListingAttemptMatch[],
  auditRows: readonly { id: string; listingId: string | null }[],
): RetainedFixture[] {
  const listingIds = new Set(listings.map(({ id }) => id));
  const retained: RetainedFixture[] = listings.map(({ id }) => ({
    type: "listing",
    id,
    reason: "matches a test creation marker non-uniquely",
  }));
  for (const { id, listingId } of auditRows) {
    if (listingId && listingIds.has(listingId)) {
      retained.push({
        type: "audit",
        id,
        reason: `references ambiguous listing ${listingId}; listing is retained because marker recovery was non-unique`,
      });
    }
  }
  return retained;
}

export function resolveListingAttempt(
  ownerId: string,
  matches: readonly ListingAttemptMatch[],
): OwnedFixtureRecord | undefined {
  if (matches.length !== 1 || matches[0]?.profileId !== ownerId) {
    return undefined;
  }
  const [match] = matches;
  return match ? { id: match.id, ownerId } : undefined;
}

export async function teardownIntegrationResources(
  resources: IntegrationTeardownResources,
): Promise<void> {
  const errors: unknown[] = [];
  const attempt = async (operation: () => void | Promise<void>) => {
    try {
      await operation();
    } catch (error) {
      errors.push(error);
    }
  };

  if (resources.databaseVerified) {
    await attempt(resources.cleanupDatabase);
  }
  for (const store of resources.rateLimitStores) {
    if (resources.databaseVerified) {
      await attempt(() => store.clear());
    }
    await attempt(() => store.shutdown());
  }
  await attempt(resources.closeSessionStore);
  await attempt(resources.closePool);

  if (errors.length === 1) {
    throw errors[0];
  }
  if (errors.length > 1) {
    throw new AggregateError(errors, "Integration-test teardown failed.");
  }
}
