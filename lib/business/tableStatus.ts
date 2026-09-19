import type { OrderStatus } from "@/lib/business/orderStateMachine";

/**
 * Derived table status (§18). Table status is never stored — it's
 * computed from the table's open session and that session's orders, so it
 * cannot drift from reality the way a stored status column could.
 *
 * Table sessions no longer auto-close when their last order finishes
 * (db/migrations/0017_remove_order_status_session_autoclose.sql) — a
 * session now stays open, across any number of orders, until staff
 * explicitly clear_table()s it. That makes "open session, every order
 * terminal" a real, common steady state (party has been served, staff
 * hasn't cleared the table yet) rather than the unreachable case it used
 * to be — "served" exists to represent exactly that, distinct from
 * "available" (no open session at all) so the table doesn't look free
 * for new seating while a party is still there.
 */

export type TableStatus = "available" | "ordering" | "preparing" | "needs_attention" | "served";

export interface TableSessionInfo {
  status: "open" | "closed";
}

export interface TableOrderInfo {
  status: OrderStatus;
  createdAt: Date;
}

const DEFAULT_UNATTENDED_THRESHOLD_MINUTES = 10;

export function deriveTableStatus(
  session: TableSessionInfo | null,
  orders: readonly TableOrderInfo[],
  now: Date = new Date(),
  unattendedThresholdMinutes: number = DEFAULT_UNATTENDED_THRESHOLD_MINUTES,
): TableStatus {
  if (!session || session.status === "closed") return "available";
  if (orders.length === 0) return "ordering";

  const thresholdMs = unattendedThresholdMinutes * 60_000;

  const hasReady = orders.some((o) => o.status === "ready");
  const hasStaleNew = orders.some(
    (o) => o.status === "new" && now.getTime() - o.createdAt.getTime() > thresholdMs,
  );
  if (hasReady || hasStaleNew) return "needs_attention";

  const hasActive = orders.some((o) => o.status === "new" || o.status === "preparing");
  if (hasActive) return "preparing";

  // Session open, at least one order, none active/ready/stale — every
  // order that's been placed has run to completed/cancelled. The party
  // may still be at the table; staff hasn't clicked Clear table yet.
  return "served";
}

/** Whether the staff UI should offer "Clear table" for a table in this status — anything but "available", since "available" means there's no open session left to clear. */
export function canClearTable(status: TableStatus): boolean {
  return status !== "available";
}
