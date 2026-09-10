import "server-only";
import { createClient } from "@supabase/supabase-js";
import { getServerEnv } from "@/lib/env.server";

/**
 * Secret-key client — bypasses RLS entirely (§26). Reserved for the
 * order-creation / status-transition server actions that call the
 * create_order / set_order_status RPCs (Phase 6). Nothing in Phase 1 uses
 * this yet. The `server-only` import (transitively, via env.server.ts and
 * directly here) means an accidental "use client" import fails at build
 * time rather than shipping a secret to the browser.
 */
export function createSupabaseAdminClient() {
  const env = getServerEnv();
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
