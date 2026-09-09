import { defineConfig, devices } from "@playwright/test";

/**
 * Config only for Phase 1 — no specs yet (tests/e2e is empty). Real E2E
 * flows arrive once there's an actual customer/staff journey to exercise:
 * the §39 acceptance scenario (Phase 8) and the login→kanban flow (Phase 7).
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  reporter: "html",
  use: {
    baseURL: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
  },
});
