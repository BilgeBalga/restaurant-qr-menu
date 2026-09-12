import { z } from "zod";
import type { StaffRole } from "@/lib/business/orderStateMachine";

/**
 * Shape only, not authority — same convention as lib/validation/tables.ts.
 * restaurant_staff_write_admin (db/migrations/0002_rls_policies.sql) and
 * the app-layer can(role, "staff:manage") + wouldLeaveNoActiveAdmin()
 * checks (app/actions/staffAdmin.ts) are the real guarantees.
 *
 * The full staff_role enum (db/migrations/0000_init_schema.sql), not a
 * narrower subset — manager/kitchen already have real, if provisional,
 * permission sets defined in lib/business/permissions.ts, so they're
 * legitimate values to assign, not a new role system.
 */
const staffRoleValues = ["admin", "manager", "staff", "kitchen"] as const satisfies readonly StaffRole[];

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
