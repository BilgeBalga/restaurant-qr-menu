import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getActiveRestaurantCookie } from "@/lib/auth/activeRestaurant";
import { resolveActiveRestaurant } from "@/lib/business/restaurantSelection";
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
  staffUserId: string;
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
    staffUserId: user.id,
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
 * SaaS Phase 5 — the membership to operate on, for a user who may
 * genuinely staff more than one restaurant (restaurant_staff is a real
 * N:N join table; this used to just take memberships[0], an MVP
 * assumption that's no longer safe once one person can have several
 * active rows). The selection algorithm itself is
 * resolveActiveRestaurant() (lib/business/restaurantSelection.ts, unit-
 * tested there) — this function's only job is the I/O around it: a
 * fresh requireStaffContext() (never anything client-supplied), the
 * cookie read, and turning "selection_required" into a redirect rather
 * than silently falling back to any particular membership. Every one of
 * this function's ~40 call sites across the app already treats "call
 * this, get a StaffMembership or the request ends here" as the contract
 * — the same one requireStaffContext/requireAdminMembership have — so
 * none of them needed to change to handle the new picker path.
 */
export async function requireActiveMembership(): Promise<StaffMembership> {
  const ctx = await requireStaffContext();
  const selectedRestaurantId = await getActiveRestaurantCookie();
  const result = resolveActiveRestaurant(ctx.memberships, selectedRestaurantId);

  if (result.status === "selected") {
    return result.membership;
  }

  redirect("/staff/select-restaurant");
}

export async function requireAdminMembership(): Promise<StaffMembership> {
  const membership = await requireActiveMembership();
  if (membership.role !== "admin") {
    redirect("/staff/dashboard?error=forbidden");
  }
  return membership;
}

export interface PlatformAdminContext {
  userId: string;
  email: string | null;
}

/**
 * SaaS Phase 2 — a platform admin is checked entirely independently of
 * restaurant_staff/getStaffContext above: they may have zero restaurant
 * memberships (a pure platform employee), so this must never route
 * through requireStaffContext, which redirects away exactly that case.
 * Mirrors getStaffContext's own shape (cached per request, null for "no
 * session," never throws) rather than the RPC-call pattern used inside
 * other SQL functions — this is the app layer's existing convention for
 * re-deriving an authorization fact from a table via RLS, not is_staff_of/
 * staff_role_for's own SQL-to-SQL convention.
 *
 * The underlying query only ever returns a row for the caller's own
 * auth.uid() in the first place (platform_admins_select_platform_admin,
 * db/migrations/0011_platform_admin_foundation.sql) — a non-admin's
 * query returns nothing regardless of the WHERE clause, RLS blocks every
 * row for them, not just other people's.
 */
export const getPlatformAdminContext = cache(async (): Promise<PlatformAdminContext | null> => {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data } = await supabase.from("platform_admins").select("staff_user_id").eq("staff_user_id", user.id).maybeSingle();

  if (!data) return null;

  return { userId: user.id, email: user.email ?? null };
});

/** Redirects to login if unauthenticated, or authenticated but not a platform admin. Reuses the existing staff login page — no separate platform login exists (or is needed) yet. */
export async function requirePlatformAdmin(): Promise<PlatformAdminContext> {
  const ctx = await getPlatformAdminContext();
  if (!ctx) redirect("/staff/login?error=forbidden");
  return ctx;
}
