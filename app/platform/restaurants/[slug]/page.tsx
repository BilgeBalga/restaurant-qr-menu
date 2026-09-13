import { notFound } from "next/navigation";
import Link from "next/link";
import { getPlatformRestaurantBySlug, type RestaurantStatus } from "@/app/actions/platformAdmin";

const STATUS_BADGE: Record<RestaurantStatus, string> = {
  provisioning: "border-[var(--color-border)] bg-[var(--color-ivory)] text-[var(--color-charcoal-muted)]",
  active: "border-emerald-200 bg-emerald-50 text-emerald-800",
  suspended: "border-amber-200 bg-amber-50 text-amber-800",
  archived: "border-[var(--color-border)] bg-[var(--color-ivory)] text-[var(--color-charcoal-muted)]",
};

const rowClass = "flex items-center justify-between border-b border-[var(--color-border)] py-3 last:border-0";
const labelClass = "text-sm text-[var(--color-charcoal-muted)]";
const valueClass = "text-sm font-medium";

/**
 * Read-only for now, deliberately — no suspend/archive/restore controls
 * exist yet (Phase 5+ per the approved architecture; this phase's scope
 * is provisioning + visibility only). getPlatformRestaurantBySlug()
 * resolves the restaurant entirely server-side, gated by
 * requirePlatformAdmin() and restaurants_select_platform_admin RLS —
 * the slug in the URL is never trusted as authorization, only as a
 * lookup key, same as every other [param] page in this app.
 */
export default async function PlatformRestaurantDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const result = await getPlatformRestaurantBySlug(slug);

  if (!result.ok) {
    if (result.code === "NOT_FOUND") notFound();
    return <p className="text-sm text-red-700">{result.message}</p>;
  }

  const restaurant = result.data;

  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/platform" className="text-sm text-[var(--color-bronze-strong)] hover:underline">
        ← Restaurants
      </Link>

      <div className="mt-3 mb-6 flex items-center gap-3">
        <h1 className="font-display text-2xl font-semibold">{restaurant.name}</h1>
        <span className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${STATUS_BADGE[restaurant.status]}`}>
          {restaurant.status}
        </span>
      </div>

      <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-ivory-raised)] p-5">
        <div className={rowClass}>
          <span className={labelClass}>Slug</span>
          <span className={valueClass}>{restaurant.slug}</span>
        </div>
        <div className={rowClass}>
          <span className={labelClass}>Owner</span>
          <span className={valueClass}>{restaurant.ownerEmail ?? "—"}</span>
        </div>
        <div className={rowClass}>
          <span className={labelClass}>Currency</span>
          <span className={valueClass}>{restaurant.currency}</span>
        </div>
        <div className={rowClass}>
          <span className={labelClass}>Timezone</span>
          <span className={valueClass}>{restaurant.timezone}</span>
        </div>
        <div className={rowClass}>
          <span className={labelClass}>Accepting orders</span>
          <span className={valueClass}>{restaurant.orderingEnabled ? "Yes" : "No"}</span>
        </div>
        <div className={rowClass}>
          <span className={labelClass}>Created</span>
          <span className={valueClass}>{new Date(restaurant.createdAt).toLocaleString()}</span>
        </div>
        <div className={rowClass}>
          <span className={labelClass}>Last updated</span>
          <span className={valueClass}>{new Date(restaurant.updatedAt).toLocaleString()}</span>
        </div>
      </section>

      <p className="mt-4 text-xs text-[var(--color-charcoal-muted)]">
        Status changes (suspend/archive/restore) aren&apos;t available yet — this view is read-only.
      </p>
    </div>
  );
}
