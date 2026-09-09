import { createBrowserClient } from "@supabase/ssr";
import { getPublicEnv } from "@/lib/env";

/**
 * RLS-scoped client for use inside "use client" components. Nothing in
 * Phase 1 calls this yet — the login flow uses a server action instead —
 * but it's wired for Phase 4+ (cart, live tracking subscriptions).
 */
export function createSupabaseBrowserClient() {
  const env = getPublicEnv();
  return createBrowserClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}
