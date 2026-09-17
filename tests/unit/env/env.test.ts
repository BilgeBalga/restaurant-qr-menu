import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";

/**
 * getSupabaseClientEnv()/getPublicEnv() memoize their result on first call
 * (module-level cache), so each test needs a fresh module instance — via
 * vi.resetModules() — to exercise validation against a different
 * process.env shape.
 */
async function loadEnvModule() {
  vi.resetModules();
  return await import("@/lib/env");
}

const ORIGINAL_ENV = { ...process.env };

describe("getSupabaseClientEnv", () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("accepts a bare project origin", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://uquipwluwycimumtkkzf.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";

    const { getSupabaseClientEnv } = await loadEnvModule();
    const env = getSupabaseClientEnv();

    expect(env.NEXT_PUBLIC_SUPABASE_URL).toBe("https://uquipwluwycimumtkkzf.supabase.co");
  });

  it("rejects a URL with a /rest/v1 path — the exact Sept 2026 production incident shape", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://uquipwluwycimumtkkzf.supabase.co/rest/v1";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";

    const { getSupabaseClientEnv } = await loadEnvModule();

    expect(() => getSupabaseClientEnv()).toThrow(/must be the bare project origin/i);
  });

  it("rejects a URL with any other trailing path segment", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://uquipwluwycimumtkkzf.supabase.co/auth/v1";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";

    const { getSupabaseClientEnv } = await loadEnvModule();

    expect(() => getSupabaseClientEnv()).toThrow(/must be the bare project origin/i);
  });

  it("accepts a bare origin with a trailing slash", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://uquipwluwycimumtkkzf.supabase.co/";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";

    const { getSupabaseClientEnv } = await loadEnvModule();

    expect(() => getSupabaseClientEnv()).not.toThrow();
  });
});
