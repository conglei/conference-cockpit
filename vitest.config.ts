import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Force the response cache OFF suite-wide (no test writes data/api-cache.db).
    setupFiles: ["tests/setup.ts"],
  },
});
