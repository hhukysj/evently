import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "apps/**/*.test.{ts,tsx}",
      "packages/**/*.test.{ts,tsx}",
      "e2e/**/*.test.ts",
    ],
    exclude: ["**/*.integration.test.{ts,tsx}"],
    environment: "node",
  },
});
