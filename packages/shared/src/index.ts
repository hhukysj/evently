import { z } from "zod";
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
