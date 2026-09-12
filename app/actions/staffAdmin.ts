"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireActiveMembership } from "@/lib/auth/session";
import { findOrCreateStaffAuthUser, type StaffAuthAdminClient } from "@/lib/auth/adminUsers";
import { can } from "@/lib/business/permissions";
import { wouldLeaveNoActiveAdmin, type StaffMembershipSummary } from "@/lib/business/staffAccess";
import type { StaffRole } from "@/lib/business/orderStateMachine";
import { logAuditEvent } from "@/lib/audit";
import { AppError, toActionResult, type ActionResult } from "@/lib/errors";
import {
  addStaffMemberInputSchema,
  setStaffActiveInputSchema,
  updateStaffRoleInputSchema,
  type AddStaffMemberInput,
  type SetStaffActiveInput,
  type UpdateStaffRoleInput,
} from "@/lib/validation/staff";

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

export interface StaffMemberView {
  membershipId: string;
  staffUserId: string;
  email: string;
  fullName: string;
  role: StaffRole;
  isActive: boolean;
  createdAt: string;
  /** True for the row belonging to whoever is viewing the list — lets the UI warn before someone edits their own access. */
  isSelf: boolean;
}

function requireStaffManage(role: StaffRole): ReturnType<typeof toActionResult> | null {
  if (!can(role, "staff:manage")) {
    return toActionResult(new AppError("FORBIDDEN", "role lacks staff:manage", "You don't have permission to manage staff."));
  }
  return null;
}

function isUniqueViolation(error: { code?: string } | null): boolean {
  return error?.code === "23505";
}

type RosterRow = { id: string; role: StaffRole; is_active: boolean };

/** The whole restaurant's current roster, in the shape wouldLeaveNoActiveAdmin() needs — always re-derived server-side, never trusted from the client. */
async function loadRoster(supabase: SupabaseServerClient, restaurantId: string): Promise<StaffMembershipSummary[]> {
  const { data } = await supabase.from("restaurant_staff").select("id, role, is_active").eq("restaurant_id", restaurantId);
  return ((data as RosterRow[] | null) ?? []).map((r) => ({ id: r.id, role: r.role, isActive: r.is_active }));
}

type MemberRow = {
  id: string;
  staff_user_id: string;
  role: StaffRole;
  is_active: boolean;
  created_at: string;
  staff_users: { email: string; full_name: string } | { email: string; full_name: string }[] | null;
};

function toStaffMemberView(row: MemberRow, viewerUserId: string): StaffMemberView {
  const staffUser = Array.isArray(row.staff_users) ? row.staff_users[0] : row.staff_users;
  return {
    membershipId: row.id,
    staffUserId: row.staff_user_id,
    email: staffUser?.email ?? "—",
    fullName: staffUser?.full_name ?? "",
    role: row.role,
    isActive: row.is_active,
    createdAt: row.created_at,
    isSelf: row.staff_user_id === viewerUserId,
  };
}

const MEMBER_SELECT = "id, staff_user_id, role, is_active, created_at, staff_users ( email, full_name )";

/**
 * The restaurant's staff roster. restaurant_id comes only from
 * requireActiveMembership() (re-derived from restaurant_staff, never from
 * client input); RLS (restaurant_staff_select_staff) independently scopes
 * this to the caller's own restaurant regardless — any active staff role
 * may view the list, matching restaurant_staff's own read policy (only
 * writes are admin-only).
 */
export async function listStaffMembers(): Promise<ActionResult<StaffMemberView[]>> {
  const membership = await requireActiveMembership();
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from("restaurant_staff")
    .select(MEMBER_SELECT)
    .eq("restaurant_id", membership.restaurantId)
    .order("created_at", { ascending: true });

  if (error) {
    return toActionResult(new AppError("INTERNAL", error.message, "Couldn't load the staff list right now."));
  }

  const rows = (data as MemberRow[] | null) ?? [];
  return { ok: true, data: rows.map((row) => toStaffMemberView(row, user?.id ?? "")) };
}

/**
 * Adds a staff member to the CURRENT admin's restaurant only —
 * restaurantId always comes from requireActiveMembership(), never from
 * `input`. Finds-or-creates the Auth account via the service-role client
 * (lib/auth/adminUsers.ts; SUPABASE_SECRET_KEY never leaves this
 * "use server" file), then inserts the restaurant_staff row through the
 * normal RLS-scoped client — restaurant_staff_write_admin independently
 * re-derives "is this caller actually an admin here" server-side too.
 */
export async function addStaffMember(input: AddStaffMemberInput): Promise<
  ActionResult<{ member: StaffMemberView; temporaryPassword: string | null }>
> {
  const membership = await requireActiveMembership();
  const forbidden = requireStaffManage(membership.role);
  if (forbidden) return forbidden;

  const parsed = addStaffMemberInputSchema.safeParse(input);
  if (!parsed.success) {
    return toActionResult(new AppError("VALIDATION_ERROR", parsed.error.message, "Please check the email and role."));
  }

  // The full generated SupabaseClient type is too deep for TS to structurally
  // check against StaffAuthAdminClient's narrow interface (excessive-depth
  // instantiation error) — this cast is an interop detail confined to this
  // one call site; findOrCreateStaffAuthUser's own tests fully exercise the
  // interface's contract independently.
  const admin = createSupabaseAdminClient() as unknown as StaffAuthAdminClient;
  const resolved = await findOrCreateStaffAuthUser(admin, parsed.data.email);
  if (!resolved.ok) {
    return toActionResult(new AppError("INTERNAL", resolved.error, "Couldn't create or find that staff account. Please try again."));
  }

  const supabase = await createSupabaseServerClient();

  const { data: existingMembership } = await supabase
    .from("restaurant_staff")
    .select("id")
    .eq("restaurant_id", membership.restaurantId)
    .eq("staff_user_id", resolved.data.id)
    .maybeSingle();

  if (existingMembership) {
    return toActionResult(
      new AppError(
        "CONFLICT",
        "already a member of this restaurant",
        "This person is already on your staff list — use their row to change their role or status instead.",
      ),
    );
  }

  const { data: inserted, error: insertError } = await supabase
    .from("restaurant_staff")
    .insert({ restaurant_id: membership.restaurantId, staff_user_id: resolved.data.id, role: parsed.data.role })
    .select(MEMBER_SELECT)
    .single();

  if (insertError || !inserted) {
    if (isUniqueViolation(insertError)) {
      return toActionResult(
        new AppError(
          "CONFLICT",
          insertError!.message,
          "This person is already on your staff list — use their row to change their role or status instead.",
        ),
      );
    }
    return toActionResult(
      new AppError("INTERNAL", insertError?.message ?? "insert failed", "Couldn't add this staff member. Please try again."),
    );
  }

  await logAuditEvent(supabase, {
    restaurantId: membership.restaurantId,
    action: "staff.add",
    entityType: "restaurant_staff",
    entityId: inserted.id,
    newValue: { email: parsed.data.email, role: parsed.data.role, newAuthAccount: resolved.data.created },
  });

  return {
    ok: true,
    data: {
      member: toStaffMemberView(inserted as MemberRow, ""),
      temporaryPassword: resolved.data.temporaryPassword,
    },
  };
}

/**
 * Changes a membership's role, within the current admin's own restaurant
 * only. wouldLeaveNoActiveAdmin() runs against a freshly-loaded roster —
 * never a client-supplied one — so a stale UI can't be used to sneak past
 * the last-admin guarantee.
 */
export async function updateStaffRole(input: UpdateStaffRoleInput): Promise<ActionResult<StaffMemberView>> {
  const membership = await requireActiveMembership();
  const forbidden = requireStaffManage(membership.role);
  if (forbidden) return forbidden;

  const parsed = updateStaffRoleInputSchema.safeParse(input);
  if (!parsed.success) {
    return toActionResult(new AppError("VALIDATION_ERROR", parsed.error.message, "That role isn't valid."));
  }

  const supabase = await createSupabaseServerClient();

  const { data: target } = await supabase
    .from("restaurant_staff")
    .select("id, role, is_active")
    .eq("id", parsed.data.membershipId)
    .eq("restaurant_id", membership.restaurantId)
    .maybeSingle();

  if (!target) {
    return toActionResult(new AppError("NOT_FOUND", "membership not found for restaurant", "Couldn't find that staff member."));
  }

  const roster = await loadRoster(supabase, membership.restaurantId);
  if (wouldLeaveNoActiveAdmin(roster, target.id, { role: parsed.data.role })) {
    return toActionResult(
      new AppError(
        "CONFLICT",
        "would leave restaurant with no active admin",
        "This restaurant needs at least one active admin — promote someone else first.",
      ),
    );
  }

  const { data: updated, error } = await supabase
    .from("restaurant_staff")
    .update({ role: parsed.data.role })
    .eq("id", parsed.data.membershipId)
    .eq("restaurant_id", membership.restaurantId)
    .select(MEMBER_SELECT)
    .single();

  if (error || !updated) {
    return toActionResult(new AppError("INTERNAL", error?.message ?? "update failed", "Couldn't update this staff member's role."));
  }

  await logAuditEvent(supabase, {
    restaurantId: membership.restaurantId,
    action: "staff.role_change",
    entityType: "restaurant_staff",
    entityId: parsed.data.membershipId,
    previousValue: { role: target.role },
    newValue: { role: parsed.data.role },
  });

  return { ok: true, data: toStaffMemberView(updated as MemberRow, "") };
}

/**
 * Activates or deactivates a membership, within the current admin's own
 * restaurant only. Same last-admin guarantee as updateStaffRole — a
 * deactivation that would leave zero active admins is rejected before it
 * ever reaches the UPDATE.
 */
export async function setStaffActive(input: SetStaffActiveInput): Promise<ActionResult<StaffMemberView>> {
  const membership = await requireActiveMembership();
  const forbidden = requireStaffManage(membership.role);
  if (forbidden) return forbidden;

  const parsed = setStaffActiveInputSchema.safeParse(input);
  if (!parsed.success) {
    return toActionResult(new AppError("VALIDATION_ERROR", parsed.error.message, "That request isn't valid."));
  }

  const supabase = await createSupabaseServerClient();

  const { data: target } = await supabase
    .from("restaurant_staff")
    .select("id, role, is_active")
    .eq("id", parsed.data.membershipId)
    .eq("restaurant_id", membership.restaurantId)
    .maybeSingle();

  if (!target) {
    return toActionResult(new AppError("NOT_FOUND", "membership not found for restaurant", "Couldn't find that staff member."));
  }

  const roster = await loadRoster(supabase, membership.restaurantId);
  if (wouldLeaveNoActiveAdmin(roster, target.id, { isActive: parsed.data.isActive })) {
    return toActionResult(
      new AppError(
        "CONFLICT",
        "would leave restaurant with no active admin",
        "This restaurant needs at least one active admin — you can't deactivate the last one.",
      ),
    );
  }

  const { data: updated, error } = await supabase
    .from("restaurant_staff")
    .update({ is_active: parsed.data.isActive })
    .eq("id", parsed.data.membershipId)
    .eq("restaurant_id", membership.restaurantId)
    .select(MEMBER_SELECT)
    .single();

  if (error || !updated) {
    return toActionResult(new AppError("INTERNAL", error?.message ?? "update failed", "Couldn't update this staff member."));
  }

  await logAuditEvent(supabase, {
    restaurantId: membership.restaurantId,
    action: parsed.data.isActive ? "staff.activate" : "staff.deactivate",
    entityType: "restaurant_staff",
    entityId: parsed.data.membershipId,
    previousValue: { isActive: target.is_active },
    newValue: { isActive: parsed.data.isActive },
  });

  return { ok: true, data: toStaffMemberView(updated as MemberRow, "") };
}
