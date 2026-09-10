import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { StaffRole } from "@/lib/business/orderStateMachine";

/**
 * The real authorization boundary (§19 finding, §26). proxy.ts only
 * checks "is there a valid Supabase session" — optimistic, fast-rejection
 * (Next's own Proxy guidance: cookie-only checks there, the real
 * guarantee close to the data). Every staff page and server action calls
 * one of the functions below independently; none of them trust a
 * client-supplied restaurant_id or role — both are re-derived here from
 * restaurant_staff, every time.
 */

export interface StaffMembership {
  restaurantId: string;
  restaurantName: string;
  role: StaffRole;
}

export interface StaffContext {
  userId: string;
  email: string | null;
  memberships: StaffMembership[];
}

interface RestaurantStaffRow {
  restaurant_id: string;
  role: string;
  restaurants: { name: string } | { name: string }[] | null;
}

function restaurantNameFrom(restaurants: RestaurantStaffRow["restaurants"]): string {
  if (!restaurants) return "Unknown restaurant";
  const row = Array.isArray(restaurants) ? restaurants[0] : restaurants;
  return row?.name ?? "Unknown restaurant";
}

/**
 * Cached per-request (React's `cache`) so rendering a page that touches
 * this multiple times doesn't re-hit Supabase multiple times. Returns
 * null for "no session," never throws for that case — callers that need
 * to enforce staff-only access should use requireStaffContext instead.
 */
export const getStaffContext = cache(async (): Promise<StaffContext | null> => {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  // RLS (restaurant_staff_select_staff, §26) already scopes this to the
  // caller's own rows — this can never return another user's membership.
  const { data: rows } = await supabase
    .from("restaurant_staff")
    .select("restaurant_id, role, restaurants(name)")
    .eq("staff_user_id", user.id)
    .eq("is_active", true);

  const memberships: StaffMembership[] = ((rows as RestaurantStaffRow[] | null) ?? []).map((row) => ({
    restaurantId: row.restaurant_id,
    restaurantName: restaurantNameFrom(row.restaurants),
    role: row.role as StaffRole,
  }));

  return { userId: user.id, email: user.email ?? null, memberships };
});

/** Redirects to login if unauthenticated, or authenticated but staff nowhere. */
export async function requireStaffContext(): Promise<StaffContext> {
  const ctx = await getStaffContext();
  if (!ctx) redirect("/staff/login");
  if (ctx.memberships.length === 0) redirect("/staff/login?error=not_staff");
  return ctx;
}

/**
 * The membership to operate on. MVP assumption (§5): one restaurant per
 * staff account — the schema supports more (restaurant_staff is a real
 * join table), but no UI exists yet to choose between multiple, so the
 * first active membership is used. Revisit if/when a person genuinely
 * staffs more than one restaurant.
 */
export async function requireActiveMembership(): Promise<StaffMembership> {
  const ctx = await requireStaffContext();
  // Non-null: requireStaffContext already redirected away if this were empty.
  return ctx.memberships[0]!;
}

export async function requireAdminMembership(): Promise<StaffMembership> {
  const membership = await requireActiveMembership();
  if (membership.role !== "admin") {
    redirect("/staff/dashboard?error=forbidden");
  }
  return membership;
}
