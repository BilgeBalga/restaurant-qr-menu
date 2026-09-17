"use server";

import { redirect } from "next/navigation";
import { AppError, toActionResult, type ActionResult } from "@/lib/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireStaffContext } from "@/lib/auth/session";
import { clearActiveRestaurantCookie, setActiveRestaurantCookie } from "@/lib/auth/activeRestaurant";

/**
 * Thin server action per §22 — validation + the actual work happen one
 * layer down (Supabase Auth for credential verification, restaurant_staff
 * for the "are they actually staff anywhere" check added in Phase 3).
 *
 * A valid Supabase Auth account is necessary but not sufficient: someone
 * could exist in auth.users without ever being added to restaurant_staff
 * (e.g. a customer who never signs up for anything, or a removed staff
 * member). Rejecting that case here — not just deeper in the app — means
 * a bare login never leaves a signed-in-but-unauthorized session sitting
 * around.
 */
export async function signInWithPassword(
  _prevState: ActionResult<null> | null,
  formData: FormData,
): Promise<ActionResult<null>> {
  const rawEmail = String(formData.get("email") ?? "");
  const email = rawEmail.trim();
  const password = String(formData.get("password") ?? "");

  // TEMPORARY diagnostic logging — safe (no password/token/secret values),
  // remove once the production login incident is closed.
  console.log("[auth:signIn] invoked", {
    emailLength: email.length,
    emailHadWhitespace: rawEmail !== email,
    passwordLength: password.length,
  });

  if (!email || !password) {
    console.log("[auth:signIn] rejected: missing email or password");
    return toActionResult(
      new AppError("VALIDATION_ERROR", "missing email or password", "Enter your email and password."),
    );
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  console.log("[auth:signIn] signInWithPassword result", {
    hasError: Boolean(error),
    errorMessage: error?.message,
    errorStatus: error?.status,
    errorCode: error?.code,
    errorName: error?.name,
    hasUser: Boolean(data?.user),
    hasSession: Boolean(data?.session),
    userId: data?.user?.id,
  });

  if (error) {
    return toActionResult(
      new AppError("UNAUTHENTICATED", error.message, "Incorrect email or password.", { cause: error }),
    );
  }

  const { count: staffCount, error: staffError } = await supabase
    .from("restaurant_staff")
    .select("id", { count: "exact", head: true })
    .eq("is_active", true);

  console.log("[auth:signIn] restaurant_staff check", {
    staffCount,
    staffError: staffError?.message,
  });

  if (!staffCount) {
    // §Bug #1 fix: a pure platform admin (zero restaurant_staff rows —
    // the exact shape a platform-only employee is meant to have, §
    // architecture Part 3) must still be allowed to sign in. This check
    // is entirely additive to the one above — platform-admin status is
    // never treated as, or converted into, a restaurant membership; it
    // only widens WHO may finish signing in, not what requireActiveMembership()
    // resolves afterward.
    //
    // Explicitly filtered by staff_user_id, unlike the restaurant_staff
    // count above: platform_admins_select_platform_admin's RLS condition
    // (is_platform_admin()) is a per-SESSION boolean, not a per-row
    // match — once the caller qualifies, every row in the table becomes
    // visible, not just their own. An unfiltered count would still gate
    // correctly (zero only when the caller doesn't qualify), but would
    // count the entire platform-admin roster instead of "is this user
    // one" — filtering keeps the count meaningful, not just the boolean.
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { count: platformAdminCount } = await supabase
      .from("platform_admins")
      .select("staff_user_id", { count: "exact", head: true })
      .eq("staff_user_id", user?.id ?? "");

    console.log("[auth:signIn] platform_admins check", {
      userId: user?.id,
      platformAdminCount,
    });

    if (!platformAdminCount) {
      await supabase.auth.signOut();
      return toActionResult(
        new AppError(
          "FORBIDDEN",
          "authenticated user has no active restaurant_staff row and is not a platform admin",
          "This account isn't set up as restaurant staff. Contact your admin.",
        ),
      );
    }

    // Zero restaurant memberships: /staff/dashboard would immediately
    // bounce this session back to /staff/login (requireStaffContext
    // redirects there whenever memberships.length === 0) — so a
    // platform-admin-only login must land on /platform instead, never on
    // any /staff/* route, and must never auto-select a restaurant.
    redirect("/platform");
  }

  redirect("/staff/dashboard");
}

export async function signOut(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  await clearActiveRestaurantCookie();
  redirect("/staff/login");
}

/**
 * SaaS Phase 5 — the restaurant picker's only mutation. Bound via
 * `.bind(null, restaurantId)` on each restaurant's own `<form action={...}>`
 * (app/staff/select-restaurant/page.tsx), so the picker page needs no
 * client JavaScript at all — a plain POST per choice.
 *
 * restaurantId always originates from a form the picker itself rendered
 * from the caller's own ctx.memberships, but that's convenience, not the
 * guarantee: this re-validates against a FRESH requireStaffContext()
 * call regardless, exactly like every other write in this app re-derives
 * authorization from the database rather than trusting what a request
 * merely claims. A restaurantId that doesn't match one of the caller's
 * own active memberships — forged, or simply stale because the
 * membership was deactivated between rendering the picker and submitting
 * it — sets nothing and bounces back to the picker with an error, never
 * silently granting the requested restaurant.
 */
export async function selectActiveRestaurant(restaurantId: string, _formData: FormData): Promise<void> {
  const ctx = await requireStaffContext();
  const membership = ctx.memberships.find((m) => m.restaurantId === restaurantId);

  if (!membership) {
    redirect("/staff/select-restaurant?error=invalid_restaurant");
  }

  await setActiveRestaurantCookie(membership.restaurantId);
  redirect("/staff/dashboard");
}
