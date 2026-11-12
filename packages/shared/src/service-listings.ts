import { z } from "zod";

export const serviceCategories = [
  { slug: "planning_coordination", name: "Planning and coordination" },
  { slug: "venues_decor", name: "Venues and decor" },
  { slug: "catering_food", name: "Catering and food" },
  { slug: "entertainment_performers", name: "Entertainment and performers" },
  { slug: "photography_video", name: "Photography and video" },
  { slug: "production_rentals", name: "Production and rentals" },
  { slug: "transport_logistics", name: "Transport and logistics" },
  { slug: "other_event_services", name: "Other event services" },
] as const;

export const serviceCategorySlugs = [
  "planning_coordination",
  "venues_decor",
  "catering_food",
  "entertainment_performers",
  "photography_video",
  "production_rentals",
  "transport_logistics",
  "other_event_services",
] as const;

export const serviceListingPricingMethods = [
  "fixed",
  "starting_at",
  "quote_only",
] as const;

export const serviceListingPublicationStatuses = [
  "draft",
  "published",
] as const;
export const serviceListingModerationStatuses = ["visible", "hidden"] as const;

const categorySchema = z.enum(serviceCategorySlugs);
const pricingMethodSchema = z.enum(serviceListingPricingMethods);
const publicationStatusSchema = z.enum(serviceListingPublicationStatuses);
const moderationStatusSchema = z.enum(serviceListingModerationStatuses);
const priceAmountPaiseSchema = z.number().int().min(0).max(2_147_483_647);
const requiredText = (maximum: number, minimum = 2) =>
  z.string().trim().min(minimum).max(maximum);
const optionalRegion = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? null : value),
  z.string().trim().min(2).max(120).nullable().optional(),
);

const priceFields = {
  pricingMethod: pricingMethodSchema,
  priceAmountPaise: priceAmountPaiseSchema.nullable(),
};

function priceMatchesMethod(value: {
  pricingMethod: "fixed" | "starting_at" | "quote_only";
  priceAmountPaise: number | null;
}): boolean {
  return value.pricingMethod === "quote_only"
    ? value.priceAmountPaise === null
    : value.priceAmountPaise !== null;
}

export const serviceListingInputSchema = z
  .strictObject({
    categorySlug: categorySchema,
    title: requiredText(120),
    description: requiredText(1200, 20),
    city: requiredText(120),
    region: optionalRegion,
    ...priceFields,
  })
  .refine(priceMatchesMethod, {
    message:
      "Quote-only listings must use a null price; fixed and starting-at listings require a price.",
    path: ["priceAmountPaise"],
  });

export const serviceListingPatchSchema = z
  .strictObject({
    categorySlug: categorySchema.optional(),
    title: requiredText(120).optional(),
    description: requiredText(1200, 20).optional(),
    city: requiredText(120).optional(),
    region: optionalRegion,
    pricingMethod: pricingMethodSchema.optional(),
    priceAmountPaise: priceAmountPaiseSchema.nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one supported listing field is required.",
  })
  .refine(
    (value) =>
      (value.pricingMethod === undefined &&
        value.priceAmountPaise === undefined) ||
      (value.pricingMethod !== undefined &&
        value.priceAmountPaise !== undefined &&
        priceMatchesMethod({
          pricingMethod: value.pricingMethod,
          priceAmountPaise: value.priceAmountPaise,
        })),
    {
      message: "Pricing method and price must be updated together.",
      path: ["pricingMethod"],
    },
  );

export const serviceListingStateSchema = z.strictObject({
  publicationStatus: publicationStatusSchema,
  moderationStatus: moderationStatusSchema,
});

export function isPublicListingState(
  state: z.infer<typeof serviceListingStateSchema>,
): boolean {
  return (
    state.publicationStatus === "published" &&
    state.moderationStatus === "visible"
  );
}

export function publishServiceListing(
  state: ServiceListingState,
): ServiceListingState {
  return { ...state, publicationStatus: "published" };
}

export function unpublishServiceListing(
  state: ServiceListingState,
): ServiceListingState {
  return { ...state, publicationStatus: "draft" };
}

export function hideServiceListing(
  state: ServiceListingState,
): ServiceListingState {
  return { ...state, moderationStatus: "hidden" };
}

export function restoreServiceListing(
  state: ServiceListingState,
): ServiceListingState {
  return { ...state, moderationStatus: "visible" };
}

export const publicServiceListingQuerySchema = z.strictObject({
  page: z.coerce.number().int().min(1).max(1000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(25),
  categorySlug: categorySchema.optional(),
  city: requiredText(120).optional(),
  region: requiredText(120).optional(),
  pricingMethod: pricingMethodSchema.optional(),
});

export const providerServiceListingQuerySchema = z.strictObject({
  page: z.coerce.number().int().min(1).max(1000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(25),
});

export const adminServiceListingQuerySchema = z.strictObject({
  page: z.coerce.number().int().min(1).max(1000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(25),
  publicationStatus: z.enum(serviceListingPublicationStatuses).optional(),
  moderationStatus: z.enum(serviceListingModerationStatuses).optional(),
  categorySlug: categorySchema.optional(),
  city: requiredText(120).optional(),
});

export type ServiceCategorySlug = (typeof serviceCategorySlugs)[number];
export type ServiceListingPricingMethod =
  (typeof serviceListingPricingMethods)[number];
export type ServiceListingPublicationStatus =
  (typeof serviceListingPublicationStatuses)[number];
export type ServiceListingModerationStatus =
  (typeof serviceListingModerationStatuses)[number];
export type ServiceListingInput = z.infer<typeof serviceListingInputSchema>;
export type ServiceListingPatch = z.infer<typeof serviceListingPatchSchema>;
export type ServiceListingState = z.infer<typeof serviceListingStateSchema>;
export type PublicServiceListingQuery = z.infer<
  typeof publicServiceListingQuerySchema
>;
export type ProviderServiceListingQuery = z.infer<
  typeof providerServiceListingQuerySchema
>;
export type AdminServiceListingQuery = z.infer<
  typeof adminServiceListingQuerySchema
>;

export interface PublicServiceListingDto {
  id: string;
  title: string;
  description: string;
  category: { slug: ServiceCategorySlug; name: string };
  city: string;
  region: string | null;
  pricingMethod: ServiceListingPricingMethod;
  priceAmountPaise: number | null;
  currency: "INR";
  provider: { displayName: string; slug: string; headline: string | null };
}
