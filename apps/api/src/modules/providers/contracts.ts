import { z } from "zod";

export const providerTypes = [
  "event_organizer",
  "event_manager",
  "artist_performer",
  "vendor_service_provider",
] as const;

const requiredText = (maximum: number, minimum = 2) =>
  z.string().trim().min(minimum).max(maximum);

const optionalText = (maximum: number) =>
  z.string().trim().max(maximum).optional();

export const providerApplicationSchema = z.strictObject({
  displayName: requiredText(120),
  description: requiredText(1200, 20),
  city: requiredText(120),
  region: z.string().trim().max(120).optional(),
  country: requiredText(80),
  providerTypes: z
    .array(z.enum(providerTypes))
    .min(1)
    .max(providerTypes.length)
    .refine((values) => new Set(values).size === values.length),
});

export const providerApplicationQuerySchema = z.strictObject({
  page: z.coerce.number().int().min(1).max(1000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(25),
  status: z.enum(["pending", "approved", "rejected"]).optional(),
});

export const providerApplicationIdParamsSchema = z.strictObject({
  applicationId: z.uuid(),
});

export const emptyActionSchema = z.strictObject({});

export const rejectProviderApplicationSchema = z.strictObject({
  reason: requiredText(500, 8),
});

export const professionalProfilePatchSchema = z
  .strictObject({
    displayName: requiredText(120).optional(),
    headline: optionalText(160),
    bio: optionalText(1200),
    city: requiredText(120).optional(),
    region: optionalText(120),
    country: requiredText(80).optional(),
  })
  .refine((value) => Object.keys(value).length > 0);

export type ProviderType = (typeof providerTypes)[number];
export type ProviderApplicationInput = z.infer<
  typeof providerApplicationSchema
>;
export type ProviderApplicationStatus = "pending" | "approved" | "rejected";
export type ProviderApplicationQuery = z.infer<
  typeof providerApplicationQuerySchema
>;
export type ProfessionalProfilePatch = z.infer<
  typeof professionalProfilePatchSchema
>;
