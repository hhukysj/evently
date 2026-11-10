import type { ServiceListingInput } from "@evently/shared";
import { PostgresServiceListingRepository } from "./repository.js";

type Database = ConstructorParameters<
  typeof PostgresServiceListingRepository
>[0];

export class TrackingServiceListingRepository extends PostgresServiceListingRepository {
  constructor(
    database: Database,
    private readonly profileIdForUser: (userId: string) => string | undefined,
    private readonly onListingTracked: (
      listingId: string,
      profileId: string,
    ) => void,
    onModerationAuditInserted: (auditId: string, listingId: string) => void,
  ) {
    super(database, onModerationAuditInserted);
  }

  override async create(userId: string, input: ServiceListingInput) {
    const result = await super.create(userId, input);
    const profileId = this.profileIdForUser(userId);
    if (result !== "ineligible" && profileId) {
      this.onListingTracked(result.id, profileId);
    }
    return result;
  }
}
