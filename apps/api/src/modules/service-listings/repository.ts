import { and, count, desc, eq, exists, ilike, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../../db/schema.js";
import {
  adminAuditLogs,
  professionalProfiles,
  providerApplications,
  serviceCategories,
  serviceListings,
  users,
} from "../../db/schema.js";
import type {
  AdminServiceListingQuery,
  ProviderServiceListingQuery,
  PublicServiceListingQuery,
  ServiceListingInput,
  ServiceListingPatch,
} from "@evently/shared";

type Database = NodePgDatabase<typeof schema>;
type Listing = typeof serviceListings.$inferSelect;

interface ModerationTransactionOutcome {
  result: ListingMutationResult;
  audit?: { id: string; listingId: string };
}

export interface OwnerServiceListing {
  id: string;
  categorySlug: string;
  title: string;
  description: string;
  city: string;
  region: string | null;
  pricingMethod: Listing["pricingMethod"];
  priceAmountPaise: number | null;
  currency: string;
  publicationStatus: Listing["publicationStatus"];
  moderationStatus: Listing["moderationStatus"];
  moderationReason: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface PublicServiceListing {
  id: string;
  title: string;
  description: string;
  category: { slug: string; name: string };
  city: string;
  region: string | null;
  pricingMethod: Listing["pricingMethod"];
  priceAmountPaise: number | null;
  currency: string;
  provider: {
    displayName: string;
    slug: string;
    headline: string | null;
  };
}

export interface AdminServiceListing {
  id: string;
  category: { slug: string; name: string };
  title: string;
  city: string;
  region: string | null;
  pricingMethod: Listing["pricingMethod"];
  priceAmountPaise: number | null;
  currency: string;
  publicationStatus: Listing["publicationStatus"];
  moderationStatus: Listing["moderationStatus"];
  moderationReason: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  provider: { displayName: string; slug: string };
}

export interface ListingPage {
  listings: PublicServiceListing[];
  total: number;
}

export interface AdminListingPage {
  listings: AdminServiceListing[];
  total: number;
}

export type ListingMutationResult =
  | { type: "success"; listing: OwnerServiceListing }
  | { type: "missing" }
  | { type: "not_owner" }
  | { type: "ineligible" }
  | { type: "actor_ineligible" }
  | { type: "stale" }
  | { type: "hidden" }
  | { type: "confirmation_required" }
  | { type: "invalid_state" };

function ownerListing(listing: Listing): OwnerServiceListing {
  return {
    id: listing.id,
    categorySlug: listing.categorySlug,
    title: listing.title,
    description: listing.description,
    city: listing.city,
    region: listing.region,
    pricingMethod: listing.pricingMethod,
    priceAmountPaise: listing.priceAmountPaise,
    currency: listing.currency,
    publicationStatus: listing.publicationStatus,
    moderationStatus: listing.moderationStatus,
    moderationReason: listing.moderationReason,
    version: listing.version,
    createdAt: listing.createdAt,
    updatedAt: listing.updatedAt,
  };
}

export class PostgresServiceListingRepository {
  constructor(
    private readonly database: Database,
    private readonly onModerationAuditInserted?: (
      auditId: string,
      listingId: string,
    ) => void,
  ) {}

  async listOwn(
    userId: string,
    query: ProviderServiceListingQuery,
  ): Promise<
    { listings: OwnerServiceListing[]; total: number } | "ineligible"
  > {
    return this.database.transaction(async (transaction) => {
      const [eligibleUser] = await transaction
        .select({ id: users.id })
        .from(users)
        .where(
          and(
            eq(users.id, userId),
            eq(users.role, "professional"),
            eq(users.status, "active"),
          ),
        )
        .for("update");
      if (!eligibleUser) {
        return "ineligible";
      }

      const [profile] = await transaction
        .select({ id: professionalProfiles.id })
        .from(professionalProfiles)
        .innerJoin(users, eq(users.id, professionalProfiles.userId))
        .where(
          and(
            eq(professionalProfiles.userId, userId),
            exists(
              transaction
                .select({ one: sql`1` })
                .from(providerApplications)
                .where(
                  and(
                    eq(providerApplications.userId, users.id),
                    eq(providerApplications.status, "approved"),
                  ),
                ),
            ),
          ),
        )
        .limit(1);
      if (!profile) {
        return "ineligible";
      }

      const [totalResult] = await transaction
        .select({ total: count() })
        .from(serviceListings)
        .where(eq(serviceListings.professionalProfileId, profile.id));
      const listings = await transaction
        .select()
        .from(serviceListings)
        .where(eq(serviceListings.professionalProfileId, profile.id))
        .orderBy(desc(serviceListings.createdAt), desc(serviceListings.id))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize);
      return {
        listings: listings.map(ownerListing),
        total: totalResult?.total ?? 0,
      };
    });
  }

  async create(
    userId: string,
    input: ServiceListingInput,
  ): Promise<OwnerServiceListing | "ineligible"> {
    return this.database.transaction(async (transaction) => {
      const [eligibleUser] = await transaction
        .select({ id: users.id })
        .from(users)
        .where(
          and(
            eq(users.id, userId),
            eq(users.role, "professional"),
            eq(users.status, "active"),
          ),
        )
        .for("update");
      if (!eligibleUser) {
        return "ineligible";
      }
      const [profile] = await transaction
        .select({ id: professionalProfiles.id })
        .from(professionalProfiles)
        .innerJoin(users, eq(users.id, professionalProfiles.userId))
        .where(
          and(
            eq(professionalProfiles.userId, userId),
            exists(
              transaction
                .select({ one: sql`1` })
                .from(providerApplications)
                .where(
                  and(
                    eq(providerApplications.userId, users.id),
                    eq(providerApplications.status, "approved"),
                  ),
                ),
            ),
          ),
        )
        .limit(1);
      if (!profile) {
        return "ineligible";
      }

      const [listing] = await transaction
        .insert(serviceListings)
        .values({
          professionalProfileId: profile.id,
          categorySlug: input.categorySlug,
          title: input.title,
          description: input.description,
          city: input.city,
          region: input.region ?? null,
          pricingMethod: input.pricingMethod,
          priceAmountPaise: input.priceAmountPaise,
        })
        .returning();
      if (!listing) {
        throw new Error("Service listing insert returned no record");
      }
      return ownerListing(listing);
    });
  }

  async findOwn(
    userId: string,
    listingId: string,
  ): Promise<OwnerServiceListing | "ineligible" | undefined> {
    return this.database.transaction(async (transaction) => {
      const [eligibleUser] = await transaction
        .select({ id: users.id })
        .from(users)
        .where(
          and(
            eq(users.id, userId),
            eq(users.role, "professional"),
            eq(users.status, "active"),
          ),
        )
        .for("update");
      if (!eligibleUser) {
        return "ineligible";
      }

      const [profile] = await transaction
        .select({ id: professionalProfiles.id })
        .from(professionalProfiles)
        .innerJoin(users, eq(users.id, professionalProfiles.userId))
        .where(
          and(
            eq(professionalProfiles.userId, userId),
            exists(
              transaction
                .select({ one: sql`1` })
                .from(providerApplications)
                .where(
                  and(
                    eq(providerApplications.userId, users.id),
                    eq(providerApplications.status, "approved"),
                  ),
                ),
            ),
          ),
        )
        .limit(1);
      if (!profile) {
        return "ineligible";
      }
      const [listing] = await transaction
        .select()
        .from(serviceListings)
        .where(
          and(
            eq(serviceListings.id, listingId),
            eq(serviceListings.professionalProfileId, profile.id),
          ),
        )
        .limit(1);
      return listing ? ownerListing(listing) : undefined;
    });
  }

  async findForAdmin(
    listingId: string,
  ): Promise<OwnerServiceListing | undefined> {
    const [listing] = await this.database
      .select()
      .from(serviceListings)
      .where(eq(serviceListings.id, listingId))
      .limit(1);
    return listing ? ownerListing(listing) : undefined;
  }

  async listForAdmin(
    query: AdminServiceListingQuery,
  ): Promise<AdminListingPage> {
    const filters = this.adminFilters(query);
    const [totalResult, rows] = await Promise.all([
      this.database
        .select({ total: count() })
        .from(serviceListings)
        .where(filters),
      this.database
        .select({
          listing: serviceListings,
          categorySlug: serviceCategories.slug,
          categoryName: serviceCategories.name,
          providerDisplayName: professionalProfiles.displayName,
          providerSlug: professionalProfiles.slug,
        })
        .from(serviceListings)
        .innerJoin(
          professionalProfiles,
          eq(professionalProfiles.id, serviceListings.professionalProfileId),
        )
        .innerJoin(
          serviceCategories,
          eq(serviceCategories.slug, serviceListings.categorySlug),
        )
        .where(filters)
        .orderBy(desc(serviceListings.createdAt), desc(serviceListings.id))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize),
    ]);

    return {
      total: totalResult[0]?.total ?? 0,
      listings: rows.map(
        ({
          listing,
          categorySlug,
          categoryName,
          providerDisplayName,
          providerSlug,
        }) => ({
          id: listing.id,
          category: { slug: categorySlug, name: categoryName },
          title: listing.title,
          city: listing.city,
          region: listing.region,
          pricingMethod: listing.pricingMethod,
          priceAmountPaise: listing.priceAmountPaise,
          currency: listing.currency,
          publicationStatus: listing.publicationStatus,
          moderationStatus: listing.moderationStatus,
          moderationReason: listing.moderationReason,
          version: listing.version,
          createdAt: listing.createdAt,
          updatedAt: listing.updatedAt,
          provider: { displayName: providerDisplayName, slug: providerSlug },
        }),
      ),
    };
  }

  async updateOwn(
    userId: string,
    listingId: string,
    expectedVersion: number,
    input: ServiceListingPatch,
    confirmPublishedEdit: boolean,
  ): Promise<ListingMutationResult> {
    return this.database.transaction(async (transaction) => {
      const current = await this.lockOwnListing(transaction, userId, listingId);
      if (current.type !== "found") {
        return current;
      }
      if (current.listing.version !== expectedVersion) {
        return { type: "stale" };
      }
      if (
        current.listing.publicationStatus === "published" &&
        !confirmPublishedEdit
      ) {
        return { type: "confirmation_required" };
      }

      const [listing] = await transaction
        .update(serviceListings)
        .set({
          ...input,
          updatedAt: new Date(),
          version: current.listing.version + 1,
        })
        .where(
          and(
            eq(serviceListings.id, listingId),
            eq(serviceListings.professionalProfileId, current.profileId),
            eq(serviceListings.version, expectedVersion),
          ),
        )
        .returning();
      if (!listing) {
        return { type: "stale" };
      }
      return { type: "success", listing: ownerListing(listing) };
    });
  }

  async transitionOwn(
    userId: string,
    listingId: string,
    expectedVersion: number,
    action: "publish" | "unpublish",
  ): Promise<ListingMutationResult> {
    return this.database.transaction(async (transaction) => {
      const current = await this.lockOwnListing(transaction, userId, listingId);
      if (current.type !== "found") {
        return current;
      }
      const listing = current.listing;
      if (listing.version !== expectedVersion) {
        return { type: "stale" };
      }
      if (action === "publish") {
        if (listing.moderationStatus === "hidden") {
          return { type: "hidden" };
        }
        if (listing.publicationStatus !== "draft") {
          return { type: "invalid_state" };
        }
      } else if (listing.publicationStatus !== "published") {
        return { type: "invalid_state" };
      }

      const [updated] = await transaction
        .update(serviceListings)
        .set({
          publicationStatus: action === "publish" ? "published" : "draft",
          updatedAt: new Date(),
          version: listing.version + 1,
        })
        .where(
          and(
            eq(serviceListings.id, listingId),
            eq(serviceListings.professionalProfileId, current.profileId),
            eq(serviceListings.version, expectedVersion),
            ...(action === "publish"
              ? [eq(serviceListings.moderationStatus, "visible")]
              : []),
            eq(
              serviceListings.publicationStatus,
              action === "publish" ? "draft" : "published",
            ),
          ),
        )
        .returning();
      if (!updated) {
        return { type: "stale" };
      }
      return { type: "success", listing: ownerListing(updated) };
    });
  }

  async moderate(
    listingId: string,
    actorUserId: string,
    expectedVersion: number,
    action: "hide" | "restore",
    reason?: string,
  ): Promise<ListingMutationResult> {
    const outcome = await this.database.transaction(
      async (transaction): Promise<ModerationTransactionOutcome> => {
        const [actor] = await transaction
          .select({ id: users.id })
          .from(users)
          .where(
            and(
              eq(users.id, actorUserId),
              eq(users.role, "admin"),
              eq(users.status, "active"),
            ),
          )
          .for("update");
        if (!actor) {
          return { result: { type: "actor_ineligible" } };
        }

        const [listing] = await transaction
          .select()
          .from(serviceListings)
          .where(eq(serviceListings.id, listingId))
          .for("update");
        if (!listing) {
          return { result: { type: "missing" } };
        }
        if (listing.version !== expectedVersion) {
          return { result: { type: "stale" } };
        }
        if (
          (action === "hide" && listing.moderationStatus !== "visible") ||
          (action === "restore" && listing.moderationStatus !== "hidden")
        ) {
          return { result: { type: "invalid_state" } };
        }

        const now = new Date();
        const [updated] = await transaction
          .update(serviceListings)
          .set({
            moderationStatus: action === "hide" ? "hidden" : "visible",
            moderationHiddenByUserId: action === "hide" ? actorUserId : null,
            moderationHiddenAt: action === "hide" ? now : null,
            moderationReason: action === "hide" ? reason! : null,
            updatedAt: now,
            version: listing.version + 1,
          })
          .where(
            and(
              eq(serviceListings.id, listingId),
              eq(serviceListings.version, expectedVersion),
              eq(
                serviceListings.moderationStatus,
                action === "hide" ? "visible" : "hidden",
              ),
            ),
          )
          .returning();
        if (!updated) {
          return { result: { type: "stale" } };
        }

        const [audit] = await transaction
          .insert(adminAuditLogs)
          .values({
            actorUserId,
            actorUserIdSnapshot: actorUserId,
            serviceListingId: listingId,
            serviceListingReason: action === "hide" ? reason! : null,
            action:
              action === "hide"
                ? "hide_service_listing"
                : "restore_service_listing",
            createdAt: now,
          })
          .returning({ id: adminAuditLogs.id });
        if (!audit) {
          throw new Error(
            "Service listing moderation audit insert returned no record",
          );
        }
        return {
          result: { type: "success", listing: ownerListing(updated) },
          audit: { id: audit.id, listingId },
        };
      },
    );

    if (outcome.audit) {
      this.onModerationAuditInserted?.(
        outcome.audit.id,
        outcome.audit.listingId,
      );
    }
    return outcome.result;
  }

  async listPublic(query: PublicServiceListingQuery): Promise<ListingPage> {
    const filters = this.publicFilters(query);
    const [totalResult, rows] = await Promise.all([
      this.database
        .select({ total: count() })
        .from(serviceListings)
        .innerJoin(
          professionalProfiles,
          eq(professionalProfiles.id, serviceListings.professionalProfileId),
        )
        .innerJoin(users, eq(users.id, professionalProfiles.userId))
        .where(filters),
      this.database
        .select({
          listing: serviceListings,
          categorySlug: serviceCategories.slug,
          categoryName: serviceCategories.name,
          providerDisplayName: professionalProfiles.displayName,
          providerSlug: professionalProfiles.slug,
          providerHeadline: professionalProfiles.headline,
        })
        .from(serviceListings)
        .innerJoin(
          professionalProfiles,
          eq(professionalProfiles.id, serviceListings.professionalProfileId),
        )
        .innerJoin(users, eq(users.id, professionalProfiles.userId))
        .innerJoin(
          serviceCategories,
          eq(serviceCategories.slug, serviceListings.categorySlug),
        )
        .where(filters)
        .orderBy(desc(serviceListings.createdAt), desc(serviceListings.id))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize),
    ]);

    return {
      total: totalResult[0]?.total ?? 0,
      listings: rows.map(
        ({
          listing,
          categorySlug,
          categoryName,
          providerDisplayName,
          providerSlug,
          providerHeadline,
        }) => ({
          id: listing.id,
          title: listing.title,
          description: listing.description,
          category: { slug: categorySlug, name: categoryName },
          city: listing.city,
          region: listing.region,
          pricingMethod: listing.pricingMethod,
          priceAmountPaise: listing.priceAmountPaise,
          currency: listing.currency,
          provider: {
            displayName: providerDisplayName,
            slug: providerSlug,
            headline: providerHeadline,
          },
        }),
      ),
    };
  }

  async findPublic(
    listingId: string,
  ): Promise<PublicServiceListing | undefined> {
    const [row] = await this.database
      .select({
        listing: serviceListings,
        categorySlug: serviceCategories.slug,
        categoryName: serviceCategories.name,
        providerDisplayName: professionalProfiles.displayName,
        providerSlug: professionalProfiles.slug,
        providerHeadline: professionalProfiles.headline,
      })
      .from(serviceListings)
      .innerJoin(
        professionalProfiles,
        eq(professionalProfiles.id, serviceListings.professionalProfileId),
      )
      .innerJoin(users, eq(users.id, professionalProfiles.userId))
      .innerJoin(
        serviceCategories,
        eq(serviceCategories.slug, serviceListings.categorySlug),
      )
      .where(
        and(
          this.publicFilters({ page: 1, pageSize: 1 }),
          eq(serviceListings.id, listingId),
        ),
      )
      .limit(1);
    return row
      ? {
          id: row.listing.id,
          title: row.listing.title,
          description: row.listing.description,
          category: { slug: row.categorySlug, name: row.categoryName },
          city: row.listing.city,
          region: row.listing.region,
          pricingMethod: row.listing.pricingMethod,
          priceAmountPaise: row.listing.priceAmountPaise,
          currency: row.listing.currency,
          provider: {
            displayName: row.providerDisplayName,
            slug: row.providerSlug,
            headline: row.providerHeadline,
          },
        }
      : undefined;
  }

  private publicFilters(query: PublicServiceListingQuery) {
    const conditions = [
      eq(serviceListings.publicationStatus, "published"),
      eq(serviceListings.moderationStatus, "visible"),
      eq(users.status, "active"),
      eq(users.role, "professional"),
      exists(
        this.database
          .select({ one: sql`1` })
          .from(providerApplications)
          .where(
            and(
              eq(providerApplications.userId, users.id),
              eq(providerApplications.status, "approved"),
            ),
          ),
      ),
    ];
    if (query.categorySlug) {
      conditions.push(eq(serviceListings.categorySlug, query.categorySlug));
    }
    if (query.city) {
      conditions.push(ilike(serviceListings.city, query.city));
    }
    if (query.region) {
      conditions.push(ilike(serviceListings.region, query.region));
    }
    if (query.pricingMethod) {
      conditions.push(eq(serviceListings.pricingMethod, query.pricingMethod));
    }
    return and(...conditions);
  }

  private adminFilters(query: AdminServiceListingQuery) {
    const conditions = [];
    if (query.publicationStatus) {
      conditions.push(
        eq(serviceListings.publicationStatus, query.publicationStatus),
      );
    }
    if (query.moderationStatus) {
      conditions.push(
        eq(serviceListings.moderationStatus, query.moderationStatus),
      );
    }
    if (query.categorySlug) {
      conditions.push(eq(serviceListings.categorySlug, query.categorySlug));
    }
    if (query.city) {
      conditions.push(ilike(serviceListings.city, query.city));
    }
    return conditions.length > 0 ? and(...conditions) : undefined;
  }

  private async lockOwnListing(
    transaction: Parameters<Parameters<Database["transaction"]>[0]>[0],
    userId: string,
    listingId: string,
  ): Promise<
    | { type: "found"; listing: Listing; profileId: string }
    | { type: "missing" | "not_owner" | "ineligible" }
  > {
    const [eligibleUser] = await transaction
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.id, userId),
          eq(users.role, "professional"),
          eq(users.status, "active"),
        ),
      )
      .for("update");
    if (!eligibleUser) {
      return { type: "ineligible" };
    }

    const [profile] = await transaction
      .select({ id: professionalProfiles.id })
      .from(professionalProfiles)
      .innerJoin(users, eq(users.id, professionalProfiles.userId))
      .where(
        and(
          eq(professionalProfiles.userId, userId),
          exists(
            transaction
              .select({ one: sql`1` })
              .from(providerApplications)
              .where(
                and(
                  eq(providerApplications.userId, users.id),
                  eq(providerApplications.status, "approved"),
                ),
              ),
          ),
        ),
      )
      .limit(1);
    if (!profile) {
      return { type: "ineligible" };
    }

    const [listing] = await transaction
      .select()
      .from(serviceListings)
      .where(eq(serviceListings.id, listingId))
      .for("update");
    if (!listing) {
      return { type: "missing" };
    }
    if (listing.professionalProfileId !== profile.id) {
      return { type: "not_owner" };
    }
    return { type: "found", listing, profileId: profile.id };
  }
}
