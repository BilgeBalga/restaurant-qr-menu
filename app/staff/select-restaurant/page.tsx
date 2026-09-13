import { redirect } from "next/navigation";
import { requireStaffContext } from "@/lib/auth/session";
import { selectActiveRestaurant, signOut } from "@/app/actions/auth";

/**
 * SaaS Phase 5 — shown only to a staff user with more than one active
 * restaurant_staff membership and no (or an invalid/stale)
 * active_restaurant_id selection; requireActiveMembership() redirects
 * here automatically (lib/auth/session.ts). Deliberately sits outside
 * app/staff/(app) — like /staff/login, it must be reachable without
 * already having a resolved restaurant context, and (app)/layout.tsx
 * itself calls requireActiveMembership(), which would redirect right
 * back here in a loop if this page lived inside that group.
 *
 * Lists only ctx.memberships — restaurant_staff rows requireStaffContext()
 * just queried fresh for the caller's own auth.uid(), RLS-scoped, so this
 * can never show (or let someone select into) a restaurant they don't
 * actually belong to.
 */
export default async function SelectRestaurantPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const ctx = await requireStaffContext();

  if (ctx.memberships.length <= 1) {
    redirect("/staff/dashboard");
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 px-6 py-16">
      <div>
        <h1 className="font-display text-2xl font-semibold">Choose a restaurant</h1>
        <p className="mt-1 text-sm text-[var(--color-charcoal-muted)]">
          You have staff access at more than one restaurant. Pick which one to manage.
        </p>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-red-700">
          That restaurant isn&apos;t available to you. Please choose again.
        </p>
      ) : null}

      <div className="flex flex-col gap-2">
        {ctx.memberships.map((membership) => (
          <form key={membership.restaurantId} action={selectActiveRestaurant.bind(null, membership.restaurantId)}>
            <button
              type="submit"
              className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-ivory-raised)] px-4 py-3 text-left hover:border-[var(--color-bronze)]"
            >
              <span className="block font-medium">{membership.restaurantName}</span>
              <span className="block text-xs uppercase tracking-wide text-[var(--color-charcoal-muted)]">{membership.role}</span>
            </button>
          </form>
        ))}
      </div>

      <form action={signOut} className="mt-2">
        <button type="submit" className="text-sm text-[var(--color-charcoal-muted)] hover:underline">
          Sign out
        </button>
      </form>
    </main>
  );
}
