import { z } from "zod";

const normalizedEmail = z
  .string()
  .trim()
  .max(254)
  .pipe(z.email())
  .transform((email) => email.toLowerCase());

export const registrationSchema = z.strictObject({
  email: normalizedEmail,
  password: z.string().min(12).max(128),
});

export const loginSchema = z.strictObject({
  email: normalizedEmail,
  password: z.string().min(1).max(128),
});

export const accountEmailSchema = z.strictObject({
  email: normalizedEmail,
});

const token = z
  .string()
  .length(43)
  .regex(/^[A-Za-z0-9_-]{43}$/);

export const verificationSchema = z.strictObject({ token });

export const passwordResetSchema = z.strictObject({
  token,
  password: z.string().min(12).max(128),
});

export const userIdParamsSchema = z.strictObject({ userId: z.uuid() });

export type RegistrationInput = z.infer<typeof registrationSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
