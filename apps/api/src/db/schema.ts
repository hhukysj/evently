import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
  json,
} from "drizzle-orm/pg-core";

export const userRoleEnum = pgEnum("user_role", [
  "customer",
  "professional",
  "admin",
]);

export const userStatusEnum = pgEnum("user_status", [
  "active",
  "suspended",
  "deactivated",
]);

export const accountTokenTypeEnum = pgEnum("account_token_type", [
  "email_verification",
  "password_reset",
]);

export const adminActionEnum = pgEnum("admin_action", [
  "suspend_user",
  "approve_provider_application",
  "reject_provider_application",
  "hide_service_listing",
  "restore_service_listing",
]);

export const providerTypeEnum = pgEnum("provider_type", [
  "event_organizer",
  "event_manager",
  "artist_performer",
  "vendor_service_provider",
]);

export const providerApplicationStatusEnum = pgEnum(
  "provider_application_status",
  ["pending", "approved", "rejected"],
);

export const professionalProfileStatusEnum = pgEnum(
  "professional_profile_status",
  ["draft"],
);

export const serviceListingPricingMethodEnum = pgEnum(
  "service_listing_pricing_method",
  ["fixed", "starting_at", "quote_only"],
);

export const serviceListingPublicationStatusEnum = pgEnum(
  "service_listing_publication_status",
  ["draft", "published"],
);

export const serviceListingModerationStatusEnum = pgEnum(
  "service_listing_moderation_status",
  ["visible", "hidden"],
);

export const bookingRequestStatusEnum = pgEnum("booking_request_status", [
  "requested",
  "accepted",
  "declined",
]);

export const notificationTypeEnum = pgEnum("notification_type", [
  "booking_request_received",
  "booking_request_accepted",
  "booking_request_declined",
]);

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    email: varchar("email", { length: 254 }).notNull(),
    passwordHash: text("password_hash").notNull(),
    role: userRoleEnum("role").notNull().default("customer"),
    authVersion: integer("auth_version").notNull().default(0),
    status: userStatusEnum("status").notNull().default("active"),
    emailVerifiedAt: timestamp("email_verified_at", {
      withTimezone: true,
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("users_email_unique").on(sql`lower(${table.email})`),
    check("users_auth_version_nonnegative", sql`${table.authVersion} >= 0`),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: json("sess").notNull(),
    expire: timestamp("expire", { precision: 6 }).notNull(),
  },
  (table) => [index("IDX_sessions_expire").on(table.expire)],
);

export const accountTokens = pgTable(
  "account_tokens",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: accountTokenTypeEnum("type").notNull(),
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("account_tokens_token_hash_unique").on(table.tokenHash),
    uniqueIndex("account_tokens_active_user_type_unique")
      .on(table.userId, table.type)
      .where(sql`${table.consumedAt} IS NULL`),
    index("account_tokens_expiry_idx").on(table.expiresAt),
  ],
);

export const providerApplications = pgTable(
  "provider_applications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    displayName: varchar("display_name", { length: 120 }).notNull(),
    description: varchar("description", { length: 1200 }).notNull(),
    city: varchar("city", { length: 120 }).notNull(),
    region: varchar("region", { length: 120 }),
    country: varchar("country", { length: 80 }).notNull(),
    status: providerApplicationStatusEnum("status")
      .notNull()
      .default("pending"),
    reviewerUserId: uuid("reviewer_user_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    rejectionReason: varchar("rejection_reason", { length: 500 }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("provider_applications_one_pending_per_user")
      .on(table.userId)
      .where(sql`${table.status} = 'pending'`),
    index("provider_applications_status_created_idx").on(
      table.status,
      table.createdAt,
      table.id,
    ),
    index("provider_applications_user_created_idx").on(
      table.userId,
      table.createdAt,
    ),
    check(
      "provider_applications_review_state_check",
      sql`(
        (${table.status} = 'pending' AND ${table.reviewerUserId} IS NULL AND ${table.reviewedAt} IS NULL AND ${table.rejectionReason} IS NULL)
        OR (${table.status} = 'approved' AND ${table.reviewerUserId} IS NOT NULL AND ${table.reviewedAt} IS NOT NULL AND ${table.rejectionReason} IS NULL)
        OR (${table.status} = 'rejected' AND ${table.reviewerUserId} IS NOT NULL AND ${table.reviewedAt} IS NOT NULL AND ${table.rejectionReason} IS NOT NULL AND char_length(btrim(${table.rejectionReason})) BETWEEN 8 AND 500)
      )`,
    ),
  ],
);

export const providerApplicationTypes = pgTable(
  "provider_application_types",
  {
    applicationId: uuid("application_id")
      .notNull()
      .references(() => providerApplications.id, { onDelete: "cascade" }),
    providerType: providerTypeEnum("provider_type").notNull(),
  },
  (table) => [
    primaryKey({
      name: "provider_application_types_pk",
      columns: [table.applicationId, table.providerType],
    }),
    index("provider_application_types_type_idx").on(table.providerType),
  ],
);

export const professionalProfiles = pgTable(
  "professional_profiles",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    displayName: varchar("display_name", { length: 120 }).notNull(),
    slug: varchar("slug", { length: 120 }).notNull(),
    headline: varchar("headline", { length: 160 }),
    bio: varchar("bio", { length: 1200 }),
    city: varchar("city", { length: 120 }).notNull(),
    region: varchar("region", { length: 120 }),
    country: varchar("country", { length: 80 }).notNull(),
    status: professionalProfileStatusEnum("status").notNull().default("draft"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("professional_profiles_user_unique").on(table.userId),
    uniqueIndex("professional_profiles_slug_unique").on(table.slug),
    index("professional_profiles_status_created_idx").on(
      table.status,
      table.createdAt,
    ),
  ],
);

export const professionalProfileTypes = pgTable(
  "professional_profile_types",
  {
    profileId: uuid("profile_id")
      .notNull()
      .references(() => professionalProfiles.id, { onDelete: "cascade" }),
    providerType: providerTypeEnum("provider_type").notNull(),
  },
  (table) => [
    primaryKey({
      name: "professional_profile_types_pk",
      columns: [table.profileId, table.providerType],
    }),
    index("professional_profile_types_type_idx").on(table.providerType),
  ],
);

export const serviceCategories = pgTable(
  "service_categories",
  {
    slug: varchar("slug", { length: 64 }).primaryKey(),
    name: varchar("name", { length: 100 }).notNull(),
    sortOrder: integer("sort_order").notNull(),
  },
  (table) => [
    uniqueIndex("service_categories_name_unique").on(table.name),
    uniqueIndex("service_categories_sort_order_unique").on(table.sortOrder),
    check(
      "service_categories_sort_order_positive",
      sql`${table.sortOrder} > 0`,
    ),
    check(
      "service_categories_name_nonblank",
      sql`char_length(btrim(${table.name})) BETWEEN 2 AND 100 AND ${table.name} ~ '[^[:space:]]'`,
    ),
  ],
);

export const serviceListings = pgTable(
  "service_listings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    professionalProfileId: uuid("professional_profile_id")
      .notNull()
      .references(() => professionalProfiles.id, { onDelete: "cascade" }),
    categorySlug: varchar("category_slug", { length: 64 })
      .notNull()
      .references(() => serviceCategories.slug, { onDelete: "restrict" }),
    title: varchar("title", { length: 120 }).notNull(),
    description: varchar("description", { length: 1200 }).notNull(),
    city: varchar("city", { length: 120 }).notNull(),
    region: varchar("region", { length: 120 }),
    pricingMethod: serviceListingPricingMethodEnum("pricing_method").notNull(),
    priceAmountPaise: integer("price_amount_paise"),
    currency: varchar("currency", { length: 3 }).notNull().default("INR"),
    publicationStatus: serviceListingPublicationStatusEnum("publication_status")
      .notNull()
      .default("draft"),
    moderationStatus: serviceListingModerationStatusEnum("moderation_status")
      .notNull()
      .default("visible"),
    moderationHiddenByUserId: uuid("moderation_hidden_by_user_id").references(
      () => users.id,
      { onDelete: "restrict" },
    ),
    moderationHiddenAt: timestamp("moderation_hidden_at", {
      withTimezone: true,
    }),
    moderationReason: varchar("moderation_reason", { length: 500 }),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("service_listings_owner_created_idx").on(
      table.professionalProfileId,
      table.createdAt,
      table.id,
    ),
    index("service_listings_public_created_idx")
      .on(table.createdAt, table.id)
      .where(
        sql`${table.publicationStatus} = 'published' AND ${table.moderationStatus} = 'visible'`,
      ),
    index("service_listings_category_visibility_created_idx").on(
      table.categorySlug,
      table.publicationStatus,
      table.moderationStatus,
      table.createdAt,
      table.id,
    ),
    index("service_listings_city_visibility_created_idx").on(
      table.city,
      table.publicationStatus,
      table.moderationStatus,
      table.createdAt,
      table.id,
    ),
    index("service_listings_region_visibility_created_idx").on(
      table.region,
      table.publicationStatus,
      table.moderationStatus,
      table.createdAt,
      table.id,
    ),
    check(
      "service_listings_title_nonblank",
      sql`char_length(btrim(${table.title})) BETWEEN 2 AND 120 AND ${table.title} ~ '[^[:space:]]'`,
    ),
    check(
      "service_listings_description_nonblank",
      sql`char_length(btrim(${table.description})) BETWEEN 20 AND 1200 AND ${table.description} ~ '[^[:space:]]'`,
    ),
    check(
      "service_listings_city_nonblank",
      sql`char_length(btrim(${table.city})) BETWEEN 2 AND 120 AND ${table.city} ~ '[^[:space:]]'`,
    ),
    check(
      "service_listings_region_nonblank",
      sql`${table.region} IS NULL OR (char_length(btrim(${table.region})) BETWEEN 2 AND 120 AND ${table.region} ~ '[^[:space:]]')`,
    ),
    check(
      "service_listings_moderation_metadata_consistent",
      sql`(
        (${table.moderationStatus} = 'visible' AND ${table.moderationHiddenByUserId} IS NULL AND ${table.moderationHiddenAt} IS NULL AND ${table.moderationReason} IS NULL)
        OR (${table.moderationStatus} = 'hidden' AND ${table.moderationHiddenByUserId} IS NOT NULL AND ${table.moderationHiddenAt} IS NOT NULL AND ${table.moderationReason} IS NOT NULL AND char_length(btrim(${table.moderationReason})) BETWEEN 8 AND 500 AND ${table.moderationReason} ~ '[^[:space:]]')
      )`,
    ),
    check(
      "service_listings_price_consistent",
      sql`(
        (${table.pricingMethod} = 'quote_only' AND ${table.priceAmountPaise} IS NULL)
        OR (${table.pricingMethod} IN ('fixed', 'starting_at') AND ${table.priceAmountPaise} IS NOT NULL AND ${table.priceAmountPaise} >= 0)
      )`,
    ),
    check("service_listings_currency_inr", sql`${table.currency} = 'INR'`),
    check("service_listings_version_positive", sql`${table.version} > 0`),
  ],
);

export const bookingRequests = pgTable(
  "booking_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    customerUserId: uuid("customer_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    professionalUserId: uuid("professional_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    submittedServiceListingIdSnapshot: uuid(
      "submitted_service_listing_id_snapshot",
    ).notNull(),
    serviceListingId: uuid("service_listing_id").references(
      () => serviceListings.id,
      { onDelete: "set null" },
    ),
    serviceTitleSnapshot: varchar("service_title_snapshot", {
      length: 120,
    }).notNull(),
    serviceDescriptionSnapshot: varchar("service_description_snapshot", {
      length: 1200,
    }).notNull(),
    serviceCitySnapshot: varchar("service_city_snapshot", {
      length: 120,
    }).notNull(),
    serviceRegionSnapshot: varchar("service_region_snapshot", {
      length: 120,
    }),
    serviceCategorySlugSnapshot: varchar("service_category_slug_snapshot", {
      length: 64,
    }).notNull(),
    serviceCategoryNameSnapshot: varchar("service_category_name_snapshot", {
      length: 100,
    }).notNull(),
    servicePricingMethodSnapshot: serviceListingPricingMethodEnum(
      "service_pricing_method_snapshot",
    ).notNull(),
    servicePriceAmountPaiseSnapshot: integer(
      "service_price_amount_paise_snapshot",
    ),
    serviceCurrencySnapshot: varchar("service_currency_snapshot", {
      length: 3,
    }).notNull(),
    providerDisplayNameSnapshot: varchar("provider_display_name_snapshot", {
      length: 120,
    }).notNull(),
    eventType: varchar("event_type", { length: 120 }).notNull(),
    eventDate: date("event_date", { mode: "string" }).notNull(),
    eventTimezone: varchar("event_timezone", { length: 64 }).notNull(),
    eventCity: varchar("event_city", { length: 120 }).notNull(),
    eventRegion: varchar("event_region", { length: 120 }),
    eventVenueOrArea: varchar("event_venue_or_area", { length: 200 }),
    guestCount: integer("guest_count").notNull(),
    budgetMinAmountPaise: integer("budget_min_amount_paise"),
    budgetMaxAmountPaise: integer("budget_max_amount_paise"),
    additionalNotes: varchar("additional_notes", { length: 1200 }),
    status: bookingRequestStatusEnum("status").notNull().default("requested"),
    idempotencyKey: uuid("idempotency_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("booking_requests_customer_idempotency_unique").on(
      table.customerUserId,
      table.idempotencyKey,
    ),
    check(
      "booking_requests_participants_distinct",
      sql`${table.customerUserId} <> ${table.professionalUserId}`,
    ),
    index("booking_requests_customer_created_idx").on(
      table.customerUserId,
      table.createdAt,
      table.id,
    ),
    index("booking_requests_professional_status_created_idx").on(
      table.professionalUserId,
      table.status,
      table.createdAt,
      table.id,
    ),
    check(
      "booking_requests_service_snapshot_nonblank",
      sql`(
        char_length(btrim(${table.serviceTitleSnapshot})) BETWEEN 2 AND 120
        AND char_length(btrim(${table.serviceDescriptionSnapshot})) BETWEEN 20 AND 1200
        AND char_length(btrim(${table.serviceCitySnapshot})) BETWEEN 2 AND 120
        AND (${table.serviceRegionSnapshot} IS NULL OR char_length(btrim(${table.serviceRegionSnapshot})) BETWEEN 2 AND 120)
        AND char_length(btrim(${table.serviceCategorySlugSnapshot})) BETWEEN 1 AND 64
        AND char_length(btrim(${table.serviceCategoryNameSnapshot})) BETWEEN 2 AND 100
        AND char_length(btrim(${table.providerDisplayNameSnapshot})) BETWEEN 2 AND 120
      )`,
    ),
    check(
      "booking_requests_service_price_consistent",
      sql`(
        (${table.servicePricingMethodSnapshot} = 'quote_only' AND ${table.servicePriceAmountPaiseSnapshot} IS NULL)
        OR (${table.servicePricingMethodSnapshot} IN ('fixed', 'starting_at') AND ${table.servicePriceAmountPaiseSnapshot} IS NOT NULL AND ${table.servicePriceAmountPaiseSnapshot} >= 0)
      )`,
    ),
    check(
      "booking_requests_service_currency_inr",
      sql`${table.serviceCurrencySnapshot} = 'INR'`,
    ),
    check(
      "booking_requests_event_fields_valid",
      sql`(
        char_length(btrim(${table.eventType})) BETWEEN 2 AND 120
        AND char_length(btrim(${table.eventTimezone})) BETWEEN 1 AND 64
        AND char_length(btrim(${table.eventCity})) BETWEEN 2 AND 120
        AND (${table.eventRegion} IS NULL OR char_length(btrim(${table.eventRegion})) BETWEEN 2 AND 120)
        AND (${table.eventVenueOrArea} IS NULL OR char_length(btrim(${table.eventVenueOrArea})) BETWEEN 2 AND 200)
        AND (${table.additionalNotes} IS NULL OR char_length(btrim(${table.additionalNotes})) BETWEEN 1 AND 1200)
      )`,
    ),
    check(
      "booking_requests_guest_count_valid",
      sql`${table.guestCount} BETWEEN 1 AND 100000`,
    ),
    check(
      "booking_requests_budget_nonnegative",
      sql`((${table.budgetMinAmountPaise} IS NULL OR ${table.budgetMinAmountPaise} >= 0) AND (${table.budgetMaxAmountPaise} IS NULL OR ${table.budgetMaxAmountPaise} >= 0))`,
    ),
    check(
      "booking_requests_budget_ordered",
      sql`(${table.budgetMinAmountPaise} IS NULL OR ${table.budgetMaxAmountPaise} IS NULL OR ${table.budgetMinAmountPaise} <= ${table.budgetMaxAmountPaise})`,
    ),
  ],
);

export const bookingStatusHistory = pgTable(
  "booking_status_history",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    bookingRequestId: uuid("booking_request_id")
      .notNull()
      .references(() => bookingRequests.id, { onDelete: "restrict" }),
    previousStatus: bookingRequestStatusEnum("previous_status"),
    newStatus: bookingRequestStatusEnum("new_status").notNull(),
    actorUserId: uuid("actor_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    reason: varchar("reason", { length: 500 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("booking_status_history_request_created_idx").on(
      table.bookingRequestId,
      table.createdAt,
      table.id,
    ),
    check(
      "booking_status_history_transition_valid",
      sql`((${table.previousStatus} IS NULL AND ${table.newStatus} = 'requested') OR (${table.previousStatus} IS NOT NULL AND ${table.previousStatus} <> ${table.newStatus}))`,
    ),
    check(
      "booking_status_history_reason_valid",
      sql`(${table.reason} IS NULL OR char_length(btrim(${table.reason})) BETWEEN 1 AND 500)`,
    ),
  ],
);

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    recipientUserId: uuid("recipient_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    type: notificationTypeEnum("type").notNull(),
    bookingRequestId: uuid("booking_request_id")
      .notNull()
      .references(() => bookingRequests.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    readAt: timestamp("read_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("notifications_request_recipient_type_unique").on(
      table.bookingRequestId,
      table.recipientUserId,
      table.type,
    ),
    index("notifications_recipient_created_idx").on(
      table.recipientUserId,
      table.createdAt,
      table.id,
    ),
    index("notifications_recipient_unread_created_idx")
      .on(table.recipientUserId, table.createdAt, table.id)
      .where(sql`${table.readAt} IS NULL`),
  ],
);

export const adminAuditLogs = pgTable(
  "admin_audit_logs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    actorUserId: uuid("actor_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    targetUserId: uuid("target_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    providerApplicationId: uuid("provider_application_id").references(
      () => providerApplications.id,
      { onDelete: "set null" },
    ),
    serviceListingId: uuid("service_listing_id").references(
      () => serviceListings.id,
      { onDelete: "restrict" },
    ),
    actorUserIdSnapshot: uuid("actor_user_id_snapshot"),
    serviceListingReason: varchar("service_listing_reason", { length: 500 }),
    action: adminActionEnum("action").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("admin_audit_logs_actor_created_idx").on(
      table.actorUserId,
      table.createdAt,
    ),
    index("admin_audit_logs_target_created_idx").on(
      table.targetUserId,
      table.createdAt,
    ),
    index("admin_audit_logs_application_created_idx").on(
      table.providerApplicationId,
      table.createdAt,
    ),
    index("admin_audit_logs_listing_created_idx").on(
      table.serviceListingId,
      table.createdAt,
    ),
    check(
      "admin_audit_logs_service_listing_identity_check",
      sql`(
        ${table.action} NOT IN ('hide_service_listing', 'restore_service_listing')
        OR (${table.serviceListingId} IS NOT NULL AND ${table.actorUserIdSnapshot} IS NOT NULL AND (${table.actorUserId} IS NULL OR ${table.actorUserId} = ${table.actorUserIdSnapshot}))
      )`,
    ),
    check(
      "admin_audit_logs_service_listing_reason_check",
      sql`(
        ${table.action} <> 'hide_service_listing'
        OR (${table.serviceListingReason} IS NOT NULL AND char_length(btrim(${table.serviceListingReason})) BETWEEN 8 AND 500 AND ${table.serviceListingReason} ~ '[^[:space:]]')
      )`,
    ),
  ],
);

export const rateLimitCounters = pgTable(
  "rate_limit_counters",
  {
    keyHash: varchar("key_hash", { length: 64 }).primaryKey(),
    hits: integer("hits").notNull(),
    resetAt: timestamp("reset_at", { withTimezone: true }).notNull(),
  },
  (table) => [index("rate_limit_counters_reset_idx").on(table.resetAt)],
);
