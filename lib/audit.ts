import "server-only";
import type { createSupabaseServerClient } from "@/lib/supabase/server";

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

/**
 * Thin wrapper around the log_audit_event RPC (db/migrations/0001_functions.sql)
 * — the audit_logs table and that function already exist and were built
 * ahead of any caller; this is not a second audit system, just the one
 * shared call site every admin-write action uses instead of duplicating
 * the same try/catch. Best-effort: a logging failure is reported to the
 * server console but never fails the write that already succeeded.
 */
export async function logAuditEvent(
  supabase: SupabaseServerClient,
  params: {
    /** null only for a genuinely platform-level event with no restaurant to attach to (SaaS Phase 2) — every restaurant-scoped action still always passes a real id. */
    restaurantId: string | null;
    action: string;
    entityType: string;
    entityId: string;
    previousValue?: unknown;
    newValue?: unknown;
  },
): Promise<void> {
  try {
    await supabase.rpc("log_audit_event", {
      p_restaurant_id: params.restaurantId,
      p_action: params.action,
      p_entity_type: params.entityType,
      p_entity_id: params.entityId,
      p_previous_value: params.previousValue ?? null,
      p_new_value: params.newValue ?? null,
    });
  } catch (error) {
    console.error("Failed to record audit log:", error);
  }
}
