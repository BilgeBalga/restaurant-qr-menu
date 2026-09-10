"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireActiveMembership } from "@/lib/auth/session";
import type { ActionResult } from "@/lib/errors";

export interface DashboardMetrics {
  newCount: number;
  preparingCount: number;
  readyCount: number;
  completedToday: number;
  revenueTodayCents: number;
  activeTables: number;
}

/** §17: five numbers, no chart clutter — "what needs attention right now." */
export async function getDashboardMetrics(): Promise<ActionResult<DashboardMetrics>> {
  const membership = await requireActiveMembership();
  const supabase = await createSupabaseServerClient();
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const [statusCounts, completedToday, openSessions] = await Promise.all([
    supabase.from("orders").select("status").in("status", ["new", "preparing", "ready"]),
    supabase
      .from("orders")
      .select("total_cents")
      .eq("status", "completed")
      .gte("updated_at", startOfToday.toISOString()),
    supabase.from("table_sessions").select("id").eq("restaurant_id", membership.restaurantId).eq("status", "open"),
  ]);

  const rows = (statusCounts.data as { status: string }[] | null) ?? [];
  const completedRows = (completedToday.data as { total_cents: number }[] | null) ?? [];

  return {
    ok: true,
    data: {
      newCount: rows.filter((r) => r.status === "new").length,
      preparingCount: rows.filter((r) => r.status === "preparing").length,
      readyCount: rows.filter((r) => r.status === "ready").length,
      completedToday: completedRows.length,
      revenueTodayCents: completedRows.reduce((sum, r) => sum + r.total_cents, 0),
      activeTables: (openSessions.data ?? []).length,
    },
  };
}
