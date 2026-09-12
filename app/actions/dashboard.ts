"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireActiveMembership } from "@/lib/auth/session";
import { startOfDayInTimeZone } from "@/lib/business/timezone";
import type { ActionResult } from "@/lib/errors";

export interface DashboardMetrics {
  newCount: number;
  preparingCount: number;
  readyCount: number;
  completedToday: number;
  revenueTodayCents: number;
  currency: string;
  activeTables: number;
}

/** §17: five numbers, no chart clutter — "what needs attention right now." */
export async function getDashboardMetrics(): Promise<ActionResult<DashboardMetrics>> {
  const membership = await requireActiveMembership();
  const supabase = await createSupabaseServerClient();

  // Fetched first (not in the Promise.all below) because "today" itself
  // depends on the restaurant's timezone — this used to be the server
  // process's own local time, which is wrong for any restaurant not
  // sitting in that same zone.
  const { data: restaurant } = await supabase
    .from("restaurants")
    .select("currency, timezone")
    .eq("id", membership.restaurantId)
    .single();
  const currency = (restaurant as { currency: string; timezone: string } | null)?.currency ?? "USD";
  const timezone = (restaurant as { currency: string; timezone: string } | null)?.timezone ?? "UTC";
  const startOfToday = startOfDayInTimeZone(timezone);

  const [statusCounts, completedToday, openSessions] = await Promise.all([
    supabase
      .from("orders")
      .select("status")
      .eq("restaurant_id", membership.restaurantId)
      .in("status", ["new", "preparing", "ready"]),
    supabase
      .from("orders")
      .select("total_cents")
      .eq("restaurant_id", membership.restaurantId)
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
      currency,
      activeTables: (openSessions.data ?? []).length,
    },
  };
}
