import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { z } from "zod";

function isExactOrigin(value: string): boolean {
  try {
    return new URL(value).origin === value;
  } catch {
    return false;
  }
}

dotenv.config({
  path: fileURLToPath(new URL("../../../../.env", import.meta.url)),
});

const environmentSchema = z.object({
  DATABASE_URL: z
    .string()
    .url()
    .refine((value) => /^postgres(?:ql)?:\/\//i.test(value), {
      message: "must use the postgres or postgresql protocol",
    }),
  PORT: z.preprocess(
    (value) => (value === "" || value === undefined ? 3001 : Number(value)),
    z.number().int().min(1).max(65535),
  ),
  SESSION_SECRET: z.string().min(32, "must contain at least 32 characters"),
  APP_ORIGIN: z.preprocess(
    (value) =>
      value === "" || value === undefined ? "http://127.0.0.1:5173" : value,
    z.url().refine(isExactOrigin, {
      message: "must be an origin without a path",
    }),
  ),
  TRUST_PROXY_HOPS: z.preprocess(
    (value) => (value === "" || value === undefined ? 0 : Number(value)),
    z.number().int().min(0).max(5),
  ),
  NODE_ENV: z.preprocess(
    (value) => (value === "" || value === undefined ? "development" : value),
    z.enum(["development", "test", "production"]),
  ),
});

const result = environmentSchema.safeParse(process.env);

if (!result.success) {
  const issues = result.error.issues
    .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
    .join("; ");
  throw new Error(`Invalid API environment configuration: ${issues}`);
}

export const env = result.data;
