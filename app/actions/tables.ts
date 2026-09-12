"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireActiveMembership } from "@/lib/auth/session";
import { deriveTableStatus, type TableStatus } from "@/lib/business/tableStatus";
import type { OrderStatus } from "@/lib/business/orderStateMachine";
import { getPublicEnv } from "@/lib/env";
import { type ActionResult } from "@/lib/errors";

export interface TableQrSummary {
  qrUrl: string;
  createdAt: string;
}

export interface TableBoardRow {
  tableId: string;
  label: string;
  seats: number | null;
  isActive: boolean;
  status: TableStatus;
  activeOrderCount: number;
  sessionId: string | null;
  /**
   * null unless the caller is admin AND the table has an active QR — the
   * base tables/sessions read below stays open to every staff role
   * exactly as before; QR status is layered on only for admins, matching
   * table_qr_tokens' own RLS (a single admin-only FOR ALL policy — no
   * staff-select policy exists for that table at all, unlike tables/
   * categories/menu_items).
   */
  qr: TableQrSummary | null;
}

/**
 * §18: table status is derived here, in the app, from the same rule
 * lib/business/tableStatus.ts already encodes and unit-tests (§18) — not
 * re-implemented, and never stored. RLS already scopes every query below
 * to the caller's own restaurant. Now includes inactive tables too (the
 * is_active filter was removed) — the Tables + QR admin screen needs to
 * see and reactivate a deactivated table, which the original
 * operational-only board never needed to show.
 */
export async function listTableBoard(): Promise<ActionResult<TableBoardRow[]>> {
  const membership = await requireActiveMembership();
  const supabase = await createSupabaseServerClient();
  const isAdmin = membership.role === "admin";

  const [{ data: tables }, { data: sessions }, { data: qrTokens }] = await Promise.all([
    supabase.from("tables").select("id, label, seats, is_active").eq("restaurant_id", membership.restaurantId),
    supabase
      .from("table_sessions")
      .select("id, table_id, status, orders(status, created_at)")
      .eq("restaurant_id", membership.restaurantId)
      .eq("status", "open"),
    isAdmin
      ? supabase
          .from("table_qr_tokens")
          .select("table_id, token, created_at")
          .eq("restaurant_id", membership.restaurantId)
          .eq("is_active", true)
      : Promise.resolve({ data: null as { table_id: string; token: string; created_at: string }[] | null }),
  ]);

  const sessionByTable = new Map(
    ((sessions as { id: string; table_id: string; status: string; orders: { status: string; created_at: string }[] }[] | null) ?? []).map(
      (s) => [s.table_id, s],
    ),
  );

  const appUrl = isAdmin ? getPublicEnv().NEXT_PUBLIC_APP_URL : null;
  const qrByTable = new Map(
    ((qrTokens as { table_id: string; token: string; created_at: string }[] | null) ?? []).map((q) => [
      q.table_id,
      { token: q.token, createdAt: q.created_at },
    ]),
  );

  const rows: TableBoardRow[] = ((tables as { id: string; label: string; seats: number | null; is_active: boolean }[] | null) ?? [])
    .map((table) => {
      const session = sessionByTable.get(table.id);
      const orders = (session?.orders ?? []).map((o) => ({
        status: o.status as OrderStatus,
        createdAt: new Date(o.created_at),
      }));
      const qrEntry = qrByTable.get(table.id);

      return {
        tableId: table.id,
        label: table.label,
        seats: table.seats,
        isActive: table.is_active,
        status: deriveTableStatus(session ? { status: "open" } : null, orders),
        activeOrderCount: orders.filter((o) => o.status !== "completed" && o.status !== "cancelled").length,
        sessionId: session?.id ?? null,
        qr: qrEntry && appUrl ? { qrUrl: new URL(`/t/${qrEntry.token}`, appUrl).toString(), createdAt: qrEntry.createdAt } : null,
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));

  return { ok: true, data: rows };
}
