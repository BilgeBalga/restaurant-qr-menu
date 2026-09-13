import Link from "next/link";
import { signOut } from "@/app/actions/auth";
import { getStaffContext, requireActiveMembership } from "@/lib/auth/session";
import { can } from "@/lib/business/permissions";

// Every authenticated staff screen is session- and tenant-dependent (§10).
export const dynamic = "force-dynamic";

const NAV = [
  { href: "/staff/dashboard", label: "Dashboard" },
  { href: "/staff/orders", label: "Orders" },
  { href: "/staff/tables", label: "Tables" },
  { href: "/staff/menu", label: "Menu" },
];

const HISTORY_NAV = [{ href: "/staff/history", label: "History" }];

const ADMIN_NAV = [
  { href: "/staff/staff", label: "Staff" },
  { href: "/staff/settings", label: "Settings" },
];

/**
 * Shared chrome for every authenticated staff screen — NOT the login
 * page, which sits outside this route group so it never shows "signed in
 * as ..." nav before there's a session. requireActiveMembership() is the
 * real authorization check (§19 finding); this file is what actually
 * gates every /staff/(app)/* page, not just the redirect in proxy.ts.
 *
 * getStaffContext() alongside it (SaaS Phase 5) is free — both go
 * through the same React cache() per request, so this is the same
 * restaurant_staff query, not a second one — used only to decide whether
 * to show the "Switch restaurant" link, never for authorization itself
 * (requireActiveMembership() above already fully resolved that).
 */
export default async function StaffAppLayout({ children }: { children: React.ReactNode }) {
  const membership = await requireActiveMembership();
  const ctx = await getStaffContext();
  const hasMultipleRestaurants = (ctx?.memberships.length ?? 0) > 1;

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border)] bg-[var(--color-ivory-raised)] px-6 py-3">
        <div className="flex items-center gap-6">
          <span className="font-display text-lg font-semibold">Table-Side</span>
          <nav className="flex gap-4 text-sm">
            {[...NAV, ...(can(membership.role, "history:read") ? HISTORY_NAV : []), ...(membership.role === "admin" ? ADMIN_NAV : [])].map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="text-[var(--color-charcoal-muted)] hover:text-[var(--color-charcoal)]"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-[var(--color-charcoal-muted)]">{membership.restaurantName}</span>
          <span className="rounded-full border border-[var(--color-border)] px-2.5 py-0.5 font-mono text-xs uppercase tracking-wide text-[var(--color-bronze-strong)]">
            {membership.role}
          </span>
          {hasMultipleRestaurants ? (
            <Link
              href="/staff/select-restaurant"
              className="rounded-md border border-[var(--color-border)] px-3 py-1.5 font-medium hover:bg-[var(--color-ivory)]"
            >
              Switch restaurant
            </Link>
          ) : null}
          <form action={signOut}>
            <button
              type="submit"
              className="rounded-md border border-[var(--color-border)] px-3 py-1.5 font-medium hover:bg-[var(--color-ivory)]"
            >
              Sign out
            </button>
          </form>
        </div>
      </header>
      <main className="flex-1 bg-[var(--color-ivory)] p-6">{children}</main>
    </div>
  );
}
