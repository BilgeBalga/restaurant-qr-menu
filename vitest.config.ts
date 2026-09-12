import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
  },
  resolve: {
    alias: {
      // See tests/mocks/server-only.ts for why this alias exists.
      "server-only": new URL("./tests/mocks/server-only.ts", import.meta.url).pathname,
      "@": import.meta.dirname,
    },
  },
});
