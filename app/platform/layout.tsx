import Link from "next/link";
import { signOut } from "@/app/actions/auth";
import { requirePlatformAdmin } from "@/lib/auth/session";

// Session- and platform-admin-status-dependent, same reasoning as the staff app layout (§10).
export const dynamic = "force-dynamic";

const NAV = [{ href: "/platform", label: "Restaurants" }];

/**
 * Shared chrome for every platform-admin screen. requirePlatformAdmin()
 * is the real authorization check here — mirrors StaffAppLayout exactly,
 * but checked independently of any restaurant_staff membership (a
 * platform admin may have none at all). signOut() is reused unchanged;
 * there's no separate platform login, so it lands back on /staff/login
 * the same as every other sign-out does.
 */
export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const platformAdmin = await requirePlatformAdmin();

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border)] bg-[var(--color-ivory-raised)] px-6 py-3">
        <div className="flex items-center gap-6">
          <span className="font-display text-lg font-semibold">Table-Side Platform</span>
          <nav className="flex gap-4 text-sm">
            {NAV.map((item) => (
              <Link key={item.href} href={item.href} className="text-[var(--color-charcoal-muted)] hover:text-[var(--color-charcoal)]">
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-[var(--color-charcoal-muted)]">{platformAdmin.email ?? "Platform admin"}</span>
          <span className="rounded-full border border-[var(--color-border)] px-2.5 py-0.5 font-mono text-xs uppercase tracking-wide text-[var(--color-bronze-strong)]">
            platform admin
          </span>
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
