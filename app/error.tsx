"use client";

/**
 * §Phase 6 audit P1-3 — top-level error boundary. Without this, any
 * uncaught error in a Server Component render (customer or staff side)
 * fell through to Next.js's generic default error page instead of
 * anything on-brand. Deliberately minimal and generic (no route-specific
 * messaging) since this is the last-resort catch-all; a route that wants
 * a more specific error state can still add its own error.tsx, which
 * takes precedence over this one for that segment.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-[var(--color-ivory)] px-6 text-center">
      <h1 className="font-display text-2xl font-semibold text-[var(--color-charcoal)]">Something went wrong</h1>
      <p className="max-w-sm text-[var(--color-charcoal-muted)]">
        We hit an unexpected error. Please try again — if this keeps happening, let us know.
      </p>
      <button
        type="button"
        onClick={reset}
        className="mt-2 rounded-md bg-[var(--color-bronze)] px-4 py-2 text-sm font-medium text-white"
      >
        Try again
      </button>
    </div>
  );
}
