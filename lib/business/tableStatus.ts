import type { OrderStatus } from "@/lib/business/orderStateMachine";

/**
 * Derived table status (§18). Table status is never stored — it's
 * computed from the table's open session and that session's orders, so it
 * cannot drift from reality the way a stored status column could.
 *
 * This also encodes Finding 2 from the critical review: because
 * set_order_status auto-closes a session the instant its last non-terminal
 * order finishes, "open session with zero active orders" should never
 * actually be observed. The fallback below exists only as a defensive
 * default for that theoretically-unreachable case — if it's ever hit in
 * practice, that's a bug in the auto-close logic, not a valid steady state.
 */

export type TableStatus = "available" | "ordering" | "preparing" | "needs_attention";

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

  // Should not be reachable given the auto-close invariant above — see module note.
  return "available";
}
