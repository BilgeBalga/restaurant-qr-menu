/**
 * §Phase 6 audit P1-3 — every customer screen (menu, item detail, cart,
 * order tracking) is a Server Component reading from Supabase, so without
 * this the first paint was a blank page for however long that fetch
 * took. Wraps the whole (customer) segment (layout + page together, since
 * this file sits alongside the layout) — deliberately minimal, no
 * skeleton of specific content, since what's loading varies per route.
 */
export default function CustomerLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--color-ivory)]">
      <div
        role="status"
        aria-label="Loading"
        className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--color-border)] border-t-[var(--color-bronze)]"
      />
    </div>
  );
}
