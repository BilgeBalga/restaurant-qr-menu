import type { StaffRole } from "@/lib/business/orderStateMachine";

/**
 * Staff Management's one real invariant: a restaurant must always keep at
 * least one active admin, or nobody could ever manage staff/settings again.
 * Neither RLS nor any DB constraint enforces this (restaurant_staff_write_admin
 * only checks that the ACTOR is currently an admin, not what state their
 * write would leave the table in) — this is the server-side check the
 * architecture explicitly calls for, kept here as a pure function (no DB
 * access) so it can be unit-tested directly, the same convention as
 * orderStateMachine.ts/tableStatus.ts.
 */
export interface StaffMembershipSummary {
  id: string;
  role: StaffRole;
  isActive: boolean;
}

/**
 * True if applying `change` to the member `targetId` within `roster` (the
 * restaurant's full current membership list, including the target itself)
 * would leave zero active admins. General over role change AND
 * activate/deactivate so one function covers both call sites — a no-op
 * change (e.g. re-selecting the same role) always evaluates against the
 * roster's actual current state, so it never blocks a genuine no-op.
 */
export function wouldLeaveNoActiveAdmin(
  roster: readonly StaffMembershipSummary[],
  targetId: string,
  change: { role?: StaffRole; isActive?: boolean },
): boolean {
  return !roster.some((member) => {
    const role = member.id === targetId && change.role !== undefined ? change.role : member.role;
    const isActive = member.id === targetId && change.isActive !== undefined ? change.isActive : member.isActive;
    return role === "admin" && isActive;
  });
}
