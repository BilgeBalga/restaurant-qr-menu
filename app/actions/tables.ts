"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireActiveMembership } from "@/lib/auth/session";
import { deriveTableStatus, type TableStatus } from "@/lib/business/tableStatus";
import type { OrderStatus } from "@/lib/business/orderStateMachine";
import { type ActionResult } from "@/lib/errors";

export interface TableBoardRow {
  tableId: string;
  label: string;
  seats: number | null;
  status: TableStatus;
  activeOrderCount: number;
  sessionId: string | null;
}

/**
 * §18: table status is derived here, in the app, from the same rule
 * lib/business/tableStatus.ts already encodes and unit-tests (§18) — not
 * re-implemented, and never stored. RLS already scopes every query below
 * to the caller's own restaurant.
 */
export async function listTableBoard(): Promise<ActionResult<TableBoardRow[]>> {
  const membership = await requireActiveMembership();
  const supabase = await createSupabaseServerClient();

  const [{ data: tables }, { data: sessions }] = await Promise.all([
    supabase
      .from("tables")
      .select("id, label, seats")
      .eq("restaurant_id", membership.restaurantId)
      .eq("is_active", true),
    supabase
      .from("table_sessions")
      .select("id, table_id, status, orders(status, created_at)")
      .eq("restaurant_id", membership.restaurantId)
      .eq("status", "open"),
  ]);

  const sessionByTable = new Map(
    ((sessions as { id: string; table_id: string; status: string; orders: { status: string; created_at: string }[] }[] | null) ?? []).map(
      (s) => [s.table_id, s],
    ),
  );

  const rows: TableBoardRow[] = ((tables as { id: string; label: string; seats: number | null }[] | null) ?? [])
    .map((table) => {
      const session = sessionByTable.get(table.id);
      const orders = (session?.orders ?? []).map((o) => ({
        status: o.status as OrderStatus,
        createdAt: new Date(o.created_at),
      }));
      return {
        tableId: table.id,
        label: table.label,
        seats: table.seats,
        status: deriveTableStatus(session ? { status: "open" } : null, orders),
        activeOrderCount: orders.filter((o) => o.status !== "completed" && o.status !== "cancelled").length,
        sessionId: session?.id ?? null,
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));

  return { ok: true, data: rows };
}
