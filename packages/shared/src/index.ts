import { z } from "zod";
export {
  bookingRequestCreationInputSchema,
  bookingRequestDtoSchema,
  bookingRequestStatusSchema,
  bookingRequestStatuses,
  bookingRequestStatusHistoryDtoSchema,
  customerBookingRequestListQuerySchema,
  markNotificationReadInputSchema,
  notificationDtoSchema,
  notificationListQuerySchema,
  notificationTypeSchema,
  notificationTypes,
  providerBookingRequestListQuerySchema,
} from "./booking-requests.js";
export type {
  BookingRequestCreationInput,
  BookingRequestDto,
  BookingRequestStatus,
  BookingRequestStatusHistoryDto,
  CustomerBookingRequestListQuery,
  MarkNotificationReadInput,
  NotificationDto,
  NotificationListQuery,
  NotificationType,
  ProviderBookingRequestListQuery,
} from "./booking-requests.js";
export {
  hideServiceListing,
  isPublicListingState,
  publishServiceListing,
  adminServiceListingQuerySchema,
  providerServiceListingQuerySchema,
  publicServiceListingQuerySchema,
  restoreServiceListing,
  serviceCategories,
  serviceCategorySlugs,
  serviceListingInputSchema,
  serviceListingModerationStatuses,
  serviceListingPatchSchema,
  serviceListingPricingMethods,
  serviceListingPublicationStatuses,
  serviceListingStateSchema,
  unpublishServiceListing,
} from "./service-listings.js";
export type {
  PublicServiceListingQuery,
  AdminServiceListingQuery,
  ProviderServiceListingQuery,
  PublicServiceListingDto,
  ServiceCategorySlug,
  ServiceListingInput,
  ServiceListingModerationStatus,
  ServiceListingPatch,
  ServiceListingPricingMethod,
  ServiceListingPublicationStatus,
  ServiceListingState,
} from "./service-listings.js";

export const HealthResponseSchema = z.object({
  data: z.object({
    status: z.literal("ok"),
    service: z.literal("evently-api"),
  }),
});

export const ApiErrorResponseSchema = z.object({
  error: z.object({
    code: z.string().min(1).max(64),
    message: z.string().min(1).max(1024),
    requestId: z.uuid(),
  }),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;
export type ApiErrorResponse = z.infer<typeof ApiErrorResponseSchema>;
