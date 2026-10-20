import { z } from "zod";

export const HealthResponseSchema = z.object({
  data: z.object({
    status: z.literal("ok"),
    service: z.literal("evently-api"),
  }),
});

export const ApiErrorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string().uuid(),
  }),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;
export type ApiErrorResponse = z.infer<typeof ApiErrorResponseSchema>;
