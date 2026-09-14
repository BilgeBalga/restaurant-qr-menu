/**
 * §Phase 6 audit P1-3 — every staff screen (dashboard, orders, tables,
 * menu, history, settings, staff) is a Server Component gated by
 * requireActiveMembership(), so without this the first paint was a blank
 * page for however long that check + data fetch took. Sits alongside
 * StaffAppLayout, so this covers the layout's own async work too — the
 * nav header isn't shown while loading either way, since it depends on
 * the same membership resolution.
 */
export default function StaffLoading() {
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
