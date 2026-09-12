import "server-only";
import { randomBytes } from "node:crypto";

/**
 * The minimal slice of the Supabase Admin client this module actually
 * calls — not the full `SupabaseClient` type. Narrowing the dependency to
 * exactly what's used means a test can pass a small, fully-typed stub
 * (no real network, no real service-role key) instead of an `any`-cast
 * fake covering a type with dozens of unrelated methods. The real
 * client from lib/supabase/admin.ts satisfies this structurally with no
 * cast needed at the call site.
 */
export interface StaffAuthAdminClient {
  from(table: "staff_users"): {
    select(columns: "id"): {
      eq(
        column: "email",
        value: string,
      ): { maybeSingle(): PromiseLike<{ data: { id: string } | null; error: { message: string } | null }> };
    };
  };
  auth: {
    admin: {
      createUser(params: { email: string; password: string; email_confirm: boolean }): PromiseLike<{
        data: { user: { id: string } | null } | null;
        error: { message: string } | null;
      }>;
    };
  };
}

export interface ResolvedAuthUser {
  id: string;
  /** True only when a brand-new Auth account was created by this call. */
  created: boolean;
  /** Set only when `created` is true — the one-time credential the admin must relay to the new hire (no email/SMTP infra exists yet — see Staff Management report). */
  temporaryPassword: string | null;
}

export type FindOrCreateStaffAuthUserResult = { ok: true; data: ResolvedAuthUser } | { ok: false; error: string };

/** 24 random bytes, base64url — well above Supabase Auth's minimum length; never manually typed, only copy/relayed once. */
function generateTemporaryPassword(): string {
  return randomBytes(24).toString("base64url");
}

/**
 * Finds the Auth user for `email`, or creates one via the Supabase Admin
 * API if none exists yet — the "safest supported server-side approach"
 * for Staff Management's add-staff flow (§ audit): this project has no
 * self-service signup and no email/SMTP integration, so a normal
 * client-side `auth.signUp()` isn't an option and an invite email can't be
 * delivered. `admin.createUser()` on a service-role client, called only
 * from a "use server" action, is the supported way to provision an
 * account entirely server-side without ever touching the browser.
 *
 * Looks up by `staff_users` (mirrors auth.users 1:1 via the
 * handle_new_auth_user trigger) rather than `admin.listUsers()` — indexed,
 * one row, no pagination — but still requires the ADMIN (service-role)
 * client: normal RLS on staff_users only allows reading yourself or an
 * existing restaurant colleague, which would miss a stranger who has never
 * worked at any restaurant this admin manages.
 */
export async function findOrCreateStaffAuthUser(admin: StaffAuthAdminClient, email: string): Promise<FindOrCreateStaffAuthUserResult> {
  const { data: existing, error: lookupError } = await admin.from("staff_users").select("id").eq("email", email).maybeSingle();

  if (lookupError) {
    return { ok: false, error: lookupError.message };
  }
  if (existing) {
    return { ok: true, data: { id: existing.id, created: false, temporaryPassword: null } };
  }

  const temporaryPassword = generateTemporaryPassword();
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password: temporaryPassword,
    email_confirm: true,
  });

  if (createError || !created?.user) {
    return { ok: false, error: createError?.message ?? "failed to create auth user" };
  }

  return { ok: true, data: { id: created.user.id, created: true, temporaryPassword } };
}
