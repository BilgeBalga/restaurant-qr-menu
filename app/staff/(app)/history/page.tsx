import Link from "next/link";
import { redirect } from "next/navigation";
import { listOrderHistory, type OrderHistoryQueryInput } from "@/app/actions/orders";
import { requireActiveMembership } from "@/lib/auth/session";
import { can } from "@/lib/business/permissions";
import { formatMoney } from "@/lib/format/money";

// Filter/pagination state lives entirely in the URL — never statically cached (§10, same reasoning as every other staff screen).
export const dynamic = "force-dynamic";

const STATUS_OPTIONS = [
  { value: "", label: "All" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
] as const;

const RANGE_OPTIONS = [
  { value: "all", label: "All time" },
  { value: "today", label: "Today" },
  { value: "last7", label: "Last 7 days" },
  { value: "last30", label: "Last 30 days" },
] as const;

const STATUS_BADGE: Record<string, string> = {
  completed: "bg-[var(--color-ivory)] text-[var(--color-charcoal-muted)] border border-[var(--color-border)]",
  cancelled: "bg-[var(--color-ivory)] text-[var(--color-bronze-strong)] border border-[var(--color-border)]",
};

const selectClass =
  "w-full rounded-md border border-[var(--color-border)] bg-[var(--color-ivory)] px-3 py-2 text-sm focus:border-[var(--color-bronze)] focus:outline-none";
const labelClass = "text-xs font-medium uppercase tracking-wide text-[var(--color-charcoal-muted)]";

/** Builds a `/staff/history?...` href from the current filters plus any overrides (used by pagination links). */
function historyHref(current: OrderHistoryQueryInput, overrides: Partial<OrderHistoryQueryInput>): string {
  const merged = { ...current, ...overrides };
  const params = new URLSearchParams();
  if (merged.status) params.set("status", merged.status);
  if (merged.range && merged.range !== "all") params.set("range", merged.range);
  if (merged.tableId) params.set("tableId", merged.tableId);
  if (merged.search) params.set("search", merged.search);
  if (merged.page && String(merged.page) !== "1") params.set("page", String(merged.page));
  const qs = params.toString();
  return qs ? `/staff/history?${qs}` : "/staff/history";
}

export default async function StaffHistoryPage({
  searchParams,
}: {
  searchParams: Promise<OrderHistoryQueryInput>;
}) {
  const membership = await requireActiveMembership();
  if (!can(membership.role, "history:read")) {
    redirect("/staff/dashboard?error=forbidden");
  }

  const query = await searchParams;
  const result = await listOrderHistory(query);

  if (!result.ok) {
    return <p className="text-sm text-red-700">{result.message}</p>;
  }

  const { orders, currency, tableOptions, page, totalCount, totalPages } = result.data;
  const money = (cents: number) => formatMoney(cents, currency);

  return (
    <div>
      <h1 className="mb-4 font-display text-2xl font-semibold">Order History</h1>

      <form
        method="GET"
        className="mb-6 grid grid-cols-2 gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-ivory-raised)] p-4 sm:grid-cols-4 sm:items-end"
      >
        <div className="space-y-1">
          <label htmlFor="history-status" className={labelClass}>
            Status
          </label>
          <select id="history-status" name="status" defaultValue={query.status ?? ""} className={selectClass}>
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <label htmlFor="history-range" className={labelClass}>
            Date range
          </label>
          <select id="history-range" name="range" defaultValue={query.range ?? "all"} className={selectClass}>
            {RANGE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <label htmlFor="history-table" className={labelClass}>
            Table
          </label>
          <select id="history-table" name="tableId" defaultValue={query.tableId ?? ""} className={selectClass}>
            <option value="">All tables</option>
            {tableOptions.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <label htmlFor="history-search" className={labelClass}>
            Search
          </label>
          <input
            id="history-search"
            name="search"
            type="text"
            defaultValue={query.search ?? ""}
            placeholder="Order # or table"
            className={selectClass}
          />
        </div>

        <div className="col-span-2 flex gap-2 sm:col-span-4">
          <button
            type="submit"
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-charcoal)] px-4 py-2 text-sm font-medium text-[var(--color-ivory)] hover:opacity-90"
          >
            Filter
          </button>
          <Link
            href="/staff/history"
            className="rounded-md border border-[var(--color-border)] px-4 py-2 text-sm font-medium hover:bg-[var(--color-ivory)]"
          >
            Clear
          </Link>
        </div>
      </form>

      {orders.length === 0 ? (
        <p className="text-sm text-[var(--color-charcoal-muted)]">No orders match these filters.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-ivory-raised)]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-left text-xs uppercase tracking-wide text-[var(--color-charcoal-muted)]">
                <th className="px-4 py-3 font-medium">Order</th>
                <th className="px-4 py-3 font-medium">Table</th>
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.id} className="border-b border-[var(--color-border)] last:border-0">
                  <td className="px-4 py-3">
                    <Link href={`/staff/orders/${order.id}?from=history`} className="font-medium hover:underline">
                      #{order.orderNumber}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-[var(--color-charcoal-muted)]">Table {order.tableLabel}</td>
                  <td className="px-4 py-3 text-[var(--color-charcoal-muted)]">
                    {new Date(order.createdAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${STATUS_BADGE[order.status] ?? ""}`}>
                      {order.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-medium">{money(order.totalCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalCount > 0 ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-sm text-[var(--color-charcoal-muted)]">
          <span>
            Page {page} of {totalPages} &middot; {totalCount} order{totalCount === 1 ? "" : "s"}
          </span>
          <div className="flex gap-2">
            <Link
              href={historyHref(query, { page: Math.max(1, page - 1) })}
              aria-disabled={page <= 1}
              className={`rounded-md border border-[var(--color-border)] px-3 py-1.5 ${
                page <= 1 ? "pointer-events-none opacity-40" : "hover:bg-[var(--color-ivory)]"
              }`}
            >
              Previous
            </Link>
            <Link
              href={historyHref(query, { page: Math.min(totalPages, page + 1) })}
              aria-disabled={page >= totalPages}
              className={`rounded-md border border-[var(--color-border)] px-3 py-1.5 ${
                page >= totalPages ? "pointer-events-none opacity-40" : "hover:bg-[var(--color-ivory)]"
              }`}
            >
              Next
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}
