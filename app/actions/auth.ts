"use server";

import { redirect } from "next/navigation";
import { AppError, toActionResult, type ActionResult } from "@/lib/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";

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
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return toActionResult(
      new AppError("VALIDATION_ERROR", "missing email or password", "Enter your email and password."),
    );
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return toActionResult(
      new AppError("UNAUTHENTICATED", error.message, "Incorrect email or password.", { cause: error }),
    );
  }

  const { count } = await supabase
    .from("restaurant_staff")
    .select("id", { count: "exact", head: true })
    .eq("is_active", true);

  if (!count) {
    await supabase.auth.signOut();
    return toActionResult(
      new AppError(
        "FORBIDDEN",
        "authenticated user has no active restaurant_staff row",
        "This account isn't set up as restaurant staff. Contact your admin.",
      ),
    );
  }

  redirect("/staff/dashboard");
}

export async function signOut(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/staff/login");
}
