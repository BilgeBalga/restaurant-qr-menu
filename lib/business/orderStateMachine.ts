/**
 * Order state machine (§15). This is the single source of truth for legal
 * transitions — the set_order_status Postgres RPC (Phase 6) enforces the
 * same table server-side under a row lock (Finding 3); this module is what
 * lets the rule itself be unit tested without a database.
 */

export const ORDER_STATUSES = ["new", "preparing", "ready", "completed", "cancelled"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const TERMINAL_STATUSES: readonly OrderStatus[] = ["completed", "cancelled"];

/**
 * Only the two roles the architecture actually ships (§5). `manager` and
 * `kitchen` are reserved enum values with no defined transition rights yet —
 * deliberately absent from the map below rather than guessed at, so they
 * default-deny until a real workflow defines them.
 */
export type StaffRole = "admin" | "manager" | "staff" | "kitchen";

interface Transition {
  from: OrderStatus;
  to: OrderStatus;
  allowedRoles: readonly StaffRole[];
}

const TRANSITIONS: readonly Transition[] = [
  { from: "new", to: "preparing", allowedRoles: ["admin", "staff"] },
  { from: "new", to: "cancelled", allowedRoles: ["admin", "staff"] },
  { from: "preparing", to: "ready", allowedRoles: ["admin", "staff"] },
  { from: "preparing", to: "new", allowedRoles: ["admin", "staff"] },
  { from: "preparing", to: "cancelled", allowedRoles: ["admin", "staff"] },
  { from: "ready", to: "completed", allowedRoles: ["admin", "staff"] },
  { from: "ready", to: "cancelled", allowedRoles: ["admin"] },
];

export function isTerminal(status: OrderStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/**
 * True only if moving from `from` to `to` is legal for `role` right now.
 * Same-status "transitions" are always rejected (§15: a no-op should
 * surface a stale-UI bug, not be silently swallowed), and nothing ever
 * leaves a terminal status.
 */
export function canTransition(from: OrderStatus, to: OrderStatus, role: StaffRole): boolean {
  if (from === to) return false;
  if (isTerminal(from)) return false;
  return TRANSITIONS.some((t) => t.from === from && t.to === to && t.allowedRoles.includes(role));
}

/** Every status `role` could legally move `from` right now — drives the kanban's action buttons. */
export function getAllowedTransitions(from: OrderStatus, role: StaffRole): OrderStatus[] {
  if (isTerminal(from)) return [];
  return TRANSITIONS.filter((t) => t.from === from && t.allowedRoles.includes(role)).map((t) => t.to);
}
