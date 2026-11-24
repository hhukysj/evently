import { z } from "zod";
import {
  serviceCategorySlugs,
  serviceListingPricingMethods,
} from "./service-listings.js";

export const bookingRequestStatuses = [
  "requested",
  "accepted",
  "declined",
] as const;

export const notificationTypes = [
  "booking_request_received",
  "booking_request_accepted",
  "booking_request_declined",
] as const;

export const bookingRequestStatusSchema = z.enum(bookingRequestStatuses);
export const notificationTypeSchema = z.enum(notificationTypes);
const categorySlugSchema = z.enum(serviceCategorySlugs);
const pricingMethodSchema = z.enum(serviceListingPricingMethods);
const amountPaiseSchema = z.number().int().min(0).max(2_147_483_647);

function isIanaTimezone(timezone: string): boolean {
  if (timezone === "UTC") {
    return true;
  }
  if (/^[+-]/.test(timezone)) {
    return false;
  }

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

function isOrderedBudgetRange(
  minimum: number | null | undefined,
  maximum: number | null | undefined,
): boolean {
  return minimum == null || maximum == null || minimum <= maximum;
}

function localDateInTimezone(timezone: string, now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: "year" | "month" | "day") =>
    parts.find((value) => value.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export const bookingRequestCreationInputSchema = z
  .strictObject({
    serviceListingId: z.uuid(),
    idempotencyKey: z.uuid(),
    eventType: z.string().trim().min(2).max(120),
    eventDate: z.iso.date(),
    eventTimezone: z.string().trim().min(1).max(64),
    eventLocation: z.strictObject({
      city: z.string().trim().min(2).max(120),
      region: z.string().trim().min(2).max(120).optional(),
      venueOrArea: z.string().trim().min(2).max(200).optional(),
    }),
    guestCount: z.number().int().min(1).max(100_000),
    budgetMinAmountPaise: amountPaiseSchema.optional(),
    budgetMaxAmountPaise: amountPaiseSchema.optional(),
    additionalNotes: z.string().trim().min(1).max(1200).optional(),
  })
  .superRefine((value, context) => {
    if (!isIanaTimezone(value.eventTimezone)) {
      context.addIssue({
        code: "custom",
        path: ["eventTimezone"],
        message: "Use a valid IANA timezone identifier.",
      });
      return;
    }
    if (value.eventDate < localDateInTimezone(value.eventTimezone)) {
      context.addIssue({
        code: "custom",
        path: ["eventDate"],
        message: "Event date cannot be in the past in its local timezone.",
      });
    }
    if (
      !isOrderedBudgetRange(
        value.budgetMinAmountPaise,
        value.budgetMaxAmountPaise,
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["budgetMinAmountPaise"],
        message: "Budget minimum must not exceed the maximum.",
      });
    }
  });

const listQueryFields = {
  page: z.coerce.number().int().min(1).max(1000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(25),
  status: bookingRequestStatusSchema.optional(),
};

export const customerBookingRequestListQuerySchema =
  z.strictObject(listQueryFields);
export const providerBookingRequestListQuerySchema =
  z.strictObject(listQueryFields);

export const bookingRequestStatusHistoryDtoSchema = z.strictObject({
  id: z.uuid(),
  previousStatus: bookingRequestStatusSchema.nullable(),
  newStatus: bookingRequestStatusSchema,
  actorRole: z.enum(["customer", "professional"]),
  reason: z.string().min(1).max(500).nullable(),
  createdAt: z.iso.datetime(),
});

export const bookingRequestDtoSchema = z
  .strictObject({
    id: z.uuid(),
    serviceListingId: z.uuid().nullable(),
    service: z.strictObject({
      title: z.string().min(2).max(120),
      description: z.string().min(20).max(1200),
      city: z.string().min(2).max(120),
      region: z.string().min(2).max(120).nullable(),
      category: z.strictObject({
        slug: categorySlugSchema,
        name: z.string().min(2).max(100),
      }),
      pricingMethod: pricingMethodSchema,
      priceAmountPaise: amountPaiseSchema.nullable(),
      currency: z.literal("INR"),
    }),
    providerDisplayName: z.string().min(2).max(120),
    eventType: z.string().min(2).max(120),
    eventDate: z.iso.date(),
    eventTimezone: z.string().min(1).max(64),
    eventLocation: z.strictObject({
      city: z.string().min(2).max(120),
      region: z.string().min(2).max(120).nullable(),
      venueOrArea: z.string().min(2).max(200).nullable(),
    }),
    guestCount: z.number().int().min(1).max(100_000),
    budgetMinAmountPaise: amountPaiseSchema.nullable(),
    budgetMaxAmountPaise: amountPaiseSchema.nullable(),
    additionalNotes: z.string().min(1).max(1200).nullable(),
    status: bookingRequestStatusSchema,
    statusHistory: z.array(bookingRequestStatusHistoryDtoSchema),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .refine(
    (value) =>
      value.service.pricingMethod === "quote_only"
        ? value.service.priceAmountPaise === null
        : value.service.priceAmountPaise !== null,
    {
      message: "Service price must match the listing pricing method.",
      path: ["service", "priceAmountPaise"],
    },
  )
  .refine(
    (value) =>
      isOrderedBudgetRange(
        value.budgetMinAmountPaise,
        value.budgetMaxAmountPaise,
      ),
    {
      message: "Budget minimum must not exceed the maximum.",
      path: ["budgetMinAmountPaise"],
    },
  );

export const notificationDtoSchema = z.strictObject({
  id: z.uuid(),
  type: notificationTypeSchema,
  bookingRequestId: z.uuid(),
  createdAt: z.iso.datetime(),
  readAt: z.iso.datetime().nullable(),
});

export const notificationListQuerySchema = z.strictObject({
  page: z.coerce.number().int().min(1).max(1000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(25),
  unreadOnly: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === "true")),
});

export const markNotificationReadInputSchema = z.strictObject({});

export type BookingRequestStatus = z.infer<typeof bookingRequestStatusSchema>;
export type NotificationType = z.infer<typeof notificationTypeSchema>;
export type BookingRequestCreationInput = z.infer<
  typeof bookingRequestCreationInputSchema
>;
export type CustomerBookingRequestListQuery = z.infer<
  typeof customerBookingRequestListQuerySchema
>;
export type ProviderBookingRequestListQuery = z.infer<
  typeof providerBookingRequestListQuerySchema
>;
export type BookingRequestStatusHistoryDto = z.infer<
  typeof bookingRequestStatusHistoryDtoSchema
>;
export type BookingRequestDto = z.infer<typeof bookingRequestDtoSchema>;
export type NotificationDto = z.infer<typeof notificationDtoSchema>;
export type NotificationListQuery = z.infer<typeof notificationListQuerySchema>;
export type MarkNotificationReadInput = z.infer<
  typeof markNotificationReadInputSchema
>;
