import {
  and,
  count,
  desc,
  eq,
  exists,
  inArray,
  isNull,
  ne,
  sql,
} from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type {
  BookingRequestCreationInput,
  BookingRequestDto,
  BookingCancellationInput,
  BookingMessageDto,
  BookingMessageInput,
  BookingMessagesListQuery,
  CustomerBookingRequestListQuery,
  NotificationDto,
  NotificationListQuery,
  ProviderBookingRequestListQuery,
} from "@evently/shared";
import {
  bookingMessageDtoSchema,
  bookingRequestDtoSchema,
  notificationDtoSchema,
} from "@evently/shared";
import * as schema from "../../db/schema.js";
import {
  bookingRequests,
  bookingStatusHistory,
  conversations,
  messages,
  notifications,
  professionalProfiles,
  providerApplications,
  serviceCategories,
  serviceListings,
  users,
} from "../../db/schema.js";

type Database = NodePgDatabase<typeof schema>;
type BookingRequestRow = typeof bookingRequests.$inferSelect;
type HistoryRow = typeof bookingStatusHistory.$inferSelect;

export interface BookingRequestPage {
  bookingRequests: BookingRequestDto[];
  total: number;
}

export interface NotificationPage {
  notifications: NotificationDto[];
  total: number;
}

export interface BookingMessagePage {
  messages: BookingMessageDto[];
  total: number;
}

export type BookingCancellationResult =
  | { type: "success"; bookingRequest: BookingRequestDto }
  | { type: "missing" }
  | { type: "conflict" }
  | { type: "actor_ineligible" };

export type BookingCreationResult =
  | { type: "created" | "replayed"; bookingRequest: BookingRequestDto }
  | {
      type:
        | "customer_ineligible"
        | "unavailable_listing"
        | "self_request"
        | "idempotency_conflict";
    };

export type BookingDecisionResult =
  | { type: "success"; bookingRequest: BookingRequestDto }
  | { type: "missing" | "conflict" | "professional_ineligible" };

export interface BookingRequestRepository {
  createRequest(
    customerUserId: string,
    input: BookingRequestCreationInput,
  ): Promise<BookingCreationResult>;
  listCustomerRequests(
    customerUserId: string,
    query: CustomerBookingRequestListQuery,
  ): Promise<BookingRequestPage>;
  findCustomerRequest(
    customerUserId: string,
    requestId: string,
  ): Promise<BookingRequestDto | undefined>;
  listProfessionalRequests(
    professionalUserId: string,
    query: ProviderBookingRequestListQuery,
  ): Promise<BookingRequestPage | "professional_ineligible">;
  findProfessionalRequest(
    professionalUserId: string,
    requestId: string,
  ): Promise<BookingRequestDto | undefined | "professional_ineligible">;
  decideRequest(
    professionalUserId: string,
    requestId: string,
    decision: "accepted" | "declined",
  ): Promise<BookingDecisionResult>;
  cancelRequest(
    actorUserId: string,
    requestId: string,
    input: BookingCancellationInput,
  ): Promise<BookingCancellationResult>;
  listMessages(
    actorUserId: string,
    requestId: string,
    query: BookingMessagesListQuery,
  ): Promise<BookingMessagePage | undefined>;
  sendMessage(
    actorUserId: string,
    requestId: string,
    input: BookingMessageInput,
  ): Promise<BookingMessageDto | undefined>;
  listNotifications(
    recipientUserId: string,
    query: NotificationListQuery,
  ): Promise<NotificationPage>;
  markNotificationRead(
    recipientUserId: string,
    notificationId: string,
  ): Promise<NotificationDto | undefined>;
}

function isIdempotencyUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4; depth += 1) {
    if (
      typeof current === "object" &&
      current !== null &&
      "code" in current &&
      current.code === "23505" &&
      "constraint" in current &&
      current.constraint === "booking_requests_customer_idempotency_unique"
    ) {
      return true;
    }
    current =
      typeof current === "object" && current !== null && "cause" in current
        ? current.cause
        : undefined;
  }
  return false;
}

function pgConstraintError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4; depth += 1) {
    if (
      typeof current === "object" &&
      current !== null &&
      "code" in current &&
      typeof current.code === "string" &&
      ["23502", "23503", "23505", "23514", "22P02"].includes(current.code)
    ) {
      return true;
    }
    current =
      typeof current === "object" && current !== null && "cause" in current
        ? current.cause
        : undefined;
  }
  return false;
}

export function isBookingConstraintError(error: unknown): boolean {
  return pgConstraintError(error);
}

function nullable(value: string | undefined): string | null {
  return value?.trim() || null;
}

function sameNormalizedPayload(
  existing: BookingRequestRow,
  input: BookingRequestCreationInput,
): boolean {
  return (
    existing.submittedServiceListingIdSnapshot === input.serviceListingId &&
    existing.eventType === input.eventType.trim() &&
    existing.eventDate === input.eventDate &&
    existing.eventTimezone === input.eventTimezone.trim() &&
    existing.eventCity === input.eventLocation.city.trim() &&
    existing.eventRegion === nullable(input.eventLocation.region) &&
    existing.eventVenueOrArea === nullable(input.eventLocation.venueOrArea) &&
    existing.guestCount === input.guestCount &&
    existing.budgetMinAmountPaise === (input.budgetMinAmountPaise ?? null) &&
    existing.budgetMaxAmountPaise === (input.budgetMaxAmountPaise ?? null) &&
    existing.additionalNotes === nullable(input.additionalNotes)
  );
}

function toBookingRequestDto(
  request: BookingRequestRow,
  history: HistoryRow[],
): BookingRequestDto {
  return bookingRequestDtoSchema.parse({
    id: request.id,
    serviceListingId: request.serviceListingId,
    service: {
      title: request.serviceTitleSnapshot,
      description: request.serviceDescriptionSnapshot,
      city: request.serviceCitySnapshot,
      region: request.serviceRegionSnapshot,
      category: {
        slug: request.serviceCategorySlugSnapshot,
        name: request.serviceCategoryNameSnapshot,
      },
      pricingMethod: request.servicePricingMethodSnapshot,
      priceAmountPaise: request.servicePriceAmountPaiseSnapshot,
      currency: request.serviceCurrencySnapshot,
    },
    providerDisplayName: request.providerDisplayNameSnapshot,
    eventType: request.eventType,
    eventDate: request.eventDate,
    eventTimezone: request.eventTimezone,
    eventLocation: {
      city: request.eventCity,
      region: request.eventRegion,
      venueOrArea: request.eventVenueOrArea,
    },
    guestCount: request.guestCount,
    budgetMinAmountPaise: request.budgetMinAmountPaise,
    budgetMaxAmountPaise: request.budgetMaxAmountPaise,
    additionalNotes: request.additionalNotes,
    status: request.status,
    cancellation:
      request.cancelledAt && request.cancelledByUserId
        ? {
            cancelledAt: request.cancelledAt.toISOString(),
            cancelledByRole:
              request.cancelledByUserId === request.customerUserId
                ? "customer"
                : "professional",
            reason: request.cancellationReason,
          }
        : null,
    statusHistory: history.map((entry) => ({
      id: entry.id,
      previousStatus: entry.previousStatus,
      newStatus: entry.newStatus,
      actorRole:
        entry.actorUserId === request.customerUserId
          ? "customer"
          : "professional",
      reason: entry.reason,
      createdAt: entry.createdAt.toISOString(),
    })),
    createdAt: request.createdAt.toISOString(),
    updatedAt: request.updatedAt.toISOString(),
  });
}

function toNotificationDto(
  notification: typeof notifications.$inferSelect,
): NotificationDto {
  return notificationDtoSchema.parse({
    id: notification.id,
    type: notification.type,
    bookingRequestId: notification.bookingRequestId,
    createdAt: notification.createdAt.toISOString(),
    readAt: notification.readAt?.toISOString() ?? null,
    messageId: notification.messageId,
  });
}

function toMessageDto(
  message: typeof messages.$inferSelect,
  customerUserId: string,
): BookingMessageDto {
  return bookingMessageDtoSchema.parse({
    id: message.id,
    senderRole:
      message.senderUserId === customerUserId ? "customer" : "professional",
    body: message.body,
    createdAt: message.createdAt.toISOString(),
    readAt: message.readAt?.toISOString() ?? null,
  });
}

export class PostgresBookingRequestRepository implements BookingRequestRepository {
  constructor(private readonly database: Database) {}

  async createRequest(
    customerUserId: string,
    input: BookingRequestCreationInput,
  ): Promise<BookingCreationResult> {
    try {
      return await this.database.transaction(async (transaction) => {
        const [customer] = await transaction
          .select({
            id: users.id,
            role: users.role,
            status: users.status,
            emailVerifiedAt: users.emailVerifiedAt,
          })
          .from(users)
          .where(eq(users.id, customerUserId))
          .for("share");
        if (
          !customer ||
          customer.role !== "customer" ||
          customer.status !== "active" ||
          !customer.emailVerifiedAt
        ) {
          return { type: "customer_ineligible" };
        }

        const [existing] = await transaction
          .select()
          .from(bookingRequests)
          .where(
            and(
              eq(bookingRequests.customerUserId, customerUserId),
              eq(bookingRequests.idempotencyKey, input.idempotencyKey),
            ),
          )
          .limit(1);
        if (existing) {
          if (!sameNormalizedPayload(existing, input)) {
            return { type: "idempotency_conflict" };
          }
          return {
            type: "replayed",
            bookingRequest: toBookingRequestDto(
              existing,
              await transaction
                .select()
                .from(bookingStatusHistory)
                .where(eq(bookingStatusHistory.bookingRequestId, existing.id))
                .orderBy(
                  bookingStatusHistory.createdAt,
                  bookingStatusHistory.id,
                ),
            ),
          };
        }

        const [listingReference] = await transaction
          .select({ profileId: serviceListings.professionalProfileId })
          .from(serviceListings)
          .where(eq(serviceListings.id, input.serviceListingId))
          .limit(1);
        if (!listingReference) {
          return { type: "unavailable_listing" };
        }
        const [providerReference] = await transaction
          .select({ userId: professionalProfiles.userId })
          .from(professionalProfiles)
          .where(eq(professionalProfiles.id, listingReference.profileId))
          .limit(1);
        if (!providerReference) {
          return { type: "unavailable_listing" };
        }
        if (providerReference.userId === customerUserId) {
          return { type: "self_request" };
        }

        const [provider] = await transaction
          .select({ id: users.id, role: users.role, status: users.status })
          .from(users)
          .where(eq(users.id, providerReference.userId))
          .for("share");
        if (
          !provider ||
          provider.role !== "professional" ||
          provider.status !== "active"
        ) {
          return { type: "unavailable_listing" };
        }

        const [listing] = await transaction
          .select()
          .from(serviceListings)
          .where(eq(serviceListings.id, input.serviceListingId))
          .for("update");
        if (
          !listing ||
          listing.professionalProfileId !== listingReference.profileId ||
          listing.publicationStatus !== "published" ||
          listing.moderationStatus !== "visible"
        ) {
          return { type: "unavailable_listing" };
        }

        const [providerDetails] = await transaction
          .select({
            displayName: professionalProfiles.displayName,
            userId: users.id,
            categorySlug: serviceCategories.slug,
            categoryName: serviceCategories.name,
          })
          .from(professionalProfiles)
          .innerJoin(users, eq(users.id, professionalProfiles.userId))
          .innerJoin(
            serviceCategories,
            eq(serviceCategories.slug, listing.categorySlug),
          )
          .where(
            and(
              eq(professionalProfiles.id, listing.professionalProfileId),
              eq(users.id, providerReference.userId),
              eq(users.role, "professional"),
              eq(users.status, "active"),
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
        if (!providerDetails) {
          return { type: "unavailable_listing" };
        }

        const [created] = await transaction
          .insert(bookingRequests)
          .values({
            customerUserId,
            professionalUserId: providerDetails.userId,
            submittedServiceListingIdSnapshot: input.serviceListingId,
            serviceListingId: input.serviceListingId,
            serviceTitleSnapshot: listing.title,
            serviceDescriptionSnapshot: listing.description,
            serviceCitySnapshot: listing.city,
            serviceRegionSnapshot: listing.region,
            serviceCategorySlugSnapshot: providerDetails.categorySlug,
            serviceCategoryNameSnapshot: providerDetails.categoryName,
            servicePricingMethodSnapshot: listing.pricingMethod,
            servicePriceAmountPaiseSnapshot: listing.priceAmountPaise,
            serviceCurrencySnapshot: listing.currency,
            providerDisplayNameSnapshot: providerDetails.displayName,
            eventType: input.eventType,
            eventDate: input.eventDate,
            eventTimezone: input.eventTimezone,
            eventCity: input.eventLocation.city,
            eventRegion: input.eventLocation.region ?? null,
            eventVenueOrArea: input.eventLocation.venueOrArea ?? null,
            guestCount: input.guestCount,
            budgetMinAmountPaise: input.budgetMinAmountPaise ?? null,
            budgetMaxAmountPaise: input.budgetMaxAmountPaise ?? null,
            additionalNotes: input.additionalNotes ?? null,
            status: "requested",
            idempotencyKey: input.idempotencyKey,
          })
          .returning();
        if (!created) {
          throw new Error("Booking request insert returned no record");
        }

        await transaction.insert(conversations).values({
          bookingRequestId: created.id,
        });
        await transaction.insert(bookingStatusHistory).values({
          bookingRequestId: created.id,
          previousStatus: null,
          newStatus: "requested",
          actorUserId: customerUserId,
        });
        await transaction.insert(notifications).values({
          recipientUserId: providerDetails.userId,
          type: "booking_request_received",
          bookingRequestId: created.id,
        });

        return {
          type: "created",
          bookingRequest: toBookingRequestDto(
            created,
            await transaction
              .select()
              .from(bookingStatusHistory)
              .where(eq(bookingStatusHistory.bookingRequestId, created.id))
              .orderBy(bookingStatusHistory.createdAt, bookingStatusHistory.id),
          ),
        };
      });
    } catch (error) {
      if (!isIdempotencyUniqueViolation(error)) {
        throw error;
      }
      const [existing] = await this.database
        .select()
        .from(bookingRequests)
        .where(
          and(
            eq(bookingRequests.customerUserId, customerUserId),
            eq(bookingRequests.idempotencyKey, input.idempotencyKey),
          ),
        )
        .limit(1);
      if (!existing) {
        throw error;
      }
      if (!sameNormalizedPayload(existing, input)) {
        return { type: "idempotency_conflict" };
      }
      return {
        type: "replayed",
        bookingRequest: toBookingRequestDto(
          existing,
          await this.database
            .select()
            .from(bookingStatusHistory)
            .where(eq(bookingStatusHistory.bookingRequestId, existing.id))
            .orderBy(bookingStatusHistory.createdAt, bookingStatusHistory.id),
        ),
      };
    }
  }

  async listCustomerRequests(
    customerUserId: string,
    query: CustomerBookingRequestListQuery,
  ): Promise<BookingRequestPage> {
    const filter = query.status
      ? and(
          eq(bookingRequests.customerUserId, customerUserId),
          eq(bookingRequests.status, query.status),
        )
      : eq(bookingRequests.customerUserId, customerUserId);
    return this.listPage(filter, query.page, query.pageSize);
  }

  async findCustomerRequest(
    customerUserId: string,
    requestId: string,
  ): Promise<BookingRequestDto | undefined> {
    const [request] = await this.database
      .select()
      .from(bookingRequests)
      .where(
        and(
          eq(bookingRequests.id, requestId),
          eq(bookingRequests.customerUserId, customerUserId),
        ),
      )
      .limit(1);
    if (!request) {
      return undefined;
    }
    return toBookingRequestDto(
      request,
      await this.database
        .select()
        .from(bookingStatusHistory)
        .where(eq(bookingStatusHistory.bookingRequestId, request.id))
        .orderBy(bookingStatusHistory.createdAt, bookingStatusHistory.id),
    );
  }

  async listProfessionalRequests(
    professionalUserId: string,
    query: ProviderBookingRequestListQuery,
  ): Promise<BookingRequestPage | "professional_ineligible"> {
    if (!(await this.isActiveApprovedProfessional(professionalUserId))) {
      return "professional_ineligible";
    }
    const filter = query.status
      ? and(
          eq(bookingRequests.professionalUserId, professionalUserId),
          eq(bookingRequests.status, query.status),
        )
      : eq(bookingRequests.professionalUserId, professionalUserId);
    return this.listPage(filter, query.page, query.pageSize);
  }

  async findProfessionalRequest(
    professionalUserId: string,
    requestId: string,
  ): Promise<BookingRequestDto | undefined | "professional_ineligible"> {
    if (!(await this.isActiveApprovedProfessional(professionalUserId))) {
      return "professional_ineligible";
    }
    const [request] = await this.database
      .select()
      .from(bookingRequests)
      .where(
        and(
          eq(bookingRequests.id, requestId),
          eq(bookingRequests.professionalUserId, professionalUserId),
        ),
      )
      .limit(1);
    if (!request) {
      return undefined;
    }
    return toBookingRequestDto(
      request,
      await this.database
        .select()
        .from(bookingStatusHistory)
        .where(eq(bookingStatusHistory.bookingRequestId, request.id))
        .orderBy(bookingStatusHistory.createdAt, bookingStatusHistory.id),
    );
  }

  async decideRequest(
    professionalUserId: string,
    requestId: string,
    decision: "accepted" | "declined",
  ): Promise<BookingDecisionResult> {
    return this.database.transaction(async (transaction) => {
      const [request] = await transaction
        .select()
        .from(bookingRequests)
        .where(
          and(
            eq(bookingRequests.id, requestId),
            eq(bookingRequests.professionalUserId, professionalUserId),
          ),
        )
        .for("update");
      if (!request) {
        return { type: "missing" };
      }

      const [professional] = await transaction
        .select({ id: users.id })
        .from(users)
        .where(
          and(
            eq(users.id, professionalUserId),
            eq(users.role, "professional"),
            eq(users.status, "active"),
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
        .for("update");
      if (!professional) {
        return { type: "professional_ineligible" };
      }

      if (request.status === decision) {
        return {
          type: "success",
          bookingRequest: toBookingRequestDto(
            request,
            await transaction
              .select()
              .from(bookingStatusHistory)
              .where(eq(bookingStatusHistory.bookingRequestId, request.id))
              .orderBy(bookingStatusHistory.createdAt, bookingStatusHistory.id),
          ),
        };
      }
      if (request.status !== "requested") {
        return { type: "conflict" };
      }

      const now = new Date();
      const [updated] = await transaction
        .update(bookingRequests)
        .set({ status: decision, updatedAt: now })
        .where(
          and(
            eq(bookingRequests.id, request.id),
            eq(bookingRequests.professionalUserId, professionalUserId),
            eq(bookingRequests.status, "requested"),
          ),
        )
        .returning();
      if (!updated) {
        return { type: "conflict" };
      }
      await transaction.insert(bookingStatusHistory).values({
        bookingRequestId: updated.id,
        previousStatus: "requested",
        newStatus: decision,
        actorUserId: professionalUserId,
      });
      await transaction.insert(notifications).values({
        recipientUserId: updated.customerUserId,
        type:
          decision === "accepted"
            ? "booking_request_accepted"
            : "booking_request_declined",
        bookingRequestId: updated.id,
      });
      return {
        type: "success",
        bookingRequest: toBookingRequestDto(
          updated,
          await transaction
            .select()
            .from(bookingStatusHistory)
            .where(eq(bookingStatusHistory.bookingRequestId, updated.id))
            .orderBy(bookingStatusHistory.createdAt, bookingStatusHistory.id),
        ),
      };
    });
  }

  async cancelRequest(
    actorUserId: string,
    requestId: string,
    input: BookingCancellationInput,
  ): Promise<BookingCancellationResult> {
    return this.database.transaction(async (transaction) => {
      const [request] = await transaction
        .select()
        .from(bookingRequests)
        .where(eq(bookingRequests.id, requestId))
        .for("update");
      if (!request) {
        return { type: "missing" };
      }

      const [actor] = await transaction
        .select({ role: users.role, status: users.status })
        .from(users)
        .where(eq(users.id, actorUserId))
        .for("update");
      if (!actor || actor.status !== "active") {
        return { type: "actor_ineligible" };
      }

      const isCustomer =
        actor.role === "customer" && request.customerUserId === actorUserId;
      const isProfessional =
        actor.role === "professional" &&
        request.professionalUserId === actorUserId;
      if (!isCustomer && !isProfessional) {
        return { type: "missing" };
      }
      const allowed = isCustomer
        ? request.status === "requested" || request.status === "accepted"
        : isProfessional && request.status === "accepted";
      if (!allowed) {
        return { type: "conflict" };
      }

      const now = new Date();
      const [updated] = await transaction
        .update(bookingRequests)
        .set({
          status: "cancelled",
          cancelledAt: now,
          cancelledByUserId: actorUserId,
          cancellationReason: input.reason ?? null,
          updatedAt: now,
        })
        .where(
          and(
            eq(bookingRequests.id, requestId),
            eq(bookingRequests.status, request.status),
          ),
        )
        .returning();
      if (!updated) {
        return { type: "conflict" };
      }

      await transaction.insert(bookingStatusHistory).values({
        bookingRequestId: updated.id,
        previousStatus: request.status,
        newStatus: "cancelled",
        actorUserId,
        reason: input.reason ?? null,
      });
      await transaction.insert(notifications).values({
        recipientUserId: isCustomer
          ? updated.professionalUserId
          : updated.customerUserId,
        type: "booking_request_cancelled",
        bookingRequestId: updated.id,
      });
      const history = await transaction
        .select()
        .from(bookingStatusHistory)
        .where(eq(bookingStatusHistory.bookingRequestId, updated.id))
        .orderBy(bookingStatusHistory.createdAt, bookingStatusHistory.id);
      return {
        type: "success",
        bookingRequest: toBookingRequestDto(updated, history),
      };
    });
  }

  async listMessages(
    actorUserId: string,
    requestId: string,
    query: BookingMessagesListQuery,
  ): Promise<BookingMessagePage | undefined> {
    return this.database.transaction(async (transaction) => {
      const [request] = await transaction
        .select({
          id: bookingRequests.id,
          customerUserId: bookingRequests.customerUserId,
          professionalUserId: bookingRequests.professionalUserId,
        })
        .from(bookingRequests)
        .where(eq(bookingRequests.id, requestId))
        .limit(1);
      if (
        !request ||
        (request.customerUserId !== actorUserId &&
          request.professionalUserId !== actorUserId)
      ) {
        return undefined;
      }

      await transaction
        .insert(conversations)
        .values({ bookingRequestId: request.id })
        .onConflictDoNothing({ target: conversations.bookingRequestId });
      const [conversation] = await transaction
        .select({ id: conversations.id })
        .from(conversations)
        .where(eq(conversations.bookingRequestId, request.id))
        .limit(1);
      if (!conversation) {
        throw new Error("Booking conversation could not be loaded");
      }

      const [countRow, pageRows] = await Promise.all([
        transaction
          .select({ total: count() })
          .from(messages)
          .where(eq(messages.conversationId, conversation.id)),
        transaction
          .select()
          .from(messages)
          .where(eq(messages.conversationId, conversation.id))
          .orderBy(desc(messages.createdAt), desc(messages.id))
          .limit(query.pageSize)
          .offset((query.page - 1) * query.pageSize),
      ]);
      const pageIds = pageRows.map((message) => message.id);
      const now = new Date();
      const readRows = pageIds.length
        ? await transaction
            .update(messages)
            .set({ readAt: now })
            .where(
              and(
                inArray(messages.id, pageIds),
                ne(messages.senderUserId, actorUserId),
                isNull(messages.readAt),
              ),
            )
            .returning({ id: messages.id })
        : [];
      const newlyReadIds = new Set(readRows.map((row) => row.id));
      const resultRows = pageRows
        .map((message) =>
          newlyReadIds.has(message.id) ? { ...message, readAt: now } : message,
        )
        .reverse();
      return {
        messages: resultRows.map((message) =>
          toMessageDto(message, request.customerUserId),
        ),
        total: countRow[0]?.total ?? 0,
      };
    });
  }

  async sendMessage(
    actorUserId: string,
    requestId: string,
    input: BookingMessageInput,
  ): Promise<BookingMessageDto | undefined> {
    return this.database.transaction(async (transaction) => {
      const [request] = await transaction
        .select({
          id: bookingRequests.id,
          customerUserId: bookingRequests.customerUserId,
          professionalUserId: bookingRequests.professionalUserId,
        })
        .from(bookingRequests)
        .where(eq(bookingRequests.id, requestId))
        .limit(1);
      if (
        !request ||
        (request.customerUserId !== actorUserId &&
          request.professionalUserId !== actorUserId)
      ) {
        return undefined;
      }

      await transaction
        .insert(conversations)
        .values({ bookingRequestId: request.id })
        .onConflictDoNothing({ target: conversations.bookingRequestId });
      const [conversation] = await transaction
        .select({ id: conversations.id })
        .from(conversations)
        .where(eq(conversations.bookingRequestId, request.id))
        .limit(1);
      if (!conversation) {
        throw new Error("Booking conversation could not be loaded");
      }

      const [created] = await transaction
        .insert(messages)
        .values({
          conversationId: conversation.id,
          senderUserId: actorUserId,
          body: input.body,
        })
        .returning();
      if (!created) {
        throw new Error("Booking message insert returned no record");
      }
      await transaction.insert(notifications).values({
        recipientUserId:
          actorUserId === request.customerUserId
            ? request.professionalUserId
            : request.customerUserId,
        type: "booking_message_received",
        bookingRequestId: request.id,
        messageId: created.id,
      });
      return toMessageDto(created, request.customerUserId);
    });
  }

  async listNotifications(
    recipientUserId: string,
    query: NotificationListQuery,
  ): Promise<NotificationPage> {
    const filter = query.unreadOnly
      ? and(
          eq(notifications.recipientUserId, recipientUserId),
          isNull(notifications.readAt),
        )
      : eq(notifications.recipientUserId, recipientUserId);
    const [countRow, rows] = await Promise.all([
      this.database
        .select({ total: count() })
        .from(notifications)
        .where(filter),
      this.database
        .select()
        .from(notifications)
        .where(filter)
        .orderBy(desc(notifications.createdAt), desc(notifications.id))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize),
    ]);
    return {
      notifications: rows.map(toNotificationDto),
      total: countRow[0]?.total ?? 0,
    };
  }

  async markNotificationRead(
    recipientUserId: string,
    notificationId: string,
  ): Promise<NotificationDto | undefined> {
    const [updated] = await this.database
      .update(notifications)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(notifications.id, notificationId),
          eq(notifications.recipientUserId, recipientUserId),
          isNull(notifications.readAt),
        ),
      )
      .returning();
    if (updated) {
      return toNotificationDto(updated);
    }
    const [existing] = await this.database
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.id, notificationId),
          eq(notifications.recipientUserId, recipientUserId),
        ),
      )
      .limit(1);
    return existing ? toNotificationDto(existing) : undefined;
  }

  private async listPage(
    filter: SQL | undefined,
    page: number,
    pageSize: number,
  ): Promise<BookingRequestPage> {
    const [countRow, rows] = await Promise.all([
      this.database
        .select({ total: count() })
        .from(bookingRequests)
        .where(filter),
      this.database
        .select()
        .from(bookingRequests)
        .where(filter)
        .orderBy(desc(bookingRequests.createdAt), desc(bookingRequests.id))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
    ]);
    if (rows.length === 0) {
      return { bookingRequests: [], total: countRow[0]?.total ?? 0 };
    }
    const histories = await this.database
      .select()
      .from(bookingStatusHistory)
      .where(
        inArray(
          bookingStatusHistory.bookingRequestId,
          rows.map(({ id }) => id),
        ),
      )
      .orderBy(bookingStatusHistory.createdAt, bookingStatusHistory.id);
    const historiesByRequest = new Map<string, HistoryRow[]>();
    for (const entry of histories) {
      const entries = historiesByRequest.get(entry.bookingRequestId) ?? [];
      entries.push(entry);
      historiesByRequest.set(entry.bookingRequestId, entries);
    }
    return {
      bookingRequests: rows.map((row) =>
        toBookingRequestDto(row, historiesByRequest.get(row.id) ?? []),
      ),
      total: countRow[0]?.total ?? 0,
    };
  }

  private async isActiveApprovedProfessional(
    professionalUserId: string,
  ): Promise<boolean> {
    const [user] = await this.database
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.id, professionalUserId),
          eq(users.role, "professional"),
          eq(users.status, "active"),
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
        ),
      )
      .limit(1);
    return Boolean(user);
  }
}
