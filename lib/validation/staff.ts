import { z } from "zod";
import type { StaffRole } from "@/lib/business/orderStateMachine";

/**
 * Shape only, not authority — same convention as lib/validation/tables.ts.
 * restaurant_staff_write_admin (db/migrations/0002_rls_policies.sql) and
 * the app-layer can(role, "staff:manage") + wouldLeaveNoActiveAdmin()
 * checks (app/actions/staffAdmin.ts) are the real guarantees.
 *
 * Deliberately narrower than the full staff_role enum (db/migrations/
 * 0000_init_schema.sql, still ["admin","manager","staff","kitchen"] —
 * unchanged, not a migration concern). `manager`/`kitchen` have no
 * transition rights in lib/business/orderStateMachine.ts (§15 — only
 * "admin"/"staff" ship there), so assigning either role today silently
 * breaks order-management for that staff member. Restricted here to keep
 * this the single place assignment is accepted, matching the roles
 * offered in components/staff/StaffManager.tsx's dropdown — until
 * manager/kitchen get real transition rights, they're not assignable
 * through this schema. An existing membership already on one of those
 * roles (assigned before this restriction, or written directly at the DB
 * layer) is untouched — this only gates new assignments.
 */
const staffRoleValues = ["admin", "staff"] as const satisfies readonly StaffRole[];

/** The narrowed role type this schema actually accepts — for UI code (components/staff/StaffManager.tsx) building the assignment form against the same restriction, not the full StaffRole union. */
export type AssignableStaffRole = (typeof staffRoleValues)[number];

export const addStaffMemberInputSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address").max(255),
  role: z.enum(staffRoleValues),
});

export const updateStaffRoleInputSchema = z.object({
  membershipId: z.string().uuid(),
  role: z.enum(staffRoleValues),
});

export const setStaffActiveInputSchema = z.object({
  membershipId: z.string().uuid(),
  isActive: z.boolean(),
});

export type AddStaffMemberInput = z.infer<typeof addStaffMemberInputSchema>;
export type UpdateStaffRoleInput = z.infer<typeof updateStaffRoleInputSchema>;
export type SetStaffActiveInput = z.infer<typeof setStaffActiveInputSchema>;
