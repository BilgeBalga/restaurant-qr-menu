import { createBrowserClient } from "@supabase/ssr";
import { getSupabaseClientEnv } from "@/lib/env";

/**
 * RLS-scoped client for use inside "use client" components (cart, live
 * order tracking). Uses getSupabaseClientEnv(), not getPublicEnv() — this
 * client has no need for NEXT_PUBLIC_APP_URL, and requiring it here would
 * be an incidental coupling, not a real dependency.
 */
export function createSupabaseBrowserClient() {
  const env = getSupabaseClientEnv();
  return createBrowserClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
}
