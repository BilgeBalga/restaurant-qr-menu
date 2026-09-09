import { defineConfig } from "vitest/config";

/**
 * Separate from vitest.config.ts (unit tests, no I/O) because these hit a
 * real local Postgres (tests/integration/harness) — see package.json's
 * test:db:start. Run sequentially: most fixtures are isolated by a fresh
 * restaurant_id per test, but a handful of tests deliberately exercise
 * real concurrency (two simultaneous connections against the SAME row)
 * and shouldn't be interleaved with unrelated test files doing the same
 * kind of thing on a small local instance.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    globalSetup: ["./tests/integration/global-teardown.ts"],
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
  resolve: {
    alias: {
      "@": import.meta.dirname,
    },
  },
});
