import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { z } from "zod";

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
