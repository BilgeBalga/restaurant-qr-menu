"use server";

import { redirect } from "next/navigation";
import { AppError, toActionResult, type ActionResult } from "@/lib/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Thin server action per §22 — validation + the actual work happen one
 * layer down (Supabase Auth itself here; lib/business + lib/db once orders
 * and menu actions exist). Role/tenant lookups against restaurant_staff
 * arrive with the Phase 2 schema — this only establishes "is this a valid
 * staff login," per Phase 1's auth-foundation scope.
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

  redirect("/staff/dashboard");
}

export async function signOut(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/staff/login");
}
