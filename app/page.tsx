import Link from "next/link";

/**
 * Root route. Nothing customer- or staff-specific lives here — this is
 * just a foundation-phase placeholder confirming routing works at all.
 * The real customer entry point is /t/[token] (§12); the real staff entry
 * point is /staff/login.
 */
export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-3xl font-semibold">Table-Side</h1>
      <p className="max-w-md text-[var(--color-charcoal-muted)]">
        Project foundation only — Phase 1. Customers arrive via a table QR code; staff sign in below.
      </p>
      <Link
        href="/staff/login"
        className="rounded-md border border-[var(--color-border)] px-4 py-2 text-sm font-medium hover:bg-[var(--color-ivory-raised)]"
      >
        Staff sign in
      </Link>
    </main>
  );
}
