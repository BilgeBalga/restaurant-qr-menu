import type { StaffRole } from "@/lib/business/orderStateMachine";

/**
 * Role → action permission map (§11). Only `admin` and `staff` have
 * concretely specified permissions in the architecture; `manager` and
 * `kitchen` are reserved roles (§5) whose exact permission sets were
 * explicitly deferred, not yet designed. Rather than invent policy for
 * them, they default to the same floor as `staff` — the documented
 * description of "sits between admin and staff" / "order queue only" — and
 * are called out as provisional so this isn't mistaken for a final answer.
 *
 * This is the fast-rejection layer only (§11: "enforced twice, deliberately").
 * The actual guarantee is Postgres RLS + the SECURITY DEFINER RPCs (§26),
 * which do not exist yet — they arrive with the Phase 2 schema.
 */

export type StaffAction =
  | "menu:write"
  | "tables:write"
  | "orders:read"
  | "orders:status:write"
  | "orders:cancel"
  | "orders:cancel:ready"
  | "history:read"
  | "staff:manage"
  | "settings:write"
  | "audit:read";

const ADMIN_ACTIONS: readonly StaffAction[] = [
  "menu:write",
  "tables:write",
  "orders:read",
  "orders:status:write",
  "orders:cancel",
  "orders:cancel:ready",
  "history:read",
  "staff:manage",
  "settings:write",
  "audit:read",
];

const STAFF_ACTIONS: readonly StaffAction[] = [
  "orders:read",
  "orders:status:write",
  "orders:cancel",
  "history:read",
];

const ROLE_ACTIONS: Record<StaffRole, readonly StaffAction[]> = {
  admin: ADMIN_ACTIONS,
  staff: STAFF_ACTIONS,
  // Provisional — see module note above.
  manager: STAFF_ACTIONS,
  kitchen: ["orders:read", "orders:status:write"],
};

export function can(role: StaffRole, action: StaffAction): boolean {
  return ROLE_ACTIONS[role].includes(action);
}
