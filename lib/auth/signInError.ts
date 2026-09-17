import type { AuthError } from "@supabase/supabase-js";
import { AppError } from "@/lib/errors";

/**
 * The one Supabase Auth response shape that genuinely means "wrong email or
 * password" (per @supabase/auth-js's ErrorCode union). Everything else —
 * a misconfigured project URL causing every auth request to 404, a network
 * failure, a rate limit, a disabled provider, an unconfirmed email, etc. —
 * is a different problem and must never be shown to the user as a
 * credentials error: that sends admins straight to resetting a password
 * that was never the issue (see the Sept 2026 staff-login incident, where
 * a bad NEXT_PUBLIC_SUPABASE_URL in Vercel's Production env — pointing at
 * `.../rest/v1` instead of the bare project origin — 404'd every
 * signInWithPassword call, and this exact line reported it as "Incorrect
 * email or password" with the real cause never logged anywhere).
 */
export function classifySignInError(error: AuthError): AppError {
  if (error.status === 400 && error.code === "invalid_credentials") {
    return new AppError("UNAUTHENTICATED", error.message, "Incorrect email or password.", { cause: error });
  }

  console.error("[auth:signIn] non-credentials Supabase Auth error", {
    message: error.message,
    status: error.status,
    code: error.code,
    name: error.name,
  });

  return new AppError(
    "INTERNAL",
    error.message,
    "Sign-in is temporarily unavailable. Please try again shortly, or contact your admin if this continues.",
    { cause: error },
  );
}
