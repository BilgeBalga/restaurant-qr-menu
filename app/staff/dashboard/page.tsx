import { signOut } from "@/app/actions/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Session-dependent — must never be statically prerendered (§10).
export const dynamic = "force-dynamic";

/**
 * Minimal foundation-phase placeholder proving the auth loop closes:
 * middleware already blocked unauthenticated access to this route, and
 * this page can read who's signed in. The real dashboard (order counts,
 * revenue, active tables — §17) arrives in Phase 7, once orders/tables
 * exist to summarize.
 */
export default async function StaffDashboardPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-2xl font-semibold">Signed in</h1>
      <p className="text-[var(--color-charcoal-muted)]">{user?.email}</p>
      <p className="max-w-md text-sm text-[var(--color-charcoal-muted)]">
        Role and restaurant scoping arrive with the Phase 2 schema (restaurant_staff). The real kanban
        dashboard is Phase 7.
      </p>
      <form action={signOut}>
        <button
          type="submit"
          className="rounded-md border border-[var(--color-border)] px-4 py-2 text-sm font-medium hover:bg-[var(--color-ivory-raised)]"
        >
          Sign out
        </button>
      </form>
    </main>
  );
}
