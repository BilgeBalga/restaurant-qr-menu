import { getDashboardMetrics } from "@/app/actions/dashboard";
import { formatMoney } from "@/lib/format/money";

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-ivory-raised)] p-5">
      <div className="text-3xl font-semibold tabular-nums">{value}</div>
      <div className="mt-1 text-sm text-[var(--color-charcoal-muted)]">{label}</div>
    </div>
  );
}

/** §17: five numbers, no chart clutter. */
export default async function StaffDashboardPage() {
  const result = await getDashboardMetrics();

  if (!result.ok) {
    return <p className="text-sm text-red-700">{result.message}</p>;
  }

  const m = result.data;

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="mb-6 font-display text-2xl font-semibold">Dashboard</h1>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Stat label="New orders" value={m.newCount} />
        <Stat label="Preparing" value={m.preparingCount} />
        <Stat label="Ready" value={m.readyCount} />
        <Stat label="Completed today" value={m.completedToday} />
        <Stat label="Revenue today" value={formatMoney(m.revenueTodayCents, m.currency)} />
        <Stat label="Active tables" value={m.activeTables} />
      </div>
    </div>
  );
}
